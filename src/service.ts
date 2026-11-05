import { Database } from "./db.js";
export class NotFoundError extends Error {}
export class ValidationError extends Error {}

function sha(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }

export class AssessmentService {
  constructor(private readonly db: Database) {}
  private async activity(submissionId: number, action: string, actor: string, detail = "") {
    await this.db.query("INSERT INTO activities (submission_id, action, actor, detail) VALUES ($1,$2,$3,$4)", [submissionId, action, actor, detail]);
  }
  async createClass(code: string, name: string, teacher: string) {
    if (!code.trim() || !name.trim() || !teacher.trim()) throw new ValidationError("code, name and teacher are required");
    if ((await this.db.query("SELECT id FROM classes WHERE code=$1", [code])).length) throw new ValidationError("class code already exists");
    const rows = await this.db.query<{ id: number; code: string }>("INSERT INTO classes (code,name,teacher) VALUES ($1,$2,$3) RETURNING id, code", [code, name, teacher]);
    return rows[0];
  }
  async createStudent(code: string, name: string, classId: number) {
    if (!code.trim() || !name.trim()) throw new ValidationError("student code and name are required");
    if (!(await this.db.query("SELECT id FROM classes WHERE id=$1", [classId])).length) throw new NotFoundError("class not found");
    if ((await this.db.query("SELECT id FROM students WHERE code=$1", [code])).length) throw new ValidationError("student code already exists");
    const rows = await this.db.query<{ id: number; code: string }>("INSERT INTO students (code,name,class_id) VALUES ($1,$2,$3) RETURNING id, code", [code, name, classId]);
    return rows[0];
  }
  async createAssessment(code: string, title: string, classId: number, totalMarks: number, dueDate: string) {
    if (!code.trim() || !title.trim() || !Number.isInteger(totalMarks) || totalMarks <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new ValidationError("valid code, title, marks and due date are required");
    if (!(await this.db.query("SELECT id FROM classes WHERE id=$1", [classId])).length) throw new NotFoundError("class not found");
    if ((await this.db.query("SELECT id FROM assessments WHERE code=$1", [code])).length) throw new ValidationError("assessment code already exists");
    const rows = await this.db.query<{ id: number; status: string }>("INSERT INTO assessments (code,title,class_id,total_marks,due_date,status) VALUES ($1,$2,$3,$4,$5,'open') RETURNING id, status", [code, title, classId, totalMarks, dueDate]);
    return rows[0];
  }
  async submit(assessmentId: number, studentId: number, content: string, attachmentSha256 = "") {
    if (!content.trim()) throw new ValidationError("submission content is required");
    if (attachmentSha256 && !sha(attachmentSha256)) throw new ValidationError("attachment_sha256 must be 64 hex characters");
    const assessment = await this.db.query<{ id: number; class_id: number; status: string; total_marks: number }>("SELECT id, class_id, status, total_marks FROM assessments WHERE id=$1", [assessmentId]);
    if (!assessment.length) throw new NotFoundError("assessment not found");
    if (assessment[0].status !== "open") throw new ValidationError("assessment is not open");
    const student = await this.db.query<{ id: number; class_id: number }>("SELECT id, class_id FROM students WHERE id=$1", [studentId]);
    if (!student.length || student[0].class_id !== assessment[0].class_id) throw new ValidationError("student is not in this class");
    const existing = await this.db.query<{ id: number; status: string }>("SELECT id, status FROM submissions WHERE assessment_id=$1 AND student_id=$2", [assessmentId, studentId]);
    if (existing.length) return { id: existing[0].id, status: existing[0].status, unchanged: true };
    const rows = await this.db.query<{ id: number; status: string }>("INSERT INTO submissions (assessment_id,student_id,content,attachment_sha256,submitted_at) VALUES ($1,$2,$3,$4,$5) RETURNING id, status", [assessmentId, studentId, content, attachmentSha256 || null, new Date().toISOString()]);
    await this.activity(rows[0].id, "submitted", `student:${studentId}`);
    return { id: rows[0].id, status: "submitted", unchanged: false };
  }
  async mark(submissionId: number, marker: string, score: number, feedback: string) {
    if (!marker.trim() || !Number.isInteger(score) || score < 0 || !feedback.trim()) throw new ValidationError("marker, non-negative score and feedback are required");
    const rows = await this.db.query<{ id: number; assessment_id: number; status: string }>("SELECT id, assessment_id, status FROM submissions WHERE id=$1", [submissionId]);
    if (!rows.length) throw new NotFoundError("submission not found");
    if (rows[0].status === "released") throw new ValidationError("submission is released");
    const assessment = await this.db.query<{ total_marks: number }>("SELECT total_marks FROM assessments WHERE id=$1", [rows[0].assessment_id]);
    if (score > assessment[0].total_marks) throw new ValidationError("score exceeds total marks");
    await this.db.query("UPDATE submissions SET status='marked', raw_score=$1, marker=$2, feedback=$3 WHERE id=$4", [score, marker, feedback, submissionId]);
    await this.activity(submissionId, "marked", marker, String(score));
    return { id: submissionId, status: "marked", score };
  }
  async moderate(submissionId: number, moderator: string, score: number) {
    if (!Number.isInteger(score) || score < 0) throw new ValidationError("non-negative moderated score is required");
    const rows = await this.db.query<{ id: number; assessment_id: number; status: string }>("SELECT id, assessment_id, status FROM submissions WHERE id=$1", [submissionId]);
    if (!rows.length) throw new NotFoundError("submission not found");
    if (rows[0].status !== "marked") throw new ValidationError("submission must be marked before moderation");
    const assessment = await this.db.query<{ total_marks: number }>("SELECT total_marks FROM assessments WHERE id=$1", [rows[0].assessment_id]);
    if (score > assessment[0].total_marks) throw new ValidationError("score exceeds total marks");
    await this.db.query("UPDATE submissions SET status='moderated', moderated_score=$1, moderator=$2 WHERE id=$3", [score, moderator, submissionId]);
    await this.activity(submissionId, "moderated", moderator, String(score));
    return { id: submissionId, status: "moderated", score };
  }
  async release(submissionId: number, actor: string) {
    const rows = await this.db.query<{ id: number; status: string }>("SELECT id, status FROM submissions WHERE id=$1", [submissionId]);
    if (!rows.length) throw new NotFoundError("submission not found");
    if (rows[0].status === "released") return { id: submissionId, status: "released", unchanged: true };
    if (rows[0].status !== "moderated") throw new ValidationError("submission must be moderated before release");
    await this.db.query("UPDATE submissions SET status='released' WHERE id=$1", [submissionId]);
    await this.activity(submissionId, "released", actor);
    return { id: submissionId, status: "released", unchanged: false };
  }
  async result(submissionId: number) {
    const rows = await this.db.query<{ raw_score: number | null; moderated_score: number | null; status: string; feedback: string | null }>("SELECT raw_score, moderated_score, status, feedback FROM submissions WHERE id=$1", [submissionId]);
    if (!rows.length) throw new NotFoundError("submission not found");
    if (rows[0].status !== "released") throw new ValidationError("result is not released");
    return rows[0];
  }
  async activities(submissionId: number) {
    if (!(await this.db.query("SELECT id FROM submissions WHERE id=$1", [submissionId])).length) throw new NotFoundError("submission not found");
    return this.db.query("SELECT action, actor, detail, at FROM activities WHERE submission_id=$1 ORDER BY id", [submissionId]);
  }
}
