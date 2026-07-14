import { NextResponse } from "next/server";
import { db } from "drizzle";
import { jobs } from "drizzle/schema";
import { sql, eq, and, desc } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 해당 프로젝트의 가장 최근 rfp_analyze job 조회
    const [job] = (await db.execute(sql`
      SELECT
        status, progress, message, error, result, retry_count, created_at, updated_at
      FROM jobs
      WHERE project_id = ${id}::uuid AND type = 'rfp_analyze'
      ORDER BY created_at DESC
      LIMIT 1
    `)).rows ?? [];

    if (!job) {
      return NextResponse.json({ status: "not_found" });
    }

    return NextResponse.json(job);
  } catch (error: any) {
    console.error("Failed to fetch analyze status:", error);
    return NextResponse.json({ status: "error", error: error.message }, { status: 500 });
  }
}
