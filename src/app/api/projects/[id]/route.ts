import { db } from "@/db";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [project] = (await db.execute(sql`
      SELECT * FROM projects WHERE id = ${id}::uuid LIMIT 1
    `)).rows ?? [];

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const reqs = (await db.execute(sql`
      SELECT
        req.id,
        req.original_id,
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

    return NextResponse.json({ project, requirements: reqs, documents: docs });
  } catch (error) {
    console.error("Failed to fetch project:", error);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Delete in correct FK order
    await db.execute(sql`
      DELETE FROM citations
      WHERE response_id IN (
        SELECT id FROM responses WHERE requirement_id IN (
          SELECT id FROM requirements WHERE project_id = ${id}::uuid
        )
      )
    `);
    await db.execute(sql`
      DELETE FROM responses
      WHERE requirement_id IN (
        SELECT id FROM requirements WHERE project_id = ${id}::uuid
      )
    `);
    await db.execute(sql`DELETE FROM requirements WHERE project_id = ${id}::uuid`);
    await db.execute(sql`
      DELETE FROM document_chunks
      WHERE document_id IN (
        SELECT id FROM documents WHERE project_id = ${id}::uuid
      )
    `);
    await db.execute(sql`DELETE FROM documents WHERE project_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM projects WHERE id = ${id}::uuid`);

    return NextResponse.json({ message: "삭제되었습니다." });
  } catch (error: any) {
    console.error("Failed to delete project:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
