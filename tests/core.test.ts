import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { Database } from "../src/db.js";

const schema = readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8");

export function testDatabase(): Database {
  const mem = newDb();
  mem.public.none(schema);
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();
  return {
    async query(sql, params = []) { return (await pool.query(sql, params)).rows; },
    async close() { await pool.end(); }
  };
}

describe("core entities", () => {
  let app: ReturnType<typeof buildApp>;
  const headers = { "x-api-key": "test-key" };

  beforeEach(() => {
    app = buildApp(testDatabase(), "test-key");
  });

  it("serves health without auth", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("rejects missing API key", async () => {
    expect((await app.inject({ method: "POST", url: "/classes", payload: {} })).statusCode).toBe(401);
  });

  it("creates a class", async () => {
    const c = await app.inject({ method: "POST", url: "/classes", headers, payload: { code: "C1", name: "Year 10", teacher: "Ms Smith" } });
    expect(c.json().code).toBe("C1");
  });

  it("rejects duplicate class", async () => {
    await app.inject({ method: "POST", url: "/classes", headers, payload: { code: "C1", name: "Year 10", teacher: "Ms Smith" } });
    const r = await app.inject({ method: "POST", url: "/classes", headers, payload: { code: "C1", name: "Again", teacher: "X" } });
    expect(r.statusCode).toBe(422);
  });

  it("creates a student", async () => {
    const c = await app.inject({ method: "POST", url: "/classes", headers, payload: { code: "C1", name: "Year 10", teacher: "Ms Smith" } });
    const s = await app.inject({ method: "POST", url: "/students", headers, payload: { code: "S1", name: "Aroha", class_id: c.json().id } });
    expect(s.json().code).toBe("S1");
  });

  it("rejects a student for a missing class", async () => {
    const r = await app.inject({ method: "POST", url: "/students", headers, payload: { code: "S1", name: "Aroha", class_id: 999 } });
    expect(r.statusCode).toBe(404);
  });

  it("creates an assessment", async () => {
    const c = await app.inject({ method: "POST", url: "/classes", headers, payload: { code: "C1", name: "Year 10", teacher: "Ms Smith" } });
    const a = await app.inject({ method: "POST", url: "/assessments", headers, payload: { code: "A1", title: "Algebra", class_id: c.json().id, total_marks: 100, due_date: "2026-03-01" } });
    expect(a.json().status).toBe("open");
  });

  it("rejects duplicate assessment", async () => {
    const c = await app.inject({ method: "POST", url: "/classes", headers, payload: { code: "C1", name: "Year 10", teacher: "Ms Smith" } });
    await app.inject({ method: "POST", url: "/assessments", headers, payload: { code: "A1", title: "Algebra", class_id: c.json().id, total_marks: 100, due_date: "2026-03-01" } });
    const r = await app.inject({ method: "POST", url: "/assessments", headers, payload: { code: "A1", title: "Again", class_id: c.json().id, total_marks: 10, due_date: "2026-03-01" } });
    expect(r.statusCode).toBe(422);
  });
});
