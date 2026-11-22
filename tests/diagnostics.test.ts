import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { Database } from "../src/db.js";
import { testDatabase } from "./core.test.js";

describe("production diagnostics and data integrity", () => {
  let app: ReturnType<typeof buildApp>;
  let db: Database;
  const headers = { "x-api-key": "test-key" };

  beforeEach(() => {
    db = testDatabase();
    app = buildApp(db, "test-key");
  });

  async function createSubmission() {
    const c = await app.inject({ method: "POST", url: "/classes", headers, payload: { code: "C1", name: "Year 10", teacher: "Ms Smith" } });
    const s = await app.inject({ method: "POST", url: "/students", headers, payload: { code: "S1", name: "Aroha", class_id: c.json().id } });
    const a = await app.inject({ method: "POST", url: "/assessments", headers, payload: { code: "A1", title: "Algebra", class_id: c.json().id, total_marks: 100, due_date: "2026-03-01" } });
    const sub = await app.inject({ method: "POST", url: "/submissions", headers, payload: { assessment_id: a.json().id, student_id: s.json().id, content: "Test answer" } });
    return { cls: c.json(), student: s.json(), assessment: a.json(), submission: sub.json() };
  }

  it("reports healthy diagnostics on valid state", async () => {
    await createSubmission();
    const r = await app.inject({ method: "GET", url: "/admin/diagnostics/integrity", headers });
    expect(r.statusCode).toBe(200);
    expect(r.json().healthy).toBe(true);
    expect(r.json().anomalies_count).toBe(0);
  });

  it("detects score out-of-bounds anomalies in diagnostics", async () => {
    const { submission } = await createSubmission();
    await db.query("UPDATE submissions SET raw_score=150 WHERE id=$1", [submission.id]);
    const r = await app.inject({ method: "GET", url: "/admin/diagnostics/integrity", headers });
    expect(r.statusCode).toBe(200);
    expect(r.json().healthy).toBe(false);
    expect(r.json().anomalies_count).toBeGreaterThan(0);
    expect(r.json().issues[0].type).toBe("score_out_of_bounds");
  });

  it("reconciles anomalous submission and records structured audit trail", async () => {
    const { submission } = await createSubmission();
    await db.query("UPDATE submissions SET raw_score=150, moderated_score=200 WHERE id=$1", [submission.id]);
    const r = await app.inject({
      method: "POST",
      url: `/admin/reconcile/${submission.id}`,
      headers,
      payload: { actor: "SupportEng", reason: "INC-402: Score overflow clamp to total marks" }
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().mutated).toBe(true);
    expect(r.json().raw_score).toBe(100);
    expect(r.json().moderated_score).toBe(100);

    const act = await app.inject({ method: "GET", url: `/submissions/${submission.id}/activities`, headers });
    const reconciledAct = act.json().activities.find((a: any) => a.action === "reconciled");
    expect(reconciledAct).toBeDefined();
    expect(reconciledAct.actor).toBe("SupportEng");
  });
});
