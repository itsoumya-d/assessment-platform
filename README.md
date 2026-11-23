# Assessment Platform

Production-oriented assessment and workflow backend: classes, students, assessments,
submissions, marking, moderation, configurable dynamic forms engine, and audit.

## Why this exists

Assessment and clinical workflows are chain-of-custody and structured-data capture problems.
A workflow participant submits structured observations once, reviewers score and moderate,
and results transition through explicit state machines. Additionally, complex workflows
require configurable, schema-driven forms with conditional rules and strict runtime validation.

## Stack

- TypeScript, Node.js, Fastify
- PostgreSQL (`pg`), SQL schema migration on boot
- Zod schema validation
- Configurable dynamic forms engine with conditional logic and range constraints
- SHA-256 attachment evidence
- Vitest + `pg-mem` integration tests
- Multi-stage Dockerfile
- GitHub Actions CI

## Features

- Classes with teachers, and students assigned to a class
- Assessments with total marks, due date and open status
- Configurable form schema registration (`POST /forms`, `GET /forms/:code`)
- Dynamic form evaluation with conditional visibility and field constraint validation (`POST /forms/:code/validate`)
- One submission per student/assessment, with attachment hash
- Marking with score cap and feedback
- Moderation after marking
- Release gate requiring moderation
- Student-safe result endpoint (released only)
- Activity trail for submit/mark/moderate/release
- Health probe and consistent 401/404/422 responses

## Run locally

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/assessment API_KEY=dev-key npm run dev
```

## Test

```bash
npm test
npm run build
```

## Honest scope

This is a real, tested assessment and workflow service. It does not store
binary files on disk, run external plagiarism checks, or integrate directly with SMS/LMS.
The README does not claim production usage.
