import { db } from "@/db";
import { projects, requirements, documents } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const rows = await db.execute(sql`
      SELECT
        p.id,
        p.name,
        p.status,
        p.created_at,
        p.updated_at,
        COUNT(DISTINCT r.id)::int AS requirement_count,
        COUNT(DISTINCT d.id)::int AS document_count
      FROM projects p
      LEFT JOIN requirements r ON r.project_id = p.id
      LEFT JOIN documents d ON d.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `);

    return NextResponse.json(rows.rows ?? []);
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orgResult = await db.execute(sql`
      SELECT id FROM organizations LIMIT 1
    `);
    const orgRow = (orgResult.rows ?? [])[0] as { id: string } | undefined;

    if (!orgRow) {
      return NextResponse.json({ error: "No organization found" }, { status: 400 });
    }

    const [project] = await db
      .insert(projects)
      .values({
        orgId: orgRow.id,
        name: body.name,
        status: "draft",
      })
      .returning();

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
