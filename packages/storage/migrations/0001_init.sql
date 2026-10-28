-- Extension must be creatable by the migration role (or pre-installed by a DBA).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE releases (
  id                  text PRIMARY KEY,
  git_sha             text NOT NULL,
  status              text NOT NULL CHECK (status IN ('CANDIDATE','READY','ACTIVE','INACTIVE','PRUNED','FAILED')),
  artifact_path       text NOT NULL,
  embedding_model     text NOT NULL,
  embedding_dimensions int NOT NULL CHECK (embedding_dimensions > 0),
  docs_yaml           jsonb NOT NULL,
  manifest            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  ready_at            timestamptz,
  activated_at        timestamptz,
  deactivated_at      timestamptz,
  pruned_at           timestamptz
);
-- At most one ACTIVE release, ever.
CREATE UNIQUE INDEX releases_single_active ON releases ((true)) WHERE status = 'ACTIVE';
CREATE INDEX releases_created_idx ON releases (created_at DESC, id DESC);

CREATE TABLE builds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  git_sha      text,
  status       text NOT NULL CHECK (status IN ('RECEIVED','QUEUED','CHECKOUT','BUILDING','INDEXING','VALIDATING','READY','PUBLISHING','PUBLISHED','FAILED','SUPERSEDED')),
  trigger      text NOT NULL CHECK (trigger IN ('webhook','manual','install','reconcile')),
  release_id   text REFERENCES releases (id),
  k8s_job_name text,
  error        text,
  attempt      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at   timestamptz,
  finished_at  timestamptz
);
-- One non-terminal build per commit.
CREATE UNIQUE INDEX builds_open_sha_unique ON builds (git_sha)
  WHERE git_sha IS NOT NULL AND status NOT IN ('PUBLISHED','FAILED','SUPERSEDED');
-- Next queued build, oldest first.
CREATE INDEX builds_queued_idx ON builds (created_at, id) WHERE status = 'QUEUED';
CREATE INDEX builds_created_idx ON builds (created_at DESC, id DESC);
CREATE INDEX builds_release_idx ON builds (release_id) WHERE release_id IS NOT NULL;

CREATE TABLE build_events (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  build_id uuid NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  status   text NOT NULL,
  message  text,
  at       timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX build_events_build_idx ON build_events (build_id, id);

CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id   text NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  source_path  text NOT NULL,
  rendered_url text NOT NULL,
  title        text NOT NULL,
  checksum     text NOT NULL,
  UNIQUE (release_id, source_path)
);

CREATE TABLE document_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id  text NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  ordinal     int NOT NULL,
  heading     text,
  anchor      text,
  content     text NOT NULL,
  token_count int,
  embedding   vector NOT NULL
);
CREATE INDEX document_chunks_release_idx ON document_chunks (release_id);
CREATE INDEX document_chunks_document_idx ON document_chunks (document_id, ordinal);

-- ADR 0003: untyped vector column; enforce per-release dimension here.
CREATE FUNCTION document_chunks_check_dims() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected int;
BEGIN
  SELECT embedding_dimensions INTO expected FROM releases WHERE id = NEW.release_id;
  IF expected IS NULL THEN
    RAISE EXCEPTION 'unknown release %', NEW.release_id USING ERRCODE = '23503';
  END IF;
  IF vector_dims(NEW.embedding) <> expected THEN
    RAISE EXCEPTION 'embedding has % dimensions, release % expects %',
      vector_dims(NEW.embedding), NEW.release_id, expected USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER document_chunks_dims
  BEFORE INSERT OR UPDATE OF embedding, release_id ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION document_chunks_check_dims();

CREATE TABLE release_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id  text NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('CREATED','VALIDATED','ACTIVATED','DEACTIVATED','ROLLED_BACK','PRUNED','FAILED')),
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX release_events_release_idx ON release_events (release_id, id);
