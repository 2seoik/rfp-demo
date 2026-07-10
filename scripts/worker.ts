import { db } from "../src/db";
import { jobs, projects, documents, requirements, responses } from "../src/db/schema";
import { sql, eq, and, desc } from "drizzle-orm";
import { readFileSync } from "fs";

// ─── Utils ─────────────────────────────────────────────────
function cleanText(text: string): string {
  return text
    .replace(/\t/g, " ")
    .replace(/[ ]+/g, " ")
    .replace(/ ·+/g, "")
    .replace(/^[ ]+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/-- \d+ of \d+ --/g, "")
    .trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(jobId: string, msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}][${jobId.slice(0, 8)}] ${msg}`);
}

// ─── Job Progress Updater ──────────────────────────────────
async function updateJob(jobId: string, updates: Partial<typeof jobs.$inferInsert>) {
  await db.update(jobs).set({ ...updates, updatedAt: new Date() }).where(eq(jobs.id, jobId));
}

// ─── Job Handlers ──────────────────────────────────────────
async function handleRfpAnalyze(job: typeof jobs.$inferSelect) {
  const { id: jobId, projectId, documentId } = job;
  if (!projectId || !documentId) throw new Error("projectId/documentId 누락");

  log(jobId, "🔍 RFP 분석 시작");

  // 1. PDF 파싱
  await updateJob(jobId, { progress: 5, message: "PDF 파싱 중..." });

  const [doc] = (await db.execute(sql`
    SELECT file_url FROM documents WHERE id = ${documentId}::uuid LIMIT 1
  `)).rows as { file_url: string }[];

  if (!doc) throw new Error("문서를 찾을 수 없습니다.");

  await db.update(documents).set({ parsedStatus: "parsing" }).where(eq(documents.id, documentId));

  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: readFileSync(doc.file_url) });
  const result = await parser.getText();
  await parser.destroy();
  const text = cleanText(result.text);

  log(jobId, `📄 PDF 파싱 완료 (${text.length}자)`);

  // 2. 요구사항 섹션 찾기
  await updateJob(jobId, { progress: 25, message: "요구사항 섹션 찾는 중..." });

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

  log(jobId, `📋 요구사항 섹션 추출 (${excerpt.length}자)`);

  // 3. LLM 호출
  await updateJob(jobId, { progress: 45, message: "AI 요구사항 추출 중... (최대 30초)" });

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    baseURL: process.env.LLM_API_BASE,
    apiKey: process.env.LLM_API_KEY,
  });

  const llmResponse = await client.chat.completions.create({
    model: process.env.LLM_MODEL || "mimo-v2.5",
    messages: [
      {
        role: "system",
        content: [
          "RFP 문서에서 요구사항 목록을 JSON 배열로 추출하세요.",
          "각 항목 형식: {\"id\":\"ECR-001\",\"name\":\"짧은제목\",\"sourceText\":\"요구사항내용\",\"type\":\"technical\",\"priority\":\"essential\"}",
          "id: 문서에 기재된 원본 ID (ECR-001, SFR-005)가 있으면 사용, 없으면 생략",
          "sourceText: 요구사항 상세 내용",
          "JSON 배열만 출력.",
        ].join("\n"),
      },
      { role: "user", content: `RFP 문서:\n${excerpt}\n\n---\nJSON 배열 출력:` },
    ],
    temperature: 0.1,
    max_tokens: 8192,
  });

  const content = llmResponse.choices[0]?.message?.content || "";
  log(jobId, `🤖 LLM 응답 수신 (${content.length}자)`);

  let reqs: any[] = [];
  try {
    const parsed = JSON.parse(content);
    reqs = Array.isArray(parsed) ? parsed : (parsed.requirements || []);
  } catch {
    const m = content.match(/\[[\s\S]*?\]/);
    if (m) try { reqs = JSON.parse(m[0]); } catch {}
  }

  log(jobId, `📋 ${reqs.length}개 요구사항 추출됨`);

  // 4. DB 저장
  await updateJob(jobId, { progress: 70, message: `요구사항 ${reqs.length}개 저장 중...` });

  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i];
    const [req] = await db.insert(requirements).values({
      projectId: projectId,
      originalId: r.originalId || r.id || null,
      sourceText: (r.sourceText || r.name || "").slice(0, 1000),
      type: r.type || "technical",
      priority: r.priority || "essential",
      status: "pending",
      order: i + 1,
    }).returning();
    await db.insert(responses).values({ requirementId: req.id, confidenceLabel: "insufficient" });

    if (i % Math.max(1, Math.floor(reqs.length / 5)) === 0) {
      const p = 70 + Math.round((i / reqs.length) * 25);
      await updateJob(jobId, { progress: p, message: `요구사항 ${i + 1}/${reqs.length} 저장 중...` });
    }
  }

  // 5. 완료 처리
  await db.update(documents).set({ parsedStatus: "ready" }).where(eq(documents.id, documentId));
  await db.execute(sql`
    UPDATE projects SET status = ${reqs.length > 0 ? "review" : "draft"} WHERE id = ${projectId}::uuid
  `);

  await updateJob(jobId, {
    status: "completed",
    progress: 100,
    message: `✅ 분석 완료! ${reqs.length}개 요구사항 추출`,
    result: JSON.stringify({ requirementCount: reqs.length }),
  });

  log(jobId, `✅ RFP 분석 완료 (${reqs.length}개 요구사항)`);
}

// ─── Main Polling Loop ─────────────────────────────────────
async function poll() {
  try {
    // pending 상태의 job을 하나 가져옴 (race condition 방지: FOR UPDATE SKIP LOCKED)
    const [job] = (await db.execute(sql`
      UPDATE jobs
      SET status = 'processing', updated_at = NOW()
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `)).rows ?? [];

    if (!job) return; // 처리할 job 없음

    // raw SQL 결과(snake_case) → TypeScript(camelCase) 매핑
    const r = job as Record<string, any>;
    const j = {
      id: r.id,
      type: r.type,
      status: r.status,
      projectId: r.project_id,
      documentId: r.document_id,
      progress: r.progress,
      message: r.message,
      error: r.error,
      result: r.result,
      retryCount: r.retry_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    } as typeof jobs.$inferSelect;

    log(j.id, `🚀 작업 시작: ${j.type} (project=${j.projectId?.slice(0,8)})`);

    try {
      switch (j.type) {
        case "rfp_analyze":
          await handleRfpAnalyze(j);
          break;
        default:
          throw new Error(`알 수 없는 작업 유형: ${j.type}`);
      }
    } catch (err: any) {
      log(j.id, `❌ 작업 실패: ${err.message}`);

      const retryCount = (j.retryCount ?? 0) + 1;
      if (retryCount < 3) {
        // 재시도
        await updateJob(j.id, {
          status: "pending",
          retryCount,
          message: `재시도 ${retryCount}/3: ${err.message}`,
        });
      } else {
        // 최종 실패
        await updateJob(j.id, {
          status: "failed",
          error: err.message,
          message: `❌ ${err.message}`,
        });

        // 프로젝트 상태도 에러로
        if (j.projectId) {
          await db.execute(sql`
            UPDATE projects SET status = 'draft' WHERE id = ${j.projectId}::uuid
          `);
        }
      }
    }
  } catch (err) {
    console.error("[WORKER] Polling error:", err);
  }
}

// ─── Startup ────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(50));
  console.log("🧑‍🏭 RFP Worker 시작");
  console.log(`   Polling interval: 2초`);
  console.log(`   PID: ${process.pid}`);
  console.log("=".repeat(50));

  // 무한 폴링 루프
  while (true) {
    await poll();
    await sleep(2000); // 2초 간격
  }
}

main().catch((err) => {
  console.error("[WORKER] Fatal error:", err);
  process.exit(1);
});
