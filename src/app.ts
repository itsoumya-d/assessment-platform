import Fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { Database } from "./db.js";
import { AssessmentService, NotFoundError, ValidationError } from "./service.js";
import { FormEngineService, FormDefinitionSchema } from "./forms.js";

const classSchema = z.object({ code: z.string().min(1), name: z.string().min(1), teacher: z.string().min(1) });
const studentSchema = z.object({ code: z.string().min(1), name: z.string().min(1), class_id: z.number().int().positive() });
const assessmentSchema = z.object({ code: z.string().min(1), title: z.string().min(1), class_id: z.number().int().positive(), total_marks: z.number().int().positive(), due_date: z.string() });
const submitSchema = z.object({ assessment_id: z.number().int().positive(), student_id: z.number().int().positive(), content: z.string().min(1), attachment_sha256: z.string().optional() });
const markSchema = z.object({ marker: z.string().min(1), score: z.number().int().min(0), feedback: z.string().min(1) });
const moderateSchema = z.object({ moderator: z.string().min(1), score: z.number().int().min(0) });
const actorSchema = z.object({ actor: z.string().min(1) });
const reconcileSchema = z.object({ actor: z.string().min(1), reason: z.string().min(1) });
const validateFormInputSchema = z.object({ values: z.record(z.unknown()) });

export function buildApp(db: Database, apiKey: string): FastifyInstance {
  const app = Fastify({ logger: false });
  const service = new AssessmentService(db);
  const forms = new FormEngineService(db);

  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health") return;
    if (request.headers["x-api-key"] !== apiKey) reply.code(401).send({ error: "missing or invalid API key" });
  });

  const handle = (e: unknown) => {
    if (e instanceof NotFoundError) return { status: 404, body: { error: e.message } };
    if (e instanceof ValidationError) return { status: 422, body: { error: e.message } };
    if (e instanceof z.ZodError) return { status: 422, body: { error: e.issues } };
    return { status: 422, body: { error: e instanceof Error ? e.message : "invalid request" } };
  };

  app.get("/health", async () => ({ status: "ok" }));
  app.post("/classes", async (request, reply) => { try { const b = classSchema.parse(request.body); return reply.code(201).send(await service.createClass(b.code, b.name, b.teacher)); } catch (e) { const r = handle(e); return reply.code(r.status).send(r.body); } });
  app.post("/students", async (request, reply) => { try { const b = studentSchema.parse(request.body); return reply.code(201).send(await service.createStudent(b.code, b.name, b.class_id)); } catch (e) { const r = handle(e); return reply.code(r.status).send(r.body); } });
  app.post("/assessments", async (request, reply) => { try { const b = assessmentSchema.parse(request.body); return reply.code(201).send(await service.createAssessment(b.code, b.title, b.class_id, b.total_marks, b.due_date)); } catch (e) { const r = handle(e); return reply.code(r.status).send(r.body); } });
  app.post("/submissions", async (request, reply) => { try { const b = submitSchema.parse(request.body); return reply.code(201).send(await service.submit(b.assessment_id, b.student_id, b.content, b.attachment_sha256)); } catch (e) { const r = handle(e); return reply.code(r.status).send(r.body); } });
  app.post("/submissions/:id/mark", async (request, reply) => { try { const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id); const b = markSchema.parse(request.body); return await service.mark(id, b.marker, b.score, b.feedback); } catch (e) { const r = handle(e); return reply.code(r.status).send(r.body); } });
  app.post("/submissions/:id/moderate", async (request, reply) => { try { const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id); const b = moderateSchema.parse(request.body); return await service.moderate(id, b.moderator, b.score); } catch (e) { const r = handle(e); return reply.code(r.status).send(r.body); } });
  app.post("/submissions/:id/release", async (request, reply) => { try { const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id); const b = actorSchema.parse(request.body); return await service.release(id, b.actor); } catch (e) { const r = handle(e); return reply.code(r.status).send(r.body); } });
  app.get("/submissions/:id/result", async (request, reply) => { try { const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id); return await service.result(id); } catch (e) { const r = handle(e); return reply.code(r.status).send(r.body); } });
  app.get("/submissions/:id/activities", async (request, reply) => { try { const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id); return { activities: await service.activities(id) }; } catch (e) { const r = handle(e); return reply.code(r.status).send(r.body); } });
  app.get("/admin/diagnostics/integrity", async () => { return await service.auditIntegrity(); });
  app.post("/admin/reconcile/:id", async (request, reply) => { try { const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id); const b = reconcileSchema.parse(request.body); return await service.reconcileSubmission(id, b.actor, b.reason); } catch (e) { const r = handle(e); return reply.code(r.status).send(r.body); } });

  // Configurable dynamic form rendering engine endpoints
  app.post("/forms", async (request, reply) => {
    try {
      const def = FormDefinitionSchema.parse(request.body);
      const res = await forms.registerForm(def);
      return reply.code(201).send(res);
    } catch (e) {
      const r = handle(e);
      return reply.code(r.status).send(r.body);
    }
  });

  app.get("/forms/:code", async (request, reply) => {
    try {
      const code = (request.params as { code: string }).code;
      return await forms.getForm(code);
    } catch (e) {
      const r = handle(e);
      return reply.code(r.status).send(r.body);
    }
  });

  app.post("/forms/:code/validate", async (request, reply) => {
    try {
      const code = (request.params as { code: string }).code;
      const b = validateFormInputSchema.parse(request.body);
      const result = await forms.validateSubmission(code, b.values as Record<string, unknown>);
      return reply.code(200).send(result);
    } catch (e) {
      const r = handle(e);
      return reply.code(r.status).send(r.body);
    }
  });

  return app;
}
