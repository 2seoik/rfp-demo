// ─── RFP LLM Provider Benchmark ─────────────────────────────
// 독립 실행 가능한 벤치마크 도구
// 실행: pnpm tsx scripts/benchmark.ts [--models=...] [--batch-sizes=...] [--concurrency=...]

import { readFileSync } from "fs";
import OpenAI from "openai";

// .env 로드
const envContent = readFileSync(process.cwd() + "/.env", "utf-8");
for (const line of envContent.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

const { PDFParse } = await import("pdf-parse");
import {
  detectAllIds,
  createIdBoundaryBlocks,
  selectBestCandidates,
  getUniqueNormalizedIds,
} from "../src/lib/requirement-id";
import {
  enrichBatch,
  getModelConfig,
  parseResponseJson,
  formatDiagnostic,
  type RequirementBatchInput,
  type DiagnosticMeta,
} from "../src/lib/provider";

function cleanText(text: string): string {
  return text.replace(/\t/g, " ").replace(/[ ]+/g, " ").replace(/ ·+/g, "")
    .replace(/^[ ]+/gm, "").replace(/\n{3,}/g, "\n\n").replace(/-- \d+ of \d+ --/g, "").trim();
}

function createBatches(blocks: any[], maxItems: number, maxChars: number): any[] {
  const batches: any[] = [];
  let currentItems: any[] = [];
  let currentChars = 0;
  for (const block of blocks) {
    if (!block.expectedId) continue;
    if (currentItems.length >= maxItems || currentChars + block.text.length > maxChars) {
      batches.push({ items: currentItems, index: batches.length });
      currentItems = []; currentChars = 0;
    }
    currentItems.push(block);
    currentChars += block.text.length;
  }
  if (currentItems.length > 0) batches.push({ items: currentItems, index: batches.length });
  return batches;
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  const queue = [...tasks];
  async function worker() {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      try { results.push({ status: "fulfilled", value: await task() }); }
      catch (e) { results.push({ status: "rejected", reason: e }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ─── CLI 파싱 ───────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name: string, fallback: string) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : fallback;
};

const models = getArg("models", "kimi-k2.6").split(",").map((s) => s.trim());
const batchSizes = getArg("batch-sizes", "10").split(",").map(Number);
const concurrencies = getArg("concurrency", "2").split(",").map(Number);
const pdfPath = getArg("pdf", "docs/test/공고_제안요청서.pdf");
const timeoutMs = parseInt(getArg("timeout", "60000"), 10);

// ─── API 키 확인 ───────────────────────────────────────────
if (!process.env.LLM_API_KEY) {
  console.error("❌ LLM_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.");
  process.exit(1);
}

const client = new OpenAI({
  baseURL: process.env.LLM_API_BASE,
  apiKey: process.env.LLM_API_KEY,
});

// ─── PDF 파싱 ──────────────────────────────────────────────
console.log(`📄 PDF 파싱: ${pdfPath}`);
const parser = new PDFParse({ data: readFileSync(pdfPath) });
const result = await parser.getText();
await parser.destroy();
const text = cleanText(result.text);
console.log(`   텍스트 길이: ${text.length}자`);

// ─── ID 검출 ───────────────────────────────────────────────
const detected = detectAllIds(text);
const ids = getUniqueNormalizedIds(detected);
console.log(`   요구사항 ID: ${ids.length}개`);

// ─── 블록 생성 ─────────────────────────────────────────────
const startPos = Math.max(0, (detected.find((d) => d.position > text.length * 0.08)?.position || 0) - 200);
const excerpt = text.slice(startPos, Math.min(text.length, startPos + 20000));
const idBlocks = createIdBoundaryBlocks(excerpt);
const blocks = selectBestCandidates(idBlocks).filter((b: any) => b.expectedId);
console.log(`   블록: ${blocks.length}개\n`);

// ─── 벤치마크 ──────────────────────────────────────────────
interface BenchResult {
  model: string;
  batchSize: number;
  concurrency: number;
  totalReqs: number;
  totalBatches: number;
  successBatches: number;
  failedBatches: number;
  extractedIds: number;
  totalElapsedMs: number;
}

const results: BenchResult[] = [];

for (const batchSize of batchSizes) {
  for (const concurrency of concurrencies) {
    for (const model of models) {
      const batches = createBatches(blocks, batchSize, 16000);
      if (batches.length === 0) continue;

      const modelConfig = getModelConfig(model);
      console.log(`🚀 모델=${model} 배치=${batchSize} 동시=${concurrency} (${batches.length}개 배치)`);

      const allExtracted: Set<string> = new Set();
      let successB = 0;
      let failedB = 0;
      const start = Date.now();

      const tasks = batches.map((batch) => async () => {
        const input: RequirementBatchInput = {
          requirements: batch.items.map((b: any) => ({ id: b.expectedId, text: b.text })),
        };
        const output = await enrichBatch(client, model, input, {
          timeoutMs,
          onDiagnostic: (meta: DiagnosticMeta) => {
            if (meta.errorType) {
              console.log(`  ⚠️ ${formatDiagnostic(meta)}`);
              failedB++;
            } else {
              console.log(`  ✅ ${formatDiagnostic(meta)}`);
              successB++;
            }
          },
        });
        output.requirements.forEach((r) => allExtracted.add(r.id));
      });

      await runWithConcurrency(tasks, concurrency);
      const elapsed = Date.now() - start;

      results.push({
        model, batchSize, concurrency,
        totalReqs: ids.length,
        totalBatches: batches.length,
        successBatches: successB,
        failedBatches: failedB,
        extractedIds: allExtracted.size,
        totalElapsedMs: elapsed,
      });

      console.log(`   결과: ${allExtracted.size}/${ids.length} 추출, ${elapsed / 1000}s\n`);
    }
  }
}

// ─── 결과 출력 ──────────────────────────────────────────────
console.log("=".repeat(90));
console.log(`${"Model".padEnd(20)} ${"Batch".padStart(6)} ${"Concur".padStart(6)} ${"Batches".padStart(7)} ${"Ok/Fail".padStart(9)} ${"IDs".padStart(6)} ${"Time".padStart(8)}`);
console.log("-".repeat(90));
for (const r of results) {
  console.log(
    `${r.model.padEnd(20)} ${String(r.batchSize).padStart(6)} ${String(r.concurrency).padStart(6)} ` +
    `${String(r.totalBatches).padStart(7)} ${`${r.successBatches}/${r.failedBatches}`.padStart(9)} ` +
    `${`${r.extractedIds}/${r.totalReqs}`.padStart(6)} ${`${(r.totalElapsedMs / 1000).toFixed(1)}s`.padStart(8)}`
  );
}

// 결과 JSON 저장
const outDir = "benchmarks";
await import("fs/promises").then((fs) => fs.mkdir(outDir, { recursive: true }));
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = `${outDir}/rfp-benchmark-${ts}.json`;
await import("fs/promises").then((fs) => fs.writeFile(outFile, JSON.stringify(results, null, 2)));
console.log(`\n📁 결과 저장: ${outFile}`);
