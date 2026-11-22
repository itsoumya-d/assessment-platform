import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testDatabase } from "./core.test.js";

describe("assessment submission workflow", () => {
  let app: ReturnType<typeof buildApp>;
  const headers = { "x-api-key": "test-key" };

  beforeEach(() => {
    app = buildApp(testDatabase(), "test-key");
  });

  async function setup() {
    const c = await app.inject({ method: "POST", url: "/classes", headers, payload: { code: "C1", name: "Year 10", teacher: "Ms Smith" } });
    const s = await app.inject({ method: "POST", url: "/students", headers, payload: { code: "S1", name: "Aroha", class_id: c.json().id } });
    const a = await app.inject({ method: "POST", url: "/assessments", headers, payload: { code: "A1", title: "Algebra", class_id: c.json().id, total_marks: 100, due_date: "2026-03-01" } });
    return { cls: c.json(), student: s.json(), assessment: a.json() };
  }

  async function submission() {
    const { assessment, student } = await setup();
    const r = await app.inject({ method: "POST", url: "/submissions", headers, payload: { assessment_id: assessment.id, student_id: student.id, content: "My answer", attachment_sha256: "a".repeat(64) } });
    return { ...r.json(), assessment, student };
  }

  it("submits work", async () => {
    expect((await submission()).status).toBe("submitted");
  });

  it("rejects a student outside the class", async () => {
    const { assessment } = await setup();
    const c2 = await app.inject({ method: "POST", url: "/classes", headers, payload: { code: "C2", name: "Year 11", teacher: "Mr Jones" } });
    const s2 = await app.inject({ method: "POST", url: "/students", headers, payload: { code: "S2", name: "Sam", class_id: c2.json().id } });
    const r = await app.inject({ method: "POST", url: "/submissions", headers, payload: { assessment_id: assessment.id, student_id: s2.json().id, content: "x" } });
    expect(r.statusCode).toBe(422);
  });

  it("is idempotent on duplicate submission", async () => {
    const s = await submission();
    const r = await app.inject({ method: "POST", url: "/submissions", headers, payload: { assessment_id: s.assessment.id, student_id: s.student.id, content: "again" } });
    expect(r.json().unchanged).toBe(true);
  });

  it("marks a submission", async () => {
    const s = await submission();
    const r = await app.inject({ method: "POST", url: `/submissions/${s.id}/mark`, headers, payload: { marker: "Ms Smith", score: 82, feedback: "Good" } });
    expect(r.json().status).toBe("marked");
  });

  it("rejects a score above total marks", async () => {
    const s = await submission();
    const r = await app.inject({ method: "POST", url: `/submissions/${s.id}/mark`, headers, payload: { marker: "Ms Smith", score: 101, feedback: "x" } });
    expect(r.statusCode).toBe(422);
  });

  it("blocks moderation before marking", async () => {
    const s = await submission();
    const r = await app.inject({ method: "POST", url: `/submissions/${s.id}/moderate`, headers, payload: { moderator: "HOD", score: 80 } });
    expect(r.statusCode).toBe(422);
  });

  it("moderates after marking", async () => {
    const s = await submission();
    await app.inject({ method: "POST", url: `/submissions/${s.id}/mark`, headers, payload: { marker: "Ms Smith", score: 82, feedback: "Good" } });
    const r = await app.inject({ method: "POST", url: `/submissions/${s.id}/moderate`, headers, payload: { moderator: "HOD", score: 85 } });
    expect(r.json().status).toBe("moderated");
  });

  it("blocks release before moderation", async () => {
    const s = await submission();
    const r = await app.inject({ method: "POST", url: `/submissions/${s.id}/release`, headers, payload: { actor: "Ms Smith" } });
    expect(r.statusCode).toBe(422);
  });

  it("releases a result", async () => {
    const s = await submission();
    await app.inject({ method: "POST", url: `/submissions/${s.id}/mark`, headers, payload: { marker: "Ms Smith", score: 82, feedback: "Good" } });
    await app.inject({ method: "POST", url: `/submissions/${s.id}/moderate`, headers, payload: { moderator: "HOD", score: 85 } });
    const r = await app.inject({ method: "POST", url: `/submissions/${s.id}/release`, headers, payload: { actor: "Ms Smith" } });
    expect(r.json().status).toBe("released");
  });

  it("returns a released result", async () => {
    const s = await submission();
    await app.inject({ method: "POST", url: `/submissions/${s.id}/mark`, headers, payload: { marker: "Ms Smith", score: 82, feedback: "Good" } });
    await app.inject({ method: "POST", url: `/submissions/${s.id}/moderate`, headers, payload: { moderator: "HOD", score: 85 } });
    await app.inject({ method: "POST", url: `/submissions/${s.id}/release`, headers, payload: { actor: "Ms Smith" } });
    const r = await app.inject({ method: "GET", url: `/submissions/${s.id}/result`, headers });
    expect(r.json().moderated_score).toBe(85);
  });

  it("records activities", async () => {
    const s = await submission();
    const r = await app.inject({ method: "GET", url: `/submissions/${s.id}/activities`, headers });
    expect(r.json().activities[0].action).toBe("submitted");
  });
});
