import { createHash } from 'node:crypto';
const sql = `CREATE TABLE users (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 telegram_user_id bigint NOT NULL UNIQUE CHECK (telegram_user_id > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_projects (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(trim(name)) > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_user_idx ON audit_projects(user_id);
CREATE TABLE organizations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id bigint NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('own','competitor')),
 name text NOT NULL CHECK (length(trim(name)) > 0),
 city text NOT NULL, address text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,project_id)
);
CREATE UNIQUE INDEX one_own_organization_per_project ON organizations(project_id) WHERE role='own';
CREATE INDEX organizations_project_idx ON organizations(project_id);
CREATE TABLE source_cards (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id bigint NOT NULL,
 organization_id bigint NOT NULL,
 source text NOT NULL CHECK (source IN ('2gis','yandex')),
 external_id text NOT NULL, url text NOT NULL,
 match_status text NOT NULL DEFAULT 'unverified' CHECK (match_status IN ('unverified','verified','rejected')),
 verified_at timestamptz,
 FOREIGN KEY (organization_id,project_id) REFERENCES organizations(id,project_id) ON DELETE CASCADE,
 UNIQUE(organization_id,source), UNIQUE(id,project_id),
 CHECK ((match_status='verified') = (verified_at IS NOT NULL))
);
CREATE TABLE collection_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id bigint NOT NULL, source_card_id bigint NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','partial','failed')),
 error_code text CHECK (error_code IN ('captcha','rate_limited','forbidden','timeout','layout_changed','unavailable','invalid_data')),
 collected_count integer NOT NULL DEFAULT 0 CHECK (collected_count >= 0),
 started_at timestamptz, finished_at timestamptz,
 FOREIGN KEY (source_card_id,project_id) REFERENCES source_cards(id,project_id) ON DELETE CASCADE,
 UNIQUE(id,project_id)
);
CREATE UNIQUE INDEX one_active_collection_per_card ON collection_runs(source_card_id) WHERE status IN ('pending','running');
CREATE TABLE reviews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id bigint NOT NULL, source_card_id bigint NOT NULL,
 external_id text, dedup_key text NOT NULL CHECK (length(trim(dedup_key)) > 0),
 text text NOT NULL, rating smallint CHECK (rating BETWEEN 1 AND 5),
 published_at timestamptz, updated_at_source timestamptz, raw_date text,
 collected_at timestamptz NOT NULL DEFAULT now(), source_url text,
 content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
 FOREIGN KEY (source_card_id,project_id) REFERENCES source_cards(id,project_id) ON DELETE CASCADE,
 UNIQUE(source_card_id,dedup_key), UNIQUE(source_card_id,external_id), UNIQUE(id,project_id)
);
CREATE INDEX reviews_card_date_idx ON reviews(source_card_id,published_at);
CREATE TABLE review_analyses (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id bigint NOT NULL, review_id bigint NOT NULL,
 content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
 model text NOT NULL, prompt_version text NOT NULL, schema_version text NOT NULL,
 result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (review_id,project_id) REFERENCES reviews(id,project_id) ON DELETE CASCADE,
 UNIQUE(review_id,content_hash,model,prompt_version,schema_version)
);
CREATE TABLE audit_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id bigint NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','partial','failed')),
 stage text NOT NULL DEFAULT 'collection' CHECK (stage IN ('collection','analysis','report')),
 period_from timestamptz, period_to timestamptz,
 started_at timestamptz, finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,project_id), CHECK (period_from IS NULL OR period_to IS NULL OR period_from <= period_to)
);
CREATE UNIQUE INDEX one_active_audit_per_project ON audit_runs(project_id) WHERE status IN ('pending','running');
CREATE TABLE reports (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id bigint NOT NULL, audit_run_id bigint NOT NULL UNIQUE,
 summary text NOT NULL, markdown text NOT NULL,
 metrics jsonb NOT NULL CHECK (jsonb_typeof(metrics)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (audit_run_id,project_id) REFERENCES audit_runs(id,project_id) ON DELETE CASCADE
);`;
export const migrations = [{version: '001_initial', sql, checksum: createHash('sha256').update(sql).digest('hex')}];
