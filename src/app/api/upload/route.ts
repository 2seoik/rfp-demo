import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { db } from "@/db";
import { organizations, projects, documents, jobs } from "@/db/schema";
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

    // 1. 파일 저장
    const uploadDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, `${Date.now()}_${file.name}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // 2. Organization 조회 (없으면 자동 생성)
    let orgRows = (await db.execute(sql`SELECT id FROM organizations LIMIT 1`)).rows ?? [];
    let org = orgRows[0] as { id: string } | undefined;
    if (!org) {
      const [newOrg] = await db.insert(organizations).values({ name: "기본 조직", plan: "free" }).returning();
      org = newOrg;
      console.log(`[UPLOAD] Organization 자동 생성: ${org.id}`);
    }

    // 3. Project + Document 생성
    const [project] = await db.insert(projects).values({
      orgId: org.id,
      name: projectName,
      status: "analyzing",
    }).returning();

    const [doc] = await db.insert(documents).values({
      orgId: org.id,
      projectId: project.id,
      type: "rfp",
      name: file.name,
      fileUrl: filePath,
      parsedStatus: "pending",
    }).returning();

    // 4. Job 등록 (Worker가 처리)
    await db.insert(jobs).values({
      type: "rfp_analyze",
      status: "pending",
      projectId: project.id,
      documentId: doc.id,
      progress: 0,
      message: "작업 대기 중...",
    });

    console.log(`[UPLOAD] 프로젝트 ${project.id} 생성, job 등록 완료`);

    return NextResponse.json({
      projectId: project.id,
      message: "파일 업로드 완료. 분석을 시작합니다.",
    }, { status: 201 });

  } catch (error: any) {
    console.error("[UPLOAD] 오류:", error.message);
    return NextResponse.json({ error: error.message || "업로드 실패" }, { status: 500 });
  }
}
