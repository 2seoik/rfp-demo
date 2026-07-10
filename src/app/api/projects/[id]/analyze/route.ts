import { NextResponse } from "next/server";
import { db } from "@/db";
import { documents, requirements, responses } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import { readFileSync } from "fs";

function cleanText(text: string): string {
  return text.replace(/\t/g, " ").replace(/[ ]+/g, " ").replace(/ ·+/g, "")
    .replace(/^[ ]+/gm, "").replace(/\n{3,}/g, "\n\n").replace(/-- \d+ of \d+ --/g, "").trim();
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [doc] = (await db.execute(sql`
      SELECT id, file_url FROM documents WHERE project_id = ${id}::uuid LIMIT 1
    `)).rows ?? [];
    if (!doc) return NextResponse.json({ error: "문서 없음" }, { status: 404 });

    await db.update(documents).set({ parsedStatus: "parsing" }).where(eq(documents.id, doc.id));

    // Parse PDF
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: readFileSync(doc.file_url) });
    const result = await parser.getText();
    await parser.destroy();
    const text = cleanText(result.text);

    // Find requirements section (skip TOC)
    const bodyMarkers = ["Ⅲ. 제안요청 내용", "Ⅲ 제안요청 내용", "Ⅳ. 제안요청 내용"];
    let bodyStart = Math.floor(text.length * 0.25);
    for (const m of bodyMarkers) {
      const idx = text.indexOf(m);
      if (idx >= 0) { bodyStart = idx; break; }
    }

    const reqMarkers = ["요구사항 목록표", "요구사항 상세", "요구사항 목록", "주요 과업", "요구사항 총괄표"];
    let excerpt = text.slice(bodyStart, bodyStart + 6000);
    for (const m of reqMarkers) {
      const idx = text.indexOf(m, bodyStart);
      if (idx >= 0) {
        excerpt = text.slice(Math.max(0, idx - 50), idx + 5000);
        break;
      }
    }

    console.log(`분석: ${excerpt.length}자`);

    // Call LLM with simple prompt
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({
      baseURL: process.env.LLM_API_BASE,
      apiKey: process.env.LLM_API_KEY,
    });

    const response = await client.chat.completions.create({
      model: "mimo-v2.5",
      messages: [
        { role: "system", content: "RFP 요구사항 추출. JSON 배열만 출력. 각 항목: {\"id\":\"REQ-001\",\"sourceText\":\"요구사항\",\"type\":\"technical\",\"priority\":\"essential\"}" },
        { role: "user", content: `RFP:\n${excerpt}\n\n---\nJSON:` },
      ],
      temperature: 0.1,
      max_tokens: 8192, // Enough for reasoning tokens
    });

    const content = response.choices[0]?.message?.content || "";
    console.log(`LLM 응답: ${content.length}자`);

    let reqs: any[] = [];
    try {
      const parsed = JSON.parse(content);
      reqs = Array.isArray(parsed) ? parsed : (parsed.requirements || []);
    } catch {
      const m = content.match(/\[[\s\S]*?\]/);
      if (m) try { reqs = JSON.parse(m[0]); } catch {}
    }

    // Store requirements
    for (let i = 0; i < reqs.length; i++) {
      const [req] = await db.insert(requirements).values({
        projectId: id,
        sourceText: (reqs[i].sourceText || "").slice(0, 1000),
        type: reqs[i].type || "technical",
        priority: reqs[i].priority || "essential",
        status: "pending",
        order: i + 1,
      }).returning();
      await db.insert(responses).values({ requirementId: req.id, confidenceLabel: "insufficient" });
    }

    await db.update(documents).set({ parsedStatus: "ready" }).where(eq(documents.id, doc.id));
    await db.execute(sql`UPDATE projects SET status = ${reqs.length > 0 ? "review" : "draft"} WHERE id = ${id}::uuid`);

    return NextResponse.json({ requirementCount: reqs.length, message: `${reqs.length}개 요구사항 추출됨` });

  } catch (error: any) {
    console.error("분석 실패:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
