# Assessment Platform

Production-oriented school assessment backend: classes, students, assessments,
submissions, marking, moderation, release and audit.

## Why this exists

Assessment software is a chain of custody problem. A student submits once, a
marker scores it, a moderator can adjust it, and the result cannot be released
until moderation is complete. This service models that state machine explicitly.

## Stack

- TypeScript, Node.js, Fastify
- PostgreSQL (`pg`), SQL schema migration on boot
- Zod validation
- SHA-256 attachment evidence
- Vitest + `pg-mem` integration tests
- Multi-stage Dockerfile
- GitHub Actions CI

## Features

- Classes with teachers, and students assigned to a class
- Assessments with total marks, due date and open status
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

This is a real, tested assessment workflow, not a full LMS. It does not store
files, run plagiarism checks, author question banks, integrate with SMS/LMS, or
handle timetable/attendance. The README does not claim production usage.
