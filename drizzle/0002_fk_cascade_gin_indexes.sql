-- 0002: FK ON DELETE CASCADE + GIN indexes for similar RFP search
-- 적용: pnpm db:push (또는 drizzle-kit migrate)
-- 주의: 운영 DB 적용 전 반드시 백업

-- ── FK ON DELETE CASCADE ──────────────────────────────────

-- documents.project_id → projects.id
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_project_id_projects_id_fk,
  ADD CONSTRAINT documents_project_id_projects_id_fk
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- document_chunks.document_id → documents.id
ALTER TABLE document_chunks
  DROP CONSTRAINT IF EXISTS document_chunks_document_id_documents_id_fk,
  ADD CONSTRAINT document_chunks_document_id_documents_id_fk
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;

-- requirements.project_id → projects.id
ALTER TABLE requirements
  DROP CONSTRAINT IF EXISTS requirements_project_id_projects_id_fk,
  ADD CONSTRAINT requirements_project_id_projects_id_fk
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- responses.requirement_id → requirements.id
ALTER TABLE responses
  DROP CONSTRAINT IF EXISTS responses_requirement_id_requirements_id_fk,
  ADD CONSTRAINT responses_requirement_id_requirements_id_fk
    FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE;

-- citations.response_id → responses.id
ALTER TABLE citations
  DROP CONSTRAINT IF EXISTS citations_response_id_responses_id_fk,
  ADD CONSTRAINT citations_response_id_responses_id_fk
    FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE;

-- citations.chunk_id → document_chunks.id
ALTER TABLE citations
  DROP CONSTRAINT IF EXISTS citations_chunk_id_document_chunks_id_fk,
  ADD CONSTRAINT citations_chunk_id_document_chunks_id_fk
    FOREIGN KEY (chunk_id) REFERENCES document_chunks(id) ON DELETE CASCADE;

-- jobs.project_id → projects.id
ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_project_id_projects_id_fk,
  ADD CONSTRAINT jobs_project_id_projects_id_fk
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- jobs.document_id → documents.id
ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_document_id_documents_id_fk,
  ADD CONSTRAINT jobs_document_id_documents_id_fk
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;

-- ── GIN indexes for Full-Text Search ────────────────────────
-- 유사 RFP 검색(§7.7)의 requirements.source_text + documents.header_text FTS 성능 최적화

CREATE INDEX IF NOT EXISTS idx_requirements_source_text_fts
  ON requirements USING GIN (to_tsvector('simple', source_text));

CREATE INDEX IF NOT EXISTS idx_documents_header_text_fts
  ON documents USING GIN (to_tsvector('simple', header_text));
