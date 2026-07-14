import { db } from "drizzle";
import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import ProjectClient from "./ProjectClient";

type Requirement = {
  id: string;
  original_id: string | null;
  name: string | null;
  source_text: string;
  type: string;
  priority: string;
  status: string;
  order: number;
  draft_text: string | null;
  final_text: string | null;
  confidence_label: string | null;
  citations: any[];
};

type ProjectData = {
  project: any;
  requirements: Requirement[];
  documents: any[];
};

async function getProjectData(id: string): Promise<ProjectData | null> {
  try {
    const [project] = (await db.execute(sql`
      SELECT p.*, d2.header_text
      FROM projects p
      LEFT JOIN documents d2 ON d2.project_id = p.id AND d2.type = 'rfp'
      WHERE p.id = ${id}::uuid
      LIMIT 1
    `)).rows ?? [];

    if (!project) return null;

    // 사업명 추출
    const ht = (project as any).header_text || "";
    let bizName = "";
    const m = /(?:사\s*업\s*명|사업명)\s*[:：]?\s*(.+?)(?:\n|$)/gi.exec(ht);
    if (m) {
      const c = m[1].trim();
      if (c.length >= 5 && !/^[·.\s\d]+$/.test(c)) {
        bizName = c.replace(/\t/g, "").replace(/\s{2,}/g, " ");
      }
    }
    (project as any).biz_name = bizName;

    const reqs = (await db.execute(sql`
      SELECT
        req.id,
        req.original_id,
        req.name,
        req.source_text,
        req.type,
        req.priority,
        req.status,
        req."order",
        res.draft_text,
        res.final_text,
        res.confidence_label,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'chunk_id', cit.chunk_id,
            'score', cit.score,
            'content', dc.content,
            'page', dc.page,
            'doc_name', d.name
          ))
          FROM responses r2
          LEFT JOIN citations cit ON cit.response_id = r2.id
          LEFT JOIN document_chunks dc ON dc.id = cit.chunk_id
          LEFT JOIN documents d ON d.id = dc.document_id
          WHERE r2.requirement_id = req.id
          LIMIT 3),
          '[]'::json
        ) AS citations
      FROM requirements req
      LEFT JOIN responses res ON res.requirement_id = req.id
      WHERE req.project_id = ${id}::uuid
      ORDER BY req."order"
    `)).rows ?? [];

    const docs = (await db.execute(sql`
      SELECT id, name, type, parsed_status, created_at
      FROM documents
      WHERE project_id = ${id}::uuid
      ORDER BY created_at DESC
    `)).rows ?? [];

    return { project, requirements: reqs as Requirement[], documents: docs as any[] };
  } catch (error) {
    console.error("Failed to fetch project:", error);
    return null;
  }
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ analyzing?: string }>;
}) {
  const { id } = await params;
  const { analyzing } = await searchParams;
  const data = await getProjectData(id);

  if (!data) {
    notFound();
  }

  return <ProjectClient data={data} autoAnalyze={analyzing === "1"} />;
}
