import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { db } from "@/db";
import { organizations, projects, documents } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectName = formData.get("name") as string || "새 RFP 분석";
    if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

    const ext = path.extname(file.name).toLowerCase();
    if (![".pdf", ".docx"].includes(ext)) {
      return NextResponse.json({ error: "PDF 또는 DOCX 파일만 지원합니다." }, { status: 400 });
    }

    // 파일 저장
    const uploadDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, `${Date.now()}_${file.name}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // Organization 조회
    const orgRows = (await db.execute(sql`SELECT id FROM organizations LIMIT 1`)).rows ?? [];
    const org = orgRows[0] as { id: string } | undefined;
    if (!org) return NextResponse.json({ error: "조직 없음" }, { status: 400 });

    // Project + Document 생성 (상태: analyzing)
    const [project] = await db.insert(projects).values({
      orgId: org.id,
      name: projectName,
      status: "analyzing",
    }).returning();

    await db.insert(documents).values({
      orgId: org.id,
      projectId: project.id,
      type: "rfp",
      name: file.name,
      fileUrl: filePath,
      parsedStatus: "parsing",
    });

    // 즉시 projectId 반환 (분석은 클라이언트에서 SSE로 별도 요청)
    return NextResponse.json({
      projectId: project.id,
      message: "파일 업로드 완료. 분석을 시작합니다.",
    }, { status: 201 });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || "업로드 실패" }, { status: 500 });
  }
}
