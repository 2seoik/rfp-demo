-- M3: requirements 중복 저장 방지
-- (project_id, original_id) UNIQUE constraint
-- original_id가 NULL인 경우는 중복 허용 (NULL ≠ NULL in SQL)

ALTER TABLE requirements
ADD CONSTRAINT uq_project_requirement_id
UNIQUE (project_id, original_id);

-- 참고: original_id가 NULL인 요구사항은 UNIQUE 제약에서 제외됨
-- (PostgreSQL에서 NULL 값은 서로 다르다고 간주)
