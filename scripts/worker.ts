import { db } from "../src/db";
import { jobs, documents, requirements, responses } from "../src/db/schema";
import { sql, eq } from "drizzle-orm";
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

// ─── Chunk splitting for map-reduce ────────────────────────
function splitIntoChunks(text: string, chunkSize = 4000, overlap = 500): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    chunks.push(text.slice(i, i + chunkSize));
    if (i + chunkSize >= text.length) break;
  }
  return chunks;
}

// ─── LLM call with timeout ─────────────────────────────────
async function callLLM(
  client: any,
  model: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  timeoutMs: number
): Promise<any> {
  return client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: maxTokens,
      temperature: 0.1,
    } as any,
    { signal: AbortSignal.timeout(timeoutMs) }
  );
}

// ─── Parse LLM response ────────────────────────────────────
function parseLLMResponse(content: string): any[] {
  let raw: any;
  try {
    raw = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) try { raw = JSON.parse(m[0]); } catch {}
  }
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw.requirements || [];
}

// ─── Deduplicate by ID ─────────────────────────────────────
function deduplicateById(reqs: any[]): any[] {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const r of reqs) {
    const id = r.id || r.originalId || "";
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    result.push(r);
  }
  return result;
}

// ─── Filter to valid requirement IDs ──────────────────────
// ECR-001, SFR-005, COR-002 등 [A-Z]{2,4}-\d{3} 패턴만 유지
function filterValidRequirementIds(reqs: any[]): any[] {
  const idRegex = /^[A-Z]{2,4}-\d{3}$/;
  return reqs.filter((r) => {
    const id = r.id || r.originalId || "";
    return idRegex.test(id);
  });
}

// ─── Job Handler ───────────────────────────────────────────
async function handleRfpAnalyze(job: any) {
  const { id: jobId, projectId, documentId } = job;
  if (!projectId || !documentId) throw new Error("projectId/documentId 누락");

  // 1. PDF 파싱
  await updateJob(jobId, { progress: 5, message: "PDF 파싱 중..." });

  const [doc] = (await db.execute(sql`
    SELECT file_url, name FROM documents WHERE id = ${documentId}::uuid LIMIT 1
  `)).rows as { file_url: string; name: string }[];

  if (!doc) throw new Error("문서를 찾을 수 없습니다.");

  log(jobId, `🔍 RFP 분석 시작: ${doc.name}`);

  await db.execute(sql`UPDATE documents SET parsed_status = 'parsing' WHERE id = ${documentId}::uuid`);

  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: readFileSync(doc.file_url) });
  const result = await parser.getText();
  await parser.destroy();
  const text = cleanText(result.text);

  log(jobId, `📄 PDF 파싱 완료: ${doc.name} (${text.length}자)`);

  // 2. 문서 앞부분에서 사업정보 추출용 헤더
  await updateJob(jobId, { progress: 15, message: "사업정보 추출 중..." });
  const headerText = text.slice(0, Math.min(2000, text.length));

  // 3. 요구사항 섹션 찾기
  await updateJob(jobId, { progress: 20, message: "요구사항 섹션 찾는 중..." });

  const reqIdRegex = /[A-Z]{2,4}-\d{3}/g;
  let firstReqIdPos = -1;
  let m;
  while ((m = reqIdRegex.exec(text)) !== null) {
    if (m.index > text.length * 0.08) {
      firstReqIdPos = m.index;
      break;
    }
  }

  const reqKeyPos = text.indexOf("요구사항 고유번호");
  const reqNamePos = text.indexOf("요구사항 명칭");

  const bodyReqPos = (() => {
    const from = Math.floor(text.length * 0.1);
    for (const marker of ["요구사항 상세", "요구사항 목록", "주요 과업", "요구사항 총괄표"]) {
      const idx = text.indexOf(marker, from);
      if (idx >= 0) return idx;
    }
    return -1;
  })();

  const validPositions = [firstReqIdPos, reqKeyPos, reqNamePos, bodyReqPos].filter((p) => p > 0);

  let excerptStart: number;
  if (validPositions.length > 0) {
    excerptStart = Math.max(0, Math.min(...validPositions) - 200);
    log(jobId, `📌 요구사항 시작: ${Math.min(...validPositions)}자 위치`);
  } else {
    excerptStart = Math.floor(text.length * 0.15);
    log(jobId, `⚠️ 요구사항 시작점 못 찾음, 15% 위치(${excerptStart})에서 시작`);
  }

  const excerpt = text.slice(excerptStart, Math.min(text.length, excerptStart + 20000));
  log(jobId, `📋 요구사항 섹션 추출 (${excerpt.length}자)`);

  // 4. LLM 클라이언트 생성
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    baseURL: process.env.LLM_API_BASE,
    apiKey: process.env.LLM_API_KEY,
  });
  const model = process.env.LLM_MODEL || "minimax-m2.7";

  // 5. 사업정보 추출 (별도 호출, 짧은 입력)
  let projectInfo: any = {};
  await updateJob(jobId, { progress: 30, message: "사업정보 추출 중..." });
  try {
    const infoRes = await callLLM(
      client,
      model,
      'RFP 문서에서 사업기간을 찾아 JSON으로 출력. {"period": "사업기간"}. 없으면 {"period": null}. JSON만 출력.',
      headerText + "\n\nJSON:",
      512,
      30000
    );
    const infoContent = infoRes.choices[0]?.message?.content || "";
    try {
      projectInfo = JSON.parse(infoContent);
    } catch {
      const m2 = infoContent.match(/\{[\s\S]*\}/);
      if (m2) try { projectInfo = JSON.parse(m2[0]); } catch {}
    }
    log(jobId, `📅 사업기간: ${projectInfo?.period || "(없음)"}`);
  } catch (e: any) {
    log(jobId, `⚠️ 사업정보 추출 실패: ${e.message}`);
  }

  // 6. Map-Reduce: 청크별 요구사항 추출
  await updateJob(jobId, { progress: 40, message: "AI 요구사항 추출 중..." });

  const chunks = splitIntoChunks(excerpt, 3500, 300);
  log(jobId, `📦 청크 분할: ${chunks.length}개`);

  const allReqs: any[] = [];
  const sysPrompt = [
    "RFP 문서에서 요구사항을 JSON 배열로 추출하세요.",
    '출력: {"requirements":[{"id":"ECR-001","name":"요구사항 명칭","sourceText":"상세 설명","type":"technical","priority":"essential"}]}',
    "id: RFP에 기재된 고유번호 (ECR-001, SFR-005 등). 없으면 null",
    "name: 요구사항 명칭. 원문 그대로",
    "sourceText: 요구사항 상세 내용. 원문 그대로",
    "type: technical | security | operation | qualification | format | general",
    "priority: essential | recommended | optional",
    "반드시 유효한 JSON만 출력. 생각 과정 출력 금지.",
  ].join("\n");

  for (let i = 0; i < chunks.length; i++) {
    const chunkProgress = 40 + Math.round((i / chunks.length) * 35);
    await updateJob(jobId, {
      progress: chunkProgress,
      message: `AI 분석 중... (청크 ${i + 1}/${chunks.length})`,
    });

    try {
      const res = await callLLM(client, model, sysPrompt, chunks[i] + "\n\nJSON:", 4096, 30000);
      const content = res.choices[0]?.message?.content || "";
      const chunkReqs = parseLLMResponse(content);
      log(jobId, `  청크 ${i + 1}/${chunks.length}: ${chunkReqs.length}개 추출`);
      allReqs.push(...chunkReqs);
    } catch (e: any) {
      log(jobId, `  청크 ${i + 1}/${chunks.length} 실패: ${e.message.slice(0, 60)}`);
    }
  }

  // 중복 제거 + 유효한 요구사항 ID만 필터링
  const deduped = deduplicateById(allReqs);
  const reqs = filterValidRequirementIds(deduped);
  log(jobId, `📋 총 ${allReqs.length}개 → 중복 제거 ${deduped.length}개 → ID 필터링 후 ${reqs.length}개`);

  // 7. DB 저장
  await updateJob(jobId, { progress: 80, message: `요구사항 ${reqs.length}개 저장 중...` });

  // 사업기간 저장
  if (projectInfo?.period) {
    const periodVal = String(projectInfo.period).slice(0, 200);
    await db.execute(sql`UPDATE projects SET period = ${periodVal} WHERE id = ${projectId}::uuid`);
    log(jobId, `📅 사업기간 저장: ${periodVal}`);
  }

  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i];
    const [req] = await db.insert(requirements).values({
      projectId: projectId,
      originalId: r.id || r.originalId || null,
      name: r.name ? String(r.name).slice(0, 200) : null,
      sourceText: (r.sourceText || "").slice(0, 1000),
      type: r.type || "technical",
      priority: r.priority || "essential",
      status: "pending",
      order: i + 1,
    }).returning();
    await db.insert(responses).values({ requirementId: req.id, confidenceLabel: "insufficient" });

    if (i % Math.max(1, Math.floor(reqs.length / 5)) === 0) {
      const p = 80 + Math.round((i / reqs.length) * 15);
      await updateJob(jobId, { progress: p, message: `요구사항 ${i + 1}/${reqs.length} 저장 중...` });
    }
  }

  // 8. 완료 처리
  await db.execute(sql`UPDATE documents SET parsed_status = 'ready' WHERE id = ${documentId}::uuid`);
  await db.execute(sql`
    UPDATE projects SET status = ${reqs.length > 0 ? "review" : "draft"} WHERE id = ${projectId}::uuid
  `);

  await updateJob(jobId, {
    status: "completed",
    progress: 100,
    message: `✅ 분석 완료! ${reqs.length}개 요구사항 추출`,
    result: JSON.stringify({ requirementCount: reqs.length }),
  });

  log(jobId, `✅ RFP 분석 완료: ${doc.name} (${reqs.length}개 요구사항)`);
}

// ─── Main Polling Loop ─────────────────────────────────────
async function poll() {
  try {
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

    if (!job) return;

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
    };

    log(j.id, `🚀 작업 시작: ${j.type} (project=${j.projectId?.slice(0, 8)})`);

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
        await updateJob(j.id, {
          status: "pending",
          retryCount,
          message: `재시도 ${retryCount}/3: ${err.message}`,
        });
      } else {
        await updateJob(j.id, {
          status: "failed",
          error: err.message,
          message: `❌ ${err.message}`,
        });

        if (j.projectId) {
          await db.execute(sql`UPDATE projects SET status = 'draft' WHERE id = ${j.projectId}::uuid`);
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
  console.log("🧑‍🏭 RFP Worker 시작 (map-reduce 모드)");
  console.log(`   Model: ${process.env.LLM_MODEL || "minimax-m2.7"}`);
  console.log(`   Polling interval: 2초`);
  console.log(`   PID: ${process.pid}`);
  console.log("=".repeat(50));

  while (true) {
    await poll();
    await sleep(2000);
  }
}

main().catch((err) => {
  console.error("[WORKER] Fatal error:", err);
  process.exit(1);
});
