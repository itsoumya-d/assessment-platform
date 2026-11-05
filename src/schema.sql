CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  teacher TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id)
);
CREATE TABLE IF NOT EXISTS assessments (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  total_marks INTEGER NOT NULL CHECK (total_marks > 0),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
);
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  content TEXT NOT NULL,
  attachment_sha256 TEXT,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  raw_score INTEGER,
  moderated_score INTEGER,
  marker TEXT,
  feedback TEXT,
  moderator TEXT,
  UNIQUE (assessment_id, student_id)
);
CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
