// TODO: revisit at scale — 현재 document_chunks 테이블이 비어 있고(EMBEDDING_API_URL 미설정),
// 유사 RFP 검색은 requirements.source_text 직접 FTS(route.ts)로 동작 중.
// 프로젝트 수 증가 + 임베딩 API 확보 후 pgvector 하이브리드 검색으로 전환 검토.

import { db } from "@/db";
import { getEmbedding } from "./llm";
import { sql } from "drizzle-orm";

export type SearchResult = {
  chunkId: string;
  documentId: string;
  documentName: string;
  documentType: string;
  content: string;
  page: number | null;
  section: string | null;
  score: number;
};

/**
 * Hybrid search: combine keyword (tsvector) and semantic (pgvector) search.
 * Weight: 40% keyword + 60% semantic by default.
 */
export async function hybridSearch(
  query: string,
  options: {
    orgId: string;
    documentIds?: string[];
    docType?: string; // 'rfp' | 'knowledge' | undefined (모두 검색)
    topK?: number;
    keywordWeight?: number;
    semanticWeight?: number;
  }
): Promise<SearchResult[]> {
  const {
    orgId,
    documentIds,
    topK = 10,
    keywordWeight = 0.4,
    semanticWeight = 0.6,
  } = options;

  // 1. Get query embedding for semantic search
  const queryEmbedding = await getEmbedding(query);

  // Build document filter condition
  let filterParts: ReturnType<typeof sql>[] = [];
  if (documentIds && documentIds.length > 0) {
    const ids = documentIds.map((id) => `'${id}'`).join(",");
    filterParts.push(sql`dc.document_id IN (${sql.raw(ids)})`);
  }
  if (options.docType) {
    filterParts.push(sql`d.type = ${options.docType}`);
  }
  const docFilter = filterParts.length > 0
    ? sql`AND ${sql.join(filterParts, sql` AND `)}`
    : sql``;

  // 2. Execute hybrid search using raw SQL
  const results = await db.execute(sql`
    WITH semantic_scores AS (
      SELECT
        id,
        1 - (embedding <=> ${queryEmbedding}::vector) AS semantic_score
      FROM document_chunks
      WHERE embedding IS NOT NULL
      ${docFilter}
    ),
    keyword_scores AS (
      SELECT
        id,
        ts_rank(
          to_tsvector('simple', COALESCE(content, '')),
          plainto_tsquery('simple', ${query})
        ) AS keyword_score
      FROM document_chunks
      WHERE embedding IS NOT NULL
      ${docFilter}
    )
    SELECT
      c.id,
      c.document_id,
      d.name AS document_name,
      d.type AS document_type,
      c.content,
      c.page,
      c.section,
      COALESCE(s.semantic_score, 0) * ${semanticWeight} +
      COALESCE(k.keyword_score, 0) * ${keywordWeight} AS combined_score
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    LEFT JOIN semantic_scores s ON c.id = s.id
    LEFT JOIN keyword_scores k ON c.id = k.id
    WHERE c.embedding IS NOT NULL
    ORDER BY combined_score DESC
    LIMIT ${topK}
  `);

  return (results.rows ?? []).map((row: any) => ({
    chunkId: row.id,
    documentId: row.document_id,
    documentName: row.document_name,
    documentType: row.document_type,
    content: row.content,
    page: row.page,
    section: row.section,
    score: Math.round((row.combined_score ?? 0) * 100),
  }));
}
