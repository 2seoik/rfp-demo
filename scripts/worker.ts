import { db } from "../src/db";
import { jobs, documents, requirements, responses } from "../src/db/schema";
import { sql, eq } from "drizzle-orm";
import { readFileSync } from "fs";
import path from "path";
import {
  detectAllIds,
  normalizeId,
  isValidRequirementId,
  getUniqueNormalizedIds,
  getIdPrefixStats,
  getExcerptCoverage,
  createIdBoundaryBlocks,
  selectBestCandidates,
} from "../src/lib/requirement-id";

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

function diag(jobId: string, label: string, data: Record<string, any>) {
  console.log(`[${new Date().toISOString().slice(11, 19)}][${jobId.slice(0, 8)}][DIAG] ${label} ${JSON.stringify(data)}`);
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
// ECR-001, SFR-005, COR-002 등 /^[A-Z]{2,4}-\d{3}$/ 패턴만 유지
// normalizeId()로 대소문자 정규화 후 검증
function filterValidRequirementIds(reqs: any[]): any[] {
  return reqs.filter((r) => {
    const id = r.id || r.originalId || "";
    return isValidRequirementId(id);
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

  // 문서 파싱 (PDF 또는 DOCX)
  const fileExt = path.extname(doc.file_url).toLowerCase();
  let text: string;

  if (fileExt === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: doc.file_url });
    text = cleanText(result.value);
    log(jobId, `📄 DOCX 파싱 완료: ${doc.name} (${text.length}자)`);
  } else {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: readFileSync(doc.file_url) });
    const result = await parser.getText();
    await parser.destroy();
    text = cleanText(result.text);
    log(jobId, `📄 PDF 파싱 완료: ${doc.name} (${text.length}자)`);
  }

  // ── DIAG: 전체 텍스트 계측 ────────────────────────────
  const allDetectedIds = detectAllIds(text);
  const allFullTextIds = getUniqueNormalizedIds(allDetectedIds);
  diag(jobId, "full_text", {
    total_length: text.length,
    total_ids_detected: allDetectedIds.length,
    total_unique_ids: allFullTextIds.length,
    id_prefixes: getIdPrefixStats(allFullTextIds),
    sample_ids: allFullTextIds.slice(0, 20),
  });

  // 2. 문서 앞부분에서 사업정보 추출용 헤더
  await updateJob(jobId, { progress: 15, message: "사업정보 추출 중..." });
  const headerText = text.slice(0, Math.min(2000, text.length));

  // 3. 요구사항 섹션 찾기
  await updateJob(jobId, { progress: 20, message: "요구사항 섹션 찾는 중..." });

  // detectAllIds로 전체 문서에서 ID 위치 검출
  let firstReqIdPos = -1;
  const detectedPositions = detectAllIds(text);
  for (const d of detectedPositions) {
    if (d.position > text.length * 0.08) {
      firstReqIdPos = d.position;
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

  // ── DIAG: excerpt 커버리지 계측 ────────────────────────
  const excerptEnd = Math.min(text.length, excerptStart + 20000);
  const allExcerptIds = getUniqueNormalizedIds(detectAllIds(excerpt));
  const coverage = getExcerptCoverage(allFullTextIds, allExcerptIds);
  diag(jobId, "excerpt", {
    start: excerptStart,
    end: excerptEnd,
    length: excerpt.length,
    ids_in_excerpt: coverage.insideCount,
    ids_outside_excerpt: coverage.outsideCount,
    total_full_text_ids: coverage.totalCount,
    outside_ids: coverage.outside.slice(0, 30),
    coverage_pct: coverage.totalCount > 0
      ? Math.round((coverage.insideCount / coverage.totalCount) * 100)
      : 0,
  });

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

  // 6. Map-Reduce: ID 경계 블록별 요구사항 추출
  await updateJob(jobId, { progress: 40, message: "AI 요구사항 추출 중..." });

  // ID 경계 기반 블록 생성 + 중복 후보 중 최적 블록 선택
  const idBlocks = createIdBoundaryBlocks(excerpt);
  const blocks = selectBestCandidates(idBlocks);
  log(jobId, `📦 ID 경계 블록: ${idBlocks.length}개 → 중복 제거 후 ${blocks.length}개`);

  // ── DIAG: 블록별 예상 ID 계측 ──────────────────────────
  const expectedIdsPerBlock: (string | null)[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const blockIds = getUniqueNormalizedIds(detectAllIds(blocks[i].text));
    expectedIdsPerBlock.push(blocks[i].expectedId);
    diag(jobId, `block_expected`, {
      block_index: i,
      block_length: blocks[i].text.length,
      expected_id: blocks[i].expectedId,
      start_offset: blocks[i].startOffset,
      detected_ids_in_block: blockIds.length,
      detected_ids_list: blockIds.slice(0, 15),
    });
  }

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

  let successfulBlocks = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const chunkProgress = 40 + Math.round((i / blocks.length) * 35);
    await updateJob(jobId, {
      progress: chunkProgress,
      message: `AI 분석 중... (블록 ${i + 1}/${blocks.length})`,
    });

    let blockSuccess = false;
    let blockReqs: any[] = [];

    // ── 1차 LLM 호출 ────────────────────────────────────
    try {
      const userContent = block.expectedId
        ? `${block.text}\n\n---\n위 텍스트는 요구사항 ID \"${block.expectedId}\"에 해당합니다. JSON 출력:`
        : block.text + "\n\nJSON:";
      const res = await callLLM(client, model, sysPrompt, userContent, 4096, 30000);
      const content = res.choices[0]?.message?.content || "";
      blockReqs = parseLLMResponse(content);

      // ID 검증: LLM이 반환한 id가 expectedId와 일치하는지 확인
      const hasMatchingId = block.expectedId
        ? blockReqs.some(
            (r: any) => (r.id || r.originalId || "").toUpperCase() === block.expectedId
          )
        : blockReqs.length > 0;

      const extractedIds = blockReqs.map((r: any) => r.id || r.originalId).filter(Boolean);
      const expectedList = expectedIdsPerBlock[i] ? [expectedIdsPerBlock[i]].filter(Boolean) as string[] : [];
      const missingIds = expectedList.filter(id => !extractedIds.includes(id));
      const extraIds = extractedIds.filter((id: string) => !expectedList.includes(id));

      if (hasMatchingId) {
        blockSuccess = true;
        successfulBlocks++;
        diag(jobId, `block_ok`, {
          block_index: i,
          expected_id: block.expectedId,
          response_length: content.length,
          extracted_count: blockReqs.length,
          has_match: true,
        });
        log(jobId, `  블록 ${i + 1}/${blocks.length}: ✅ ${blockReqs.length}개 추출`);
        allReqs.push(...blockReqs);
      } else {
        diag(jobId, `block_mismatch`, {
          block_index: i,
          expected_id: block.expectedId,
          response_length: content.length,
          extracted_ids: extractedIds.slice(0, 10),
          missing_ids: missingIds.slice(0, 15),
          extra_ids: extraIds.slice(0, 10),
        });
        log(jobId, `  블록 ${i + 1}/${blocks.length}: ⚠️ ID 불일치 (재시도)`);
      }
    } catch (e: any) {
      log(jobId, `  블록 ${i + 1}/${blocks.length}: ❌ 1차 호출 실패: ${e.message.slice(0, 60)}`);
    }

    // ── 2차 재시도 (ID 불일치 또는 1차 실패) ────────────
    if (!blockSuccess && block.expectedId) {
      try {
        const retryPrompt = `다음 텍스트는 RFP 문서에서 요구사항 ID "${block.expectedId}"에 해당하는 부분입니다.\n` +
          `이 ID에 해당하는 요구사항의 name, sourceText, type, priority를 JSON으로 추출하세요.\n` +
          `다른 ID를 생성하지 말고 반드시 "${block.expectedId}"를 id 필드에 사용하세요.`;
        const retryRes = await callLLM(client, model, retryPrompt, block.text + "\n\nJSON:", 4096, 30000);
        const retryContent = retryRes.choices[0]?.message?.content || "";
        const retryReqs = parseLLMResponse(retryContent);

        const hasMatch = retryReqs.some(
          (r: any) => (r.id || r.originalId || "").toUpperCase() === block.expectedId
        );

        if (hasMatch && retryReqs.length > 0) {
          blockSuccess = true;
          successfulBlocks++;
          diag(jobId, `block_retry_ok`, { block_index: i, expected_id: block.expectedId });
          log(jobId, `  블록 ${i + 1}/${blocks.length}: ✅ 재시도 성공`);
          allReqs.push(...retryReqs);
        }
      } catch (e: any) {
        log(jobId, `  블록 ${i + 1}/${blocks.length}: ❌ 재시도 실패: ${e.message.slice(0, 60)}`);
      }
    }

    // ── raw_only 보존: 모든 시도 실패 시 원문 보존 ──────
    if (!blockSuccess && block.expectedId) {
      diag(jobId, `block_raw_only`, {
        block_index: i,
        expected_id: block.expectedId,
        block_length: block.text.length,
      });
      log(jobId, `  블록 ${i + 1}/${blocks.length}: 📄 raw_only 보존 (${block.expectedId})`);
      // 원문을 보존한 raw_only 요구사항 추가
      allReqs.push({
        id: block.expectedId,
        originalId: block.expectedId,
        name: null,                     // LLM 추출 실패 — name 없음
        sourceText: block.text.slice(0, 1000), // 원문 그대로 보존
        type: "general",
        priority: "essential",
        _rawOnly: true,                 // 내부 마커 (DB 저장 시 name=null 유지)
      });
    }
  }

  // 모든 블록 실패 감지
  if (blocks.length > 0 && successfulBlocks === 0) {
    throw new Error(
      `모든 분석 블록이 실패했습니다 (${blocks.length}개 블록 중 0개 성공). ` +
      `LLM API 연결 또는 모델 상태를 확인하세요.`
    );
  }

  // 중복 제거 + 유효한 요구사항 ID만 필터링
  const deduped = deduplicateById(allReqs);
  const reqs = filterValidRequirementIds(deduped);

  // ── DIAG: 최종 필터링 결과 계측 ────────────────────────
  const rawOnlyCount = allReqs.filter((r: any) => r._rawOnly).length;
  const filteredOutIds = deduped
    .map((r: any) => r.id || r.originalId)
    .filter((id: string) => id && !reqs.some((r: any) => (r.id || r.originalId) === id));
  const validReqIds = reqs.map((r: any) => r.id || r.originalId).filter(Boolean);
  const finalCoverage = allExcerptIds.length > 0
    ? Math.round((validReqIds.length / allExcerptIds.length) * 100)
    : 0;
  diag(jobId, "pipeline_summary", {
    raw_extracted: allReqs.length,
    raw_only_count: rawOnlyCount,
    after_dedup: deduped.length,
    after_filter: reqs.length,
    filtered_out_count: filteredOutIds.length,
    filtered_out_sample: filteredOutIds.slice(0, 20),
    excerpt_ids_count: allExcerptIds.length,
    final_valid_ids: validReqIds.length,
    final_coverage_pct: finalCoverage,
    success_blocks: successfulBlocks,
    total_blocks: blocks.length,
    missing_in_excerpt: allExcerptIds.filter(id => !validReqIds.includes(id)).slice(0, 30),
    successful_blocks: blocks.length,
  });
  log(jobId, `📋 총 ${allReqs.length}개 → 중복 제거 ${deduped.length}개 → ID 필터링 후 ${reqs.length}개`);

  // 7. DB 저장 (트랜잭션)
  await updateJob(jobId, { progress: 80, message: `요구사항 ${reqs.length}개 저장 중...` });

  let savedCount = 0;
  await db.transaction(async (tx) => {
    // 사업기간 저장
    if (projectInfo?.period) {
      const periodVal = String(projectInfo.period).slice(0, 200);
      await tx.execute(sql`UPDATE projects SET period = ${periodVal} WHERE id = ${projectId}::uuid`);
      log(jobId, `📅 사업기간 저장: ${periodVal}`);
    }

    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i];
      const originalId = r.id || r.originalId || null;

      // 중복 방지: 동일 프로젝트 내 동일 original_id 존재 여부 확인
      if (originalId) {
        const [existing] = (await tx.execute(sql`
          SELECT 1 FROM requirements
          WHERE project_id = ${projectId}::uuid AND original_id = ${originalId}
          LIMIT 1
        `)).rows ?? [];
        if (existing) {
          log(jobId, `  ⏭️ ${originalId} 건너뜀 (이미 저장됨)`);
          continue;
        }
      }

      const [req] = await tx.insert(requirements).values({
        projectId: projectId,
        originalId,
        name: r.name ? String(r.name).slice(0, 200) : null,
        sourceText: (r.sourceText || "").slice(0, 1000),
        type: r.type || "technical",
        priority: r.priority || "essential",
        status: "pending",
        order: i + 1,
      }).returning();
      await tx.insert(responses).values({ requirementId: req.id, confidenceLabel: "insufficient" });

      savedCount++;

      if (i % Math.max(1, Math.floor(reqs.length / 5)) === 0) {
        const p = 80 + Math.round((i / reqs.length) * 15);
        await updateJob(jobId, { progress: p, message: `요구사항 ${i + 1}/${reqs.length} 저장 중...` });
      }
    }

    // 완료 처리
    await tx.execute(sql`UPDATE documents SET parsed_status = 'ready' WHERE id = ${documentId}::uuid`);
    await tx.execute(sql`
      UPDATE projects SET status = ${savedCount > 0 ? "review" : "draft"} WHERE id = ${projectId}::uuid
    `);
  });

  log(jobId, `💾 저장 완료: ${savedCount}개 (${reqs.length - savedCount}개 중복 건너뜀)`);

  await updateJob(jobId, {
    status: "completed",
    progress: 100,
    message: `✅ 분석 완료! ${savedCount}개 요구사항 추출`,
    result: JSON.stringify({ requirementCount: savedCount }),
  });

  log(jobId, `✅ RFP 분석 완료: ${doc.name} (${savedCount}개 요구사항)`);
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

const STUCK_JOB_TIMEOUT_MINUTES = 10;

async function recoverStuckJobs() {
  try {
    const result = (await db.execute(sql`
      UPDATE jobs
      SET status = 'pending',
          retry_count = retry_count + 1,
          message = 'Worker 재시작: stuck job 복구',
          updated_at = NOW()
      WHERE status = 'processing'
        AND updated_at < NOW() - INTERVAL '${sql.raw(String(STUCK_JOB_TIMEOUT_MINUTES))} minutes'
      RETURNING id, project_id, document_id, retry_count
    `)).rows ?? [];

    if (result.length > 0) {
      console.log(`[WORKER] ♻️ ${result.length}개 stuck job 복구:`);
      for (const r of result as any[]) {
        console.log(`  - ${r.id.slice(0, 8)} (project=${(r.project_id || '').slice(0, 8)}, retry=${r.retry_count})`);
      }
    } else {
      console.log(`[WORKER] ✅ stuck job 없음`);
    }
  } catch (err) {
    console.error("[WORKER] stuck job 복구 실패:", err);
  }
}

async function main() {
  console.log("=".repeat(50));
  console.log("🧑‍🏭 RFP Worker 시작 (map-reduce 모드)");
  console.log(`   Model: ${process.env.LLM_MODEL || "minimax-m2.7"}`);
  console.log(`   Polling interval: 2초`);
  console.log(`   PID: ${process.pid}`);
  console.log("=".repeat(50));

  // ── Stuck job 복구: 10분 이상 processing인 job → pending ──
  await recoverStuckJobs();

  while (true) {
    await poll();
    await sleep(2000);
  }
}

main().catch((err) => {
  console.error("[WORKER] Fatal error:", err);
  process.exit(1);
});
