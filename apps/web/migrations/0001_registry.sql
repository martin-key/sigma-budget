-- The release registry (docs/approach-specification.md, section 7.1; docs/release.md). One database per environment.
--   releases            every sealed candidate whose objects the server has read back and checked; `validated` after the structural checks
--   pointer             one row: the current release and a monotonic revision; publish and rollback are a single guarded UPDATE of it
--   journal             one row per change of the pointer, written by the trigger in the same transaction; request_id is unique, so a
--                       repeated publish cannot write a second event, and a trigger error undoes the change
--   operations          an upload in progress; sealed once every object is verified, then immutable
--   operation_objects   the objects an operation needs (inputs, outputs and the manifest), by sha256
--   incidents           an object under its sha256 key whose bytes do not hash to it: never published, repaired separately

CREATE TABLE releases (
  release_id      TEXT PRIMARY KEY CHECK (length(release_id) = 64),
  data_schema     TEXT NOT NULL,                     -- JSON object of the manifest
  state           TEXT NOT NULL CHECK (state IN ('candidate', 'validated')),
  objects         INTEGER NOT NULL,
  bytes           INTEGER NOT NULL,
  checks          TEXT NOT NULL,                     -- JSON: the structural checks of the server
  operation_id    TEXT NOT NULL,
  sealed_at       TEXT NOT NULL
);

CREATE TABLE pointer (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  release_id      TEXT REFERENCES releases (release_id),
  revision        INTEGER NOT NULL CHECK (revision >= 0),
  kind            TEXT,
  request_id      TEXT,
  payload_sha256  TEXT,
  operator        TEXT,
  at              TEXT
);
INSERT INTO pointer (id, release_id, revision) VALUES (1, NULL, 0);

CREATE TABLE journal (
  seq                  INTEGER PRIMARY KEY AUTOINCREMENT,
  revision             INTEGER NOT NULL UNIQUE,
  release_id           TEXT NOT NULL,
  previous_release_id  TEXT,
  kind                 TEXT NOT NULL CHECK (kind IN ('publish', 'rollback')),
  request_id           TEXT NOT NULL UNIQUE,
  payload_sha256       TEXT NOT NULL,
  operator             TEXT NOT NULL,                -- internal; the public journal shows only the role and a pseudonym
  at                   TEXT NOT NULL
);

CREATE TRIGGER pointer_journal AFTER UPDATE OF revision ON pointer
WHEN NEW.revision <> OLD.revision
BEGIN
  INSERT INTO journal (revision, release_id, previous_release_id, kind, request_id, payload_sha256, operator, at)
  VALUES (NEW.revision, NEW.release_id, OLD.release_id, NEW.kind, NEW.request_id, NEW.payload_sha256, NEW.operator, NEW.at);
END;

CREATE TRIGGER pointer_one_step BEFORE UPDATE OF revision ON pointer
WHEN NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'the revision moves by one');
END;

CREATE TABLE operations (
  operation_id    TEXT PRIMARY KEY,
  release_id      TEXT NOT NULL CHECK (length(release_id) = 64),
  state           TEXT NOT NULL CHECK (state IN ('open', 'sealed')),
  operator        TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE operation_objects (
  operation_id    TEXT NOT NULL REFERENCES operations (operation_id),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64),
  bytes           INTEGER NOT NULL CHECK (bytes >= 0),
  role            TEXT NOT NULL CHECK (role IN ('manifest', 'input', 'output')),
  verified        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (operation_id, sha256)
);

CREATE TABLE incidents (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256          TEXT NOT NULL,
  found           TEXT NOT NULL,
  operation_id    TEXT,
  at              TEXT NOT NULL
);
