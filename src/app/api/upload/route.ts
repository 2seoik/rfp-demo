import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { db } from "@/db";
import { organizations, projects, documents, requirements, responses } from "@/db/schema";
import { sql, eq } from "drizzle-orm";

function cleanText(text: string): string {
  return text.replace(/\t/g, " ").replace(/[ ]+/g, " ").replace(/ ·+/g, "")
    .replace(/^[ ]+/gm, "").replace(/\n{3,}/g, "\n\n").replace(/-- \d+ of \d+ --/g, "").trim();
}

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

    const uploadDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, `${Date.now()}_${file.name}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const [org] = (await db.execute(sql`SELECT id FROM organizations LIMIT 1`)).rows ?? [];
    if (!org) return NextResponse.json({ error: "조직 없음" }, { status: 400 });

    const [project] = await db.insert(projects).values({
      orgId: org.id, name: projectName, status: "analyzing",
    }).returning();

    await db.insert(documents).values({
      orgId: org.id, projectId: project.id, type: "rfp",
      name: file.name, fileUrl: filePath, parsedStatus: "parsing",
    });

    let reqCount = 0;
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      const text = cleanText(result.text);

      const bodyStart = ["Ⅲ. 제안요청 내용", "Ⅲ 제안요청 내용", "Ⅳ. 제안요청 내용"]
        .reduce((pos, m) => { const i = text.indexOf(m); return i >= 0 ? i : pos; }, Math.floor(text.length * 0.25));

      const reqSection = ["요구사항 목록표", "요구사항 상세", "요구사항 목록", "주요 과업", "요구사항 총괄표"]
        .reduce((section, m) => { const i = text.indexOf(m, bodyStart); return i >= 0 ? text.slice(Math.max(0, i - 50), i + 6000) : section; }, text.slice(bodyStart, bodyStart + 7000));

      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ baseURL: process.env.LLM_API_BASE, apiKey: process.env.LLM_API_KEY });

      const systemPrompt = [
        "RFP 문서에서 요구사항 목록을 JSON 배열로 추출하세요.",
        "각 항목 형식: {\"id\":\"ECR-001\",\"name\":\"짧은제목\",\"sourceText\":\"요구사항내용\",\"type\":\"technical\",\"priority\":\"essential\"}",
        "id: 문서에 기재된 원본 ID (ECR-001, SFR-005)가 있으면 사용, 없으면 생략",
        "name: 짧은 제목",
        "sourceText: 요구사항 상세 내용",
        "JSON 배열만 출력.",
      ].join("\n");

      let reqs: any[] = [];
      for (let attempt = 0; attempt < 2 && reqs.length === 0; attempt++) {
        const response = await client.chat.completions.create({
          model: "mimo-v2.5",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `RFP 문서:\n${reqSection}\n\n---\nJSON 배열 출력:` },
          ],
          temperature: 0.1 + attempt * 0.2,
          max_tokens: 8192,
        });

        const content = response.choices[0]?.message?.content || "";
        try { const p = JSON.parse(content); reqs = Array.isArray(p) ? p : (p.requirements || []); }
        catch { const m = content.match(/\[[\s\S]*?\]/); if (m) try { reqs = JSON.parse(m[0]); } catch {} }
      }

      for (let i = 0; i < reqs.length; i++) {
        const r = reqs[i];
        const [req] = await db.insert(requirements).values({
          projectId: project.id,
          originalId: r.originalId || r.id || null,
          sourceText: (r.sourceText || r.name || "").slice(0, 1000),
          type: r.type || "technical",
          priority: r.priority || "essential",
          status: "pending", order: i + 1,
        }).returning();
        await db.insert(responses).values({ requirementId: req.id, confidenceLabel: "insufficient" });
      }
      reqCount = reqs.length;
      await db.update(documents).set({ parsedStatus: "ready" }).where(eq(documents.id, project.id));
    } catch (e: any) {
      console.error("분석 오류:", e.message);
      await db.update(documents).set({ parsedStatus: "error" }).where(eq(documents.id, project.id));
    }

    await db.execute(sql`UPDATE projects SET status = ${reqCount > 0 ? "review" : "draft"} WHERE id = ${project.id}::uuid`);

    return NextResponse.json({
      projectId: project.id,
      requirementCount: reqCount,
      message: `업로드 완료! ${reqCount}개 요구사항이 추출되었습니다.`,
    }, { status: 201 });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || "업로드 실패" }, { status: 500 });
  }
}
