import { db } from "@/db";
import { documents, requirements, responses } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import { readFileSync } from "fs";

function cleanText(text: string): string {
  return text.replace(/\t/g, " ").replace(/[ ]+/g, " ").replace(/ ·+/g, "")
    .replace(/^[ ]+/gm, "").replace(/\n{3,}/g, "\n\n").replace(/-- \d+ of \d+ --/g, "").trim();
}

function sendEvent(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 1. 문서 조회
        sendEvent(controller, { step: "start", progress: 0, message: "분석 준비 중..." });

        const docRows = (await db.execute(sql`
          SELECT id, file_url, parsed_status FROM documents WHERE project_id = ${id}::uuid LIMIT 1
        `)).rows ?? [];
        const doc = docRows[0] as { id: string; file_url: string; parsed_status: string } | undefined;

        if (!doc) {
          sendEvent(controller, { step: "error", message: "분석할 문서를 찾을 수 없습니다." });
          controller.close();
          return;
        }

        await db.update(documents).set({ parsedStatus: "parsing" }).where(eq(documents.id, doc.id));

        // 2. PDF 파싱
        sendEvent(controller, { step: "parsing", progress: 10, message: "PDF 파싱 중..." });

        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: readFileSync(doc.file_url as string) });
        const result = await parser.getText();
        await parser.destroy();
        const text = cleanText(result.text);

        // 3. 청킹
        sendEvent(controller, { step: "chunking", progress: 25, message: "텍스트 청킹 중..." });

        const CHUNK_SIZE = 1000;
        const OVERLAP = 100;
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

        sendEvent(controller, { step: "extracting", progress: 45, message: "AI 요구사항 추출 중... (최대 30초)" });

        // 4. LLM 호출
        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({
          baseURL: process.env.LLM_API_BASE,
          apiKey: process.env.LLM_API_KEY,
        });

        const response = await client.chat.completions.create({
          model: "mimo-v2.5",
          messages: [
            {
              role: "system",
              content: [
                "RFP 문서에서 요구사항 목록을 JSON 배열로 추출하세요.",
                "각 항목 형식: {\"id\":\"ECR-001\",\"name\":\"짧은제목\",\"sourceText\":\"요구사항내용\",\"type\":\"technical\",\"priority\":\"essential\"}",
                "id: 문서에 기재된 원본 ID (ECR-001, SFR-005)가 있으면 사용, 없으면 생략",
                "name: 짧은 제목",
                "sourceText: 요구사항 상세 내용",
                "JSON 배열만 출력.",
              ].join("\n"),
            },
            { role: "user", content: `RFP 문서:\n${excerpt}\n\n---\nJSON 배열 출력:` },
          ],
          temperature: 0.1,
          max_tokens: 8192,
        });

        const content = response.choices[0]?.message?.content || "";

        let reqs: any[] = [];
        try {
          const parsed = JSON.parse(content);
          reqs = Array.isArray(parsed) ? parsed : (parsed.requirements || []);
        } catch {
          const m = content.match(/\[[\s\S]*?\]/);
          if (m) try { reqs = JSON.parse(m[0]); } catch {}
        }

        // 5. 결과 저장
        sendEvent(controller, { step: "saving", progress: 70, message: `요구사항 ${reqs.length}개 저장 중...` });

        for (let i = 0; i < reqs.length; i++) {
          const r = reqs[i];
          const [req] = await db.insert(requirements).values({
            projectId: id,
            originalId: r.originalId || r.id || null,
            sourceText: (r.sourceText || r.name || "").slice(0, 1000),
            type: r.type || "technical",
            priority: r.priority || "essential",
            status: "pending",
            order: i + 1,
          }).returning();
          await db.insert(responses).values({ requirementId: req.id, confidenceLabel: "insufficient" });

          // 저장 진행률 (70~95%)
          if (i % Math.max(1, Math.floor(reqs.length / 5)) === 0) {
            const p = 70 + Math.round((i / reqs.length) * 25);
            sendEvent(controller, { step: "saving", progress: p, message: `요구사항 ${i + 1}/${reqs.length} 저장 중...` });
          }
        }

        // 6. 완료
        await db.update(documents).set({ parsedStatus: "ready" }).where(eq(documents.id, doc.id));
        await db.execute(sql`
          UPDATE projects SET status = ${reqs.length > 0 ? "review" : "draft"} WHERE id = ${id}::uuid
        `);

        sendEvent(controller, {
          step: "done",
          progress: 100,
          message: `✅ 분석 완료! ${reqs.length}개 요구사항이 추출되었습니다.`,
          requirementCount: reqs.length,
        });

        controller.close();

      } catch (error: any) {
        console.error("분석 실패:", error.message);

        // 에러 상태 업데이트
        try {
          const errDocRows = (await db.execute(sql`
            SELECT id FROM documents WHERE project_id = ${id}::uuid LIMIT 1
          `)).rows ?? [];
          const errDoc = errDocRows[0] as { id: string } | undefined;
          if (errDoc) {
            await db.update(documents).set({ parsedStatus: "error" }).where(eq(documents.id, errDoc.id));
          }
        } catch {}

        sendEvent(controller, { step: "error", message: `분석 중 오류가 발생했습니다: ${error.message}` });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
