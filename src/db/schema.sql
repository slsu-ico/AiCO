CREATE TABLE IF NOT EXISTS offices (
  id BIGSERIAL PRIMARY KEY,
  name text NOT NULL,
  abbreviation text,
  contact_email text,
  contact_number text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  office_id bigint REFERENCES offices(id) ON DELETE SET NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'office_user')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_requests (
  id BIGSERIAL PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  requested_office_name text,
  office_id bigint REFERENCES offices(id) ON DELETE SET NULL,
  position text NOT NULL,
  reason text,
  remarks text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_info')),
  admin_note text,
  reviewed_by bigint REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_items (
  id BIGSERIAL PRIMARY KEY,
  office_id bigint NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('citizens_charter_service', 'faq', 'event', 'project', 'program', 'activity')),
  current_published_version_id bigint,
  published_service_id text,
  active boolean NOT NULL DEFAULT true,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_versions (
  id BIGSERIAL PRIMARY KEY,
  content_item_id bigint NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'published', 'rejected', 'needs_revision', 'archived')),
  title text NOT NULL,
  body text,
  structured_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_by bigint REFERENCES users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by bigint REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, version_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_items_current_published_version_fk'
  ) THEN
    ALTER TABLE content_items
      ADD CONSTRAINT content_items_current_published_version_fk
      FOREIGN KEY (current_published_version_id)
      REFERENCES content_versions(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS published_service_id text;

UPDATE content_items ci
SET published_service_id = lower(trim(coalesce(
  cv.structured_payload->>'id',
  cv.structured_payload->>'service_id'
)))
FROM content_versions cv
WHERE cv.id = ci.current_published_version_id
  AND ci.content_type = 'citizens_charter_service'
  AND nullif(trim(coalesce(
    cv.structured_payload->>'id',
    cv.structured_payload->>'service_id'
  )), '') IS NOT NULL
  AND ci.published_service_id IS DISTINCT FROM lower(trim(coalesce(
    cv.structured_payload->>'id',
    cv.structured_payload->>'service_id'
  )));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM content_items ci
    JOIN content_versions cv ON cv.id = ci.current_published_version_id
    WHERE ci.active = true
      AND cv.status = 'published'
      AND (
        (
          ci.content_type = 'citizens_charter_service'
          AND (
            lower(trim(coalesce(cv.structured_payload->>'id', cv.structured_payload->>'service_id', '')))
              !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
            OR lower(coalesce(cv.structured_payload->>'audience', '')) NOT IN ('internal', 'external')
            OR nullif(trim(coalesce(
              cv.structured_payload->>'service_name',
              cv.structured_payload->>'title'
            )), '') IS NULL
            OR nullif(trim(coalesce(
              cv.structured_payload->>'description',
              cv.structured_payload->>'body'
            )), '') IS NULL
            OR nullif(trim(cv.structured_payload->>'office_or_unit'), '') IS NULL
            OR nullif(trim(cv.structured_payload->>'classification'), '') IS NULL
            OR nullif(trim(cv.structured_payload->>'who_may_avail'), '') IS NULL
            OR trim(coalesce(cv.structured_payload->>'official_link', ''))
              !~* '^https?://[^[:space:]]+$'
            OR nullif(trim(cv.structured_payload->>'fees'), '') IS NULL
            OR nullif(trim(cv.structured_payload->>'processing_time'), '') IS NULL
            OR nullif(trim(cv.structured_payload->>'css_reminder'), '') IS NULL
            OR NOT coalesce(
              CASE
                WHEN jsonb_typeof(cv.structured_payload->'requirements') = 'array'
                  THEN EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(cv.structured_payload->'requirements') AS item(value)
                    WHERE nullif(trim(item.value), '') IS NOT NULL
                  )
                ELSE nullif(trim(cv.structured_payload->>'requirements'), '') IS NOT NULL
              END,
              false
            )
            OR NOT coalesce(
              CASE
                WHEN jsonb_typeof(cv.structured_payload->'submission_timeline') = 'array'
                  THEN EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(
                      cv.structured_payload->'submission_timeline'
                    ) AS item(value)
                    WHERE nullif(trim(item.value), '') IS NOT NULL
                  )
                ELSE nullif(trim(coalesce(
                  cv.structured_payload->>'submission_timeline',
                  cv.structured_payload->>'procedure'
                )), '') IS NOT NULL
              END,
              false
            )
          )
        )
        OR (
          ci.content_type = 'faq'
          AND (
            nullif(trim(coalesce(
              cv.structured_payload->>'question',
              cv.structured_payload->>'title'
            )), '') IS NULL
            OR nullif(trim(coalesce(
              cv.structured_payload->>'answer',
              cv.structured_payload->>'body'
            )), '') IS NULL
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Published chatbot content does not satisfy the canonical payload contract.'
      USING HINT = 'Audit and backfill legacy service/FAQ payloads before rerunning the migration.';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS review_notes (
  id BIGSERIAL PRIMARY KEY,
  content_version_id bigint NOT NULL REFERENCES content_versions(id) ON DELETE CASCADE,
  reviewer_id bigint REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id BIGSERIAL PRIMARY KEY,
  linked_type text NOT NULL,
  linked_id bigint NOT NULL,
  original_filename text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size >= 0),
  uploaded_by bigint REFERENCES users(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_requests_status ON account_requests(status);
CREATE INDEX IF NOT EXISTS idx_users_email_active ON users(email) WHERE active = true;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE active = true
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add active-user email uniqueness: case-insensitive duplicates exist.'
      USING HINT = 'Deactivate or merge duplicate active users, then rerun the migration.';
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active_unique
  ON users(lower(email))
  WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_content_items_office_type ON content_items(office_id, content_type);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM content_items
    WHERE active = true
      AND published_service_id IS NOT NULL
    GROUP BY published_service_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add published service ID uniqueness: duplicate IDs exist.'
      USING HINT = 'Assign unique IDs to duplicate published services, then rerun the migration.';
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_items_published_service_id_unique
  ON content_items(published_service_id)
  WHERE active = true AND published_service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_versions_status ON content_versions(status);
CREATE INDEX IF NOT EXISTS idx_content_versions_item_status ON content_versions(content_item_id, status);
CREATE INDEX IF NOT EXISTS idx_content_versions_published ON content_versions(published_at DESC, id DESC) WHERE status = 'published';

-- Supabase exposes public tables via PostgREST. This app uses DATABASE_URL (server-side
-- postgres), not the anon/authenticated API. Enable RLS with no permissive policies so
-- anon/authenticated cannot read or write; the backend connection bypasses RLS as postgres.
ALTER TABLE offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
