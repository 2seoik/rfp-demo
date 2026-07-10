import { db } from "@/db";
import { getEmbedding } from "./llm";
import { sql } from "drizzle-orm";

export type SearchResult = {
  chunkId: string;
  documentId: string;
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
  let docFilter = sql``;
  if (documentIds && documentIds.length > 0) {
    const ids = documentIds.map((id) => `'${id}'`).join(",");
    docFilter = sql`AND dc.document_id IN (${sql.raw(ids)})`;
  }

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
      c.content,
      c.page,
      c.section,
      COALESCE(s.semantic_score, 0) * ${semanticWeight} +
      COALESCE(k.keyword_score, 0) * ${keywordWeight} AS combined_score
    FROM document_chunks c
    LEFT JOIN semantic_scores s ON c.id = s.id
    LEFT JOIN keyword_scores k ON c.id = k.id
    WHERE c.embedding IS NOT NULL
    ORDER BY combined_score DESC
    LIMIT ${topK}
  `);

  return (results.rows ?? []).map((row: any) => ({
    chunkId: row.id,
    documentId: row.document_id,
    content: row.content,
    page: row.page,
    section: row.section,
    score: Math.round((row.combined_score ?? 0) * 100),
  }));
}
