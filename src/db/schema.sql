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
CREATE INDEX IF NOT EXISTS idx_content_items_office_type ON content_items(office_id, content_type);
CREATE INDEX IF NOT EXISTS idx_content_versions_status ON content_versions(status);
CREATE INDEX IF NOT EXISTS idx_content_versions_item_status ON content_versions(content_item_id, status);
