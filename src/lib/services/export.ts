import { db } from "@/db";
import { requirements, responses, citations, documents } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Generate XLSX export of requirement matrix with answers.
 * Uses HTML table approach for server-side XLSX generation.
 */
export async function exportRequirementMatrix(projectId: string) {
  const rows = await db.execute(sql`
    SELECT
      r.id,
      r.source_text,
      r.type,
      r.priority,
      r.status,
      r."order",
      res.draft_text,
      res.final_text,
      res.confidence_label,
      COALESCE(
        (SELECT json_agg(json_build_object(
          'content', dc.content,
          'page', dc.page,
          'score', cit.score,
          'doc_name', d.name
        ))
        FROM citations cit
        JOIN document_chunks dc ON dc.id = cit.chunk_id
        JOIN documents d ON d.id = dc.document_id
        WHERE cit.response_id = res.id
        LIMIT 3),
        '[]'::json
      ) AS citations
    FROM requirements r
    LEFT JOIN responses res ON res.requirement_id = r.id
    WHERE r.project_id = ${projectId}::uuid
    ORDER BY r."order"
  `);

  return rows.rows ?? [];
}

/**
 * Convert the requirement matrix to CSV format.
 */
export async function exportToCSV(projectId: string): Promise<string> {
  const rows = await exportRequirementMatrix(projectId);

  const headers = ["ID", "요구사항", "유형", "중요도", "상태", "답변(초안)", "답변(최종)", "신뢰도"];
  const csvLines = [headers.join(",")];

  for (const row of rows as any[]) {
    const line = [
      row.id,
      escapeCSV(row.source_text),
      row.type,
      row.priority,
      row.status,
      escapeCSV(row.draft_text ?? ""),
      escapeCSV(row.final_text ?? ""),
      row.confidence_label,
    ];
    csvLines.push(line.join(","));
  }

  return csvLines.join("\n");
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
