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
import {
  enrichBatch,
  getPrimaryModel,
  getFallbackModels,
  parseResponseJson,
  isEmptyResponse,
  formatDiagnostic,
  classifyProviderError,
  type RequirementBatchInput,
  type DiagnosticMeta,
} from "../src/lib/provider";

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
  console.log(`[${new Date().toISOString().slice(11, 19)}][w${workerId}][${jobId.slice(0, 8)}] ${msg}`);
}

function diag(jobId: string, label: string, data: Record<string, any>) {
  console.log(`[${new Date().toISOString().slice(11, 19)}][w${workerId}][${jobId.slice(0, 8)}][DIAG] ${label} ${JSON.stringify(data)}`);
}

// ─── Description 정제 ────────────────────────────────────
// LLM 없이 원문 블록 텍스트에서 요구사항 설명 부분만 추출한다.
// ID 위치를 찾아 앞부분을 버리고, ID와 name(LLM 출력 명칭)을 제거한 뒤, 표 아티팩트를 정리한다.
function escapeRegex(s: string): string {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function cleanDescription(blockText: string, id: string, name: string | null): string {
  let text = blockText;

  // 1. ID 위치 찾고 앞부분(preamble) 버리기
  const idRe = new RegExp(escapeRegex(id), "i");
  const idMatch = text.match(idRe);
  if (idMatch && idMatch.index !== undefined) {
    text = text.slice(idMatch.index);
  }

  // 2. ID 문자열 제거 (대소문자 구분 없이)
  text = text.replace(idRe, "");

  // 3. 명칭(name) 제거 — "요구사항 명칭 [name]" 패턴도 함께 제거 (RFP 템플릿 접두사)
  if (name && name.length >= 2) {
    const nameRe = new RegExp(
      "^\\s*(?:요구사항\\s*명칭\\s*)?" + escapeRegex(name) + "(?:\\s*[·●•○]?)?",
      ""
    );
    text = text.replace(nameRe, " ");
  }

  // 4. 표 아티팩트 정리
  text = text
    .replace(/[·●•○]\s*/g, "")    // 열 구분자
    .replace(/\s{2,}/g, " ")        // 다중 공백 → 단일 공백
    .replace(/^\s+/gm, "")          // 줄머리 공백
    .replace(/\n{2,}/g, "\n")       // 연속 줄바꿈 → 하나
    .trim();

  // 5. RFP 템플릿 보일러플레이트 제거 (행 단위)
  const lines = text.split("\n");
  const cleanLines: string[] = [];
  for (let line of lines) {
    const t = line.trim();
    if (!t) continue;
    // 순수 템플릿 라벨 행 → 제거
    if (/^(요구사항|세부내용|세부|내용)$/i.test(t)) continue;
    // 페이지 번호 ("- 6 -", "- 10 -")
    if (/^-\s*\d+\s*-$/i.test(t)) continue;
    // 합계 행, 산출정보 행 제거 (\b 대신 \s — JavaScript에서 한글은 \w가 아니므로 word boundary 미작동)
    if (/^(합\s*계|산출정보)(?:\s|$)/i.test(t)) continue;
    // 다음 요구사항 헤더 누출 제거 ("요구사항 분류 ...", "요구사항 고유번호 ...")
    if (/^요구사항\s*(분류|고유번호)/i.test(t)) continue;
    // 섹션 번호 누출 제거 ("2) 기능 요구사항", "3. 시스템 구성")
    if (/^\d+[).]\s/i.test(t)) continue;
    // "정의 " 접두사 제거 (RFP 표 컬럼 헤더, 본문은 보존)
    let cleaned = t.replace(/^정의\s*/i, "");
    if (!cleaned) continue;
    cleanLines.push(cleaned);
  }
  text = cleanLines.join("\n");

  // 6. 깨진 줄 이어붙이기 (pdf-parse가 표 셀 내 줄바꿈을 그대로 유지해 문장이 중간에 잘리는 문제)
  // 이전 줄이 한글로 끝나고 종결 어미가 아니면 다음 줄과 붙인다.
  text = (function reflow(t: string): string {
    const ls = t.split("\n");
    const out: string[] = [];
    let buf = "";
    const isSentenceEnd = /(?:함|한다|된다|것|해야|되어야|하여야|이어야|바람|필요|가능|보장|제공|지원|준수|실시|구성|적용|확인|유지|처리|관리|수행|대응|보호)$/;
    for (const l of ls) {
      const s = l.trim();
      if (!s) continue;
      if (!buf) { buf = s; continue; }
      if (/[가-힣]$/.test(buf) && !isSentenceEnd.test(buf) && !/^\d+[).]/.test(s) && !(buf.length >= 25 && s.length >= 25)) {
        buf += s;
      } else {
        out.push(buf);
        buf = s;
      }
    }
    if (buf) out.push(buf);
    return out.join("\n");
  })(text);

  return text.slice(0, 1000);
}

// ─── Job Progress Updater ──────────────────────────────────
async function updateJob(jobId: string, updates: Partial<typeof jobs.$inferInsert>) {
  await db.update(jobs).set({ ...updates, updatedAt: new Date() }).where(eq(jobs.id, jobId));
}

// ─── Error Classification (Provider 기반) ─────────────────
function classifyError(e: any): string {
  const { errorType } = classifyProviderError(e);
  return errorType;
}

function backoffDelay(retryCount: number): number {
  return Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 500, 10000);
}

// ─── 사업개요 섹션 추출 (TOC 건너뛰기) ──────────────────
function extractOverviewSection(fullText: string): string {
  const HEADING_RE = /사\s*업\s*개\s*요/g;
  // 표지 앞부분 포함 (사업명 추출용)
  const coverPart = fullText.slice(0, Math.min(500, fullText.length));

  function lineAt(text: string, pos: number) {
    const nl = text.indexOf("\n", pos);
    return nl >= 0 ? text.slice(pos, nl) : text.slice(pos, pos + 200);
  }

  function isTocLine(line: string) {
    const dotCount = (line.match(/[·.]/g) || []).length;
    return dotCount >= 4 && /\d{1,4}\s*$/.test(line);
  }

  let match;
  HEADING_RE.lastIndex = 0;
  while ((match = HEADING_RE.exec(fullText)) !== null) {
    const line = lineAt(fullText, match.index);
    if (!isTocLine(line)) {
      const idx = match.index;
      const nextHeading = fullText.slice(idx + 10).search(/\n\s*[ⅡⅢⅣ]\./);
      const end = nextHeading > 0 ? idx + 10 + nextHeading : idx + 6000;
      return coverPart + "\n---SECTION---\n" + fullText.slice(idx, Math.min(end, idx + 6000));
    }
  }
  // Fallback
  const altRe = /사\s*업\s*(?:개요|명|목적|배경|내용|기간|예산|범위)/g;
  altRe.lastIndex = Math.floor(fullText.length * 0.03);
  const altMatch = altRe.exec(fullText);
  if (altMatch) {
    return coverPart + "\n---SECTION---\n" + fullText.slice(
      Math.max(0, altMatch.index - 150),
      Math.min(fullText.length, altMatch.index + 4000)
    );
  }
  const start = Math.floor(fullText.length * 0.1);
  return coverPart + "\n---SECTION---\n" + fullText.slice(start, start + 3000);
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

// ─── Batch Processing ──────────────────────────────────────

const BATCH_MAX_ITEMS = parseInt(process.env.RFP_LLM_BATCH_MAX_ITEMS || "10", 10);
const BATCH_MAX_CHARS = parseInt(process.env.RFP_LLM_BATCH_MAX_CHARS || "16000", 10);
const LLM_CONCURRENCY = parseInt(process.env.RFP_LLM_CONCURRENCY || "2", 10);
const LLM_MAX_RETRIES = parseInt(process.env.RFP_LLM_MAX_RETRIES || "2", 10);
const LLM_TIMEOUT_MS = parseInt(process.env.RFP_LLM_TIMEOUT_MS || "60000", 10);

interface BatchItem { expectedId: string; text: string; startOffset: number; }
interface Batch { items: BatchItem[]; index: number; }

function createBatches(blocks: any[], maxItems: number, maxChars: number): Batch[] {
  const batches: Batch[] = [];
  let currentItems: BatchItem[] = [];
  let currentChars = 0;

  for (const block of blocks) {
    if (!block.expectedId) continue;
    const item: BatchItem = { expectedId: block.expectedId, text: block.text, startOffset: block.startOffset };

    // 하나의 블록이 최대 문자 수를 초과하면 단독 배치
    if (item.text.length > maxChars) {
      if (currentItems.length > 0) batches.push({ items: currentItems, index: batches.length });
      batches.push({ items: [item], index: batches.length });
      currentItems = [];
      currentChars = 0;
      continue;
    }

    if (currentItems.length >= maxItems || currentChars + item.text.length > maxChars) {
      batches.push({ items: currentItems, index: batches.length });
      currentItems = [];
      currentChars = 0;
    }
    currentItems.push(item);
    currentChars += item.text.length;
  }
  if (currentItems.length > 0) batches.push({ items: currentItems, index: batches.length });
  return batches;
}

// ─── Concurrency Limiter ──────────────────────────────────
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  const queue = [...tasks];

  async function worker() {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      try {
        results.push({ status: "fulfilled", value: await task() });
      } catch (e) {
        results.push({ status: "rejected", reason: e });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ─── ID Reconciliation ────────────────────────────────────
function reconcileBatchResult(inputIds: string[], outputReqs: any[]): {
  valid: any[];
  missingIds: string[];
  unknownIds: string[];
} {
  const outputIds = new Set(outputReqs.map((r: any) => (r.id || "").toUpperCase()));
  const inputSet = new Set(inputIds);
  const missingIds = inputIds.filter((id) => !outputIds.has(id));
  const unknownIds = outputReqs
    .map((r: any) => (r.id || "").toUpperCase())
    .filter((id: string) => id && !inputSet.has(id));
  const valid = outputReqs.filter(
    (r: any) => r.id && inputSet.has((r.id || "").toUpperCase())
  );
  return { valid, missingIds, unknownIds };
}

// ─── Job Handler ───────────────────────────────────────────

/**
 * document_chunks 생성 + bge-m3 임베딩 (EMBEDDING_API_URL 설정 시)
 * ※ vector dimension: bge-m3는 1024차원 → ALTER COLUMN 필요
 */
async function generateChunksWithEmbeddings(
  excerpt: string,
  documentId: string,
  jobId: string
) {
  const chunkSize = 500;
  const overlap = 100;
  const texts: string[] = [];
  for (let i = 0; i < excerpt.length; i += chunkSize - overlap) {
    const t = excerpt.slice(i, i + chunkSize).trim();
    if (t.length > 50) texts.push(t);
    if (i + chunkSize >= excerpt.length) break;
  }

  log(jobId, `🔮 임베딩 생성: ${texts.length}개 청크`);

  const response = await fetch(process.env.EMBEDDING_API_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!response.ok) throw new Error(`Embedding API: ${response.status}`);

  const { embeddings } = (await response.json()) as { embeddings: number[][] };

  for (let i = 0; i < texts.length; i++) {
    await db.execute(sql`
      INSERT INTO document_chunks (document_id, content, embedding, page, section)
      VALUES (${documentId}::uuid, ${texts[i]}, ${JSON.stringify(embeddings[i])}::vector, ${Math.floor(i / 10) + 1}, 'general')
    `);
  }
  log(jobId, `✅ 임베딩 생성 완료: ${texts.length}개 청크`);
}

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
  const headerText = extractOverviewSection(text);

  // 헤더 텍스트 저장 (유사 RFP 문서수준 비교용)
  await db.execute(sql`
    UPDATE documents SET header_text = ${headerText} WHERE id = ${documentId}::uuid
  `);
  log(jobId, `📋 문서 헤더 저장 완료 (${headerText.length}자)`);

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
  const model = getPrimaryModel();
  const fallbackModels = getFallbackModels();

  const diagHandler = (meta: DiagnosticMeta) => {
    diag(jobId, "provider", {
      batch_index: -1,
      ...meta,
      rawContentPreview: process.env.RFP_LLM_DEBUG_RESPONSE === "true" ? meta.rawContentPreview : "[disabled]",
    });
  };

  // 5. 사업정보 추출 (정규식 우선 + LLM fallback)
  let projectInfo: any = {};
  await updateJob(jobId, { progress: 30, message: "사업정보 추출 중..." });

  // ── 1차: 정규식/키워드 기반 추출 ────────────────────
  const periodRegex = /(?:사업기간|수행기간|계약기간|과업기간|용역기간|사업\s*기간)[\s:：]*[^\n.]{3,60}/;
  const periodMatch = headerText.match(periodRegex);
  if (periodMatch) {
    projectInfo.period = periodMatch[0].replace(/^(?:사업기간|수행기간|계약기간|과업기간|용역기간)\s*[:：]\s*/, "").trim();
    log(jobId, `📅 사업기간(정규식): ${projectInfo.period}`);
  }

  // ── 2차: LLM fallback (정규식 실패 시) ──────────────
  if (!projectInfo.period) {
    try {
      const infoRes = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: 'RFP 문서에서 사업기간을 찾아 JSON으로 출력. {"period": "사업기간"}. 없으면 {"period": null}. JSON만 출력.' },
            { role: "user", content: headerText + "\n\nJSON:" },
          ],
          max_tokens: 512,
        } as any,
        { signal: AbortSignal.timeout(30000) }
      );
      const infoContent = infoRes.choices[0]?.message?.content || "";
      try {
        const parsed = JSON.parse(infoContent);
        if (parsed?.period) projectInfo.period = parsed.period;
      } catch {
        const m2 = infoContent.match(/\{[\s\S]*\}/);
        if (m2) try { const p = JSON.parse(m2[0]); if (p?.period) projectInfo.period = p.period; } catch {}
      }
      log(jobId, `📅 사업기간(LLM): ${projectInfo.period || "(없음)"}`);
    } catch (e: any) {
      log(jobId, `⚠️ 사업정보 추출 실패: ${e.message}`);
    }
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
  const resultByBlock = new Map<string, { success: boolean; data: any }>();

  // 1차: 배치 생성 + 병렬 처리
  const batches = createBatches(blocks, BATCH_MAX_ITEMS, BATCH_MAX_CHARS);
  log(jobId, `📦 배치 생성: ${blocks.length}개 블록 → ${batches.length}개 배치 (동시 ${LLM_CONCURRENCY}개)`);

  let completedCount = 0;
  let failedCount = 0;

  const batchTasks = batches.map((batch, batchIdx) => async () => {
    const batchStart = 40 + Math.round((completedCount / blocks.length) * 35);
    await updateJob(jobId, {
      progress: batchStart,
      message: `AI 분석 중... (배치 ${batchIdx + 1}/${batches.length}, ${batch.items.length}개)`,
    });

    const inputIds = batch.items.map((b: BatchItem) => b.expectedId);

    try {
      const input: RequirementBatchInput = {
        requirements: batch.items.map((b: BatchItem) => ({
          id: b.expectedId,
          text: b.text,
        })),
      };

      const output = await enrichBatch(client, model, input, {
        timeoutMs: LLM_TIMEOUT_MS,
        onDiagnostic: (meta) => {
          diag(jobId, "provider", {
            batch_index: batchIdx,
            ...meta,
            rawContentPreview: process.env.RFP_LLM_DEBUG_RESPONSE === "true"
              ? meta.rawContentPreview : "[disabled]",
          });
        },
      });

      const reconciliation = reconcileBatchResult(
        inputIds,
        output.requirements.map((r: any) => ({ id: r.id, name: r.name }))
      );

      // 성공 ID 저장
      for (const r of output.requirements) {
        const blockItem = batch.items.find((b: BatchItem) => b.expectedId === r.id.toUpperCase());
        resultByBlock.set(r.id.toUpperCase(), {
          success: true,
          data: { id: r.id, name: r.name, sourceText: cleanDescription(blockItem?.text || "", r.id, r.name) },
        });
      }

      // 누락 ID는 실패로 표시
      for (const id of reconciliation.missingIds) {
        resultByBlock.set(id, { success: false, data: { id, name: null } });
      }

      completedCount += reconciliation.valid.length;
      failedCount += reconciliation.missingIds.length;
      log(jobId, `  배치 ${batchIdx + 1}/${batches.length}: ✅ ${reconciliation.valid.length}개 / ❌ ${reconciliation.missingIds.length}개 누락`);
    } catch (e: any) {
      const { errorType, retryable } = classifyProviderError(e);
      log(jobId, `  배치 ${batchIdx + 1}/${batches.length}: ❌ ${errorType}: ${e.message.slice(0, 60)}`);
      // 모든 입력 ID를 실패로 표시
      for (const id of inputIds) {
        if (!resultByBlock.has(id)) {
          resultByBlock.set(id, { success: false, data: { id, name: null } });
        }
      }
      failedCount += inputIds.length;
    }
  });

  await runWithConcurrency(batchTasks, LLM_CONCURRENCY);

  log(jobId, `📊 1차 배치 완료: ${completedCount}/${blocks.length} 성공`);

  // 2차: 실패 ID만 개별 재시도
  const failedIds = [...resultByBlock.entries()]
    .filter(([, v]) => !v.success)
    .map(([id]) => id);

  if (failedIds.length > 0 && LLM_MAX_RETRIES > 0) {
    log(jobId, `🔄 실패 ID 재시도: ${failedIds.length}개`);
    const retryBlocks = blocks.filter((b: any) => b.expectedId && failedIds.includes(b.expectedId));

    for (let retry = 0; retry < LLM_MAX_RETRIES && failedIds.length > 0; retry++) {
      const retryBatches = createBatches(retryBlocks.filter((b: any) => failedIds.includes(b.expectedId)), BATCH_MAX_ITEMS, BATCH_MAX_CHARS);
      log(jobId, `  재시도 ${retry + 1}/${LLM_MAX_RETRIES}: ${retryBatches.length}개 배치`);

      const retryTasks = retryBatches.map((batch, bi) => async () => {
        const inputIds = batch.items.map((b: BatchItem) => b.expectedId);
        // 실패 ID는 fallback 모델이 있으면 fallback 사용
        const retryModel = fallbackModels.length > 0 ? fallbackModels[0] : model;

        try {
          const input: RequirementBatchInput = {
            requirements: batch.items.map((b: BatchItem) => ({ id: b.expectedId, text: b.text })),
          };
          const output = await enrichBatch(client, retryModel, input, { timeoutMs: LLM_TIMEOUT_MS });

          const reconciliation = reconcileBatchResult(
            inputIds,
            output.requirements.map((r: any) => ({ id: r.id, name: r.name }))
          );

          for (const r of output.requirements) {
            const blockItem = batch.items.find((b: BatchItem) => b.expectedId === r.id.toUpperCase());
            resultByBlock.set(r.id.toUpperCase(), {
              success: true,
              data: { id: r.id, name: r.name, sourceText: cleanDescription(blockItem?.text || "", r.id, r.name) },
            });
          }
          log(jobId, `    재시도 배치 ${bi + 1} (${retryModel}): ✅ ${reconciliation.valid.length}개 / ❌ ${reconciliation.missingIds.length}개`);
        } catch (e: any) {
          await sleep(backoffDelay(retry));
        }
      });
      await runWithConcurrency(retryTasks, LLM_CONCURRENCY);
    }
  }

  // 3차: 최종 실패 → raw_only 보존
  const finalFailed = [...resultByBlock.entries()].filter(([, v]) => !v.success);
  if (finalFailed.length > 0) {
    log(jobId, `📄 ${finalFailed.length}개 raw_only 보존`);
    for (const [id] of finalFailed) {
      const blockItem = blocks.find((b: any) => b.expectedId === id);
      allReqs.push({
        id,
        originalId: id,
        name: null,
        sourceText: cleanDescription(blockItem?.text || "", id, null),
        type: "general",
        priority: "essential",
        _rawOnly: true,
      });
    }
  }

  // 성공 항목 추가
  const finalSuccess = [...resultByBlock.entries()].filter(([, v]) => v.success);
  const successfulBlocks = finalSuccess.length;
  allReqs.push(...finalSuccess.map(([, v]) => v.data));

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

  // ── document_chunks + 임베딩 생성 (EMBEDDING_API_URL 설정 시) ──
  if (process.env.EMBEDDING_API_URL) {
    try {
      await generateChunksWithEmbeddings(excerpt, documentId, jobId);
    } catch (e: any) {
      log(jobId, `⚠️ 임베딩 생성 실패 (분석 결과는 저장됨): ${e.message.slice(0, 60)}`);
    }
  }

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
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || "2000", 10);

// Worker ID: 여러 Worker 동시 실행 시 로그 구분용
const workerId = `${process.pid}`.slice(-4);

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
  console.log(`🧑‍🏭 RFP Worker #${workerId} 시작`);
  console.log(`   Model: ${process.env.LLM_MODEL || "minimax-m2.7"}`);
  console.log(`   Polling interval: ${POLL_INTERVAL_MS / 1000}초`);
  console.log(`   PID: ${process.pid}`);
  console.log(`   다중 Worker 병렬 실행: 지원됨 (FOR UPDATE SKIP LOCKED)`);
  console.log(`   임베딩: ${process.env.EMBEDDING_API_URL ? `✅ ${process.env.EMBEDDING_API_URL}` : "❌ 미설정"}`);
  console.log("=".repeat(50));

  // ── Stuck job 복구: 10분 이상 processing인 job → pending ──
  await recoverStuckJobs();

  while (true) {
    await poll();
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error("[WORKER] Fatal error:", err);
  process.exit(1);
});
