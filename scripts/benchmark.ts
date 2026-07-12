// ─── RFP LLM Provider Benchmark ─────────────────────────────
// 실행: pnpm tsx scripts/benchmark.ts [--models=...] [--batch-sizes=...] [--concurrency=...]

import { readFileSync } from "fs";
import OpenAI from "openai";
import {
  detectAllIds,
  createIdBoundaryBlocks,
  selectBestCandidates,
  getUniqueNormalizedIds,
} from "../src/lib/requirement-id";
import {
  enrichBatch,
  formatDiagnostic,
  type RequirementBatchInput,
  type DiagnosticMeta,
} from "../src/lib/provider";

// 대략적인 가격 ($/1M tokens)
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "kimi-k2.6": { input: 0.5, output: 1.0 },
  "minimax-m2.7": { input: 0.3, output: 0.5 },
  default: { input: 0.5, output: 1.0 },
};

function cleanText(text: string): string {
  return text.replace(/\t/g, " ").replace(/[ ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function createBatches(blocks: any[], maxItems: number, maxChars: number): any[] {
  const batches: any[] = [];
  let cur: any[] = []; let chars = 0;
  for (const b of blocks) {
    if (!b.expectedId) continue;
    if (cur.length >= maxItems || chars + b.text.length > maxChars) { batches.push({ items: cur }); cur = []; chars = 0; }
    cur.push(b); chars += b.text.length;
  }
  if (cur.length > 0) batches.push({ items: cur });
  return batches;
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  const queue = [...tasks];
  async function worker() { while (queue.length) { const t = queue.shift(); if (!t) break; try { results.push({ status: "fulfilled", value: await t() }); } catch (e) { results.push({ status: "rejected", reason: e }); } } }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

async function main() {
  // .env 로드
  const envContent = readFileSync(process.cwd() + "/.env", "utf-8");
  for (const line of envContent.split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const key = t.slice(0, eq).trim(), val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }

  const args = process.argv.slice(2);
  const getArg = (n: string, d: string) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=")[1] : d; };
  const models = getArg("models", "kimi-k2.6").split(",").map((s) => s.trim());
  const batchSizes = getArg("batch-sizes", "10").split(",").map(Number);
  const concurrencies = getArg("concurrency", "2").split(",").map(Number);
  const pdfPath = getArg("pdf", "docs/test/fixtures/한국기술대_전자결재_시스템고도화.pdf");
  const timeoutMs = parseInt(getArg("timeout", "60000"), 10);

  if (!process.env.LLM_API_KEY) { console.error("❌ LLM_API_KEY 미설정"); process.exit(1); }

  const client = new OpenAI({ baseURL: process.env.LLM_API_BASE, apiKey: process.env.LLM_API_KEY });

  // PDF → blocks
  console.log(`📄 PDF 파싱: ${pdfPath}`);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: readFileSync(pdfPath) });
  const r = await parser.getText(); await parser.destroy();
  const text = cleanText(r.text);
  const detected = detectAllIds(text);
  const ids = getUniqueNormalizedIds(detected);
  const startPos = Math.max(0, (detected.find((d) => d.position > text.length * 0.08)?.position || 0) - 200);
  const excerpt = text.slice(startPos, Math.min(text.length, startPos + 20000));
  const blocks = selectBestCandidates(createIdBoundaryBlocks(excerpt)).filter((b: any) => b.expectedId);
  console.log(`   텍스트: ${text.length}자, ID: ${ids.length}개, 블록: ${blocks.length}개\n`);

  // 벤치마크 실행
  interface BR { model: string; batch: number; conc: number; reqs: number; batches: number; ok: number; fail: number; ids: number; ms: number; tk: number; cost: number; }
  const results: BR[] = [];

  for (const batchSize of batchSizes) {
    for (const concurrency of concurrencies) {
      for (const model of models) {
        const batches = createBatches(blocks, batchSize, 16000);
        if (!batches.length) continue;

        console.log(`🚀 ${model} batch=${batchSize} concur=${concurrency} (${batches.length}개 배치)`);

        const extracted = new Set<string>();
        let ok = 0, fail = 0, totalTk = 0, promptTk = 0, compTk = 0;
        const start = Date.now();

        const tasks = batches.map((batch) => async () => {
          const input: RequirementBatchInput = { requirements: batch.items.map((b: any) => ({ id: b.expectedId, text: b.text })) };
          const output = await enrichBatch(client, model, input, {
            timeoutMs,
            onDiagnostic: (m: DiagnosticMeta) => { console.log(`  ${m.errorType ? "⚠️" : "✅"} ${formatDiagnostic(m)}`); m.errorType ? fail++ : ok++; },
          });
          output.requirements.forEach((rr) => extracted.add(rr.id));
          if (output.usage) { totalTk += output.usage.totalTokens; promptTk += output.usage.promptTokens; compTk += output.usage.completionTokens; }
        });

        await runWithConcurrency(tasks, concurrency);
        const elapsed = Date.now() - start;
        const price = MODEL_PRICES[model] || MODEL_PRICES.default;
        const cost = (promptTk / 1_000_000) * price.input + (compTk / 1_000_000) * price.output;

        results.push({ model, batch: batchSize, conc: concurrency, reqs: ids.length, batches: batches.length, ok, fail, ids: extracted.size, ms: elapsed, tk: totalTk, cost });
        console.log(`   → ${extracted.size}/${ids.length}개, ${(elapsed/1000).toFixed(1)}s, ${totalTk} tokens, $${cost.toFixed(4)}\n`);
      }
    }
  }

  // 출력
  console.log("=".repeat(120));
  console.log("Model           Batch Concur Batches Ok/Fail    IDs     Time   Tokens      Cost");
  console.log("-".repeat(120));
  for (const r of results) {
    const line = r.model.padEnd(16) + " " + String(r.batch).padStart(6) + " " + String(r.conc).padStart(6) + " " + String(r.batches).padStart(7) + " " + (r.ok + "/" + r.fail).padStart(7) + " " + (r.ids + "/" + r.reqs).padStart(6) + " " + (r.ms / 1000).toFixed(1).padStart(7) + "s " + String(r.tk).padStart(7) + " $" + r.cost.toFixed(4).padStart(9);
    console.log(line);
  }

  // 저장
  const outDir = "benchmarks";
  await import("fs/promises").then((fs) => fs.mkdir(outDir, { recursive: true }));
  const tss = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = `${outDir}/rfp-benchmark-${tss}.json`;
  await import("fs/promises").then((fs) => fs.writeFile(outFile, JSON.stringify(results, null, 2)));
  console.log(`\n📁 저장: ${outFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
