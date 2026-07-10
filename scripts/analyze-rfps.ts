import { readFileSync } from "fs";
import OpenAI from "openai";

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

const SYSTEM_PROMPT = `RFP 문서 분석 전문가입니다. RFP에서 요구사항을 추출해 JSON 배열로 반환하세요.

각 요구사항 형식:
{"id":"REQ-001","name":"짧은 제목","sourceText":"원문 그대로","type":"technical|security|operation|qualification|format|general","priority":"essential|recommended|optional"}

중요: 
- 반드시 유효한 JSON 배열만 출력하세요. 
- 각 요구사항의 원문(sourceText)을 반드시 포함하세요.
- 추측하지 말고 문서에 있는 내용만 사용하세요.`;

const files = [
  { path: "docs/rfp/한국기술대_전자결재_시스템고도화.pdf", name: "한국기술대" },
  { path: "docs/rfp/한국폴리텍_전자결재시스템고도화.pdf", name: "한국폴리텍" },
];

const client = new OpenAI({
  baseURL: process.env.LLM_API_BASE,
  apiKey: process.env.LLM_API_KEY,
});

/** Parse LLM response to extract requirement objects, handling various formats */
function parseRequirements(content: string): any[] {
  const reqs: any[] = [];

  // Try full JSON parse
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed) ? parsed : parsed.requirements || [];
    if (Array.isArray(arr)) return arr;
  } catch {}

  // Try to find JSON array in text (including markdown code blocks)
  const arrayMatch = content.match(/(?:```(?:json)?\s*)?(\[[\s\S]*?\])/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // Try to extract individual JSON objects from truncated response
  const objRegex = /\{[^{}]*"id"\s*:\s*"[^"]*"[^{}]*\}/g;
  let match;
  while ((match = objRegex.exec(content)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj.id) reqs.push(obj);
    } catch {}
  }

  return reqs;
}

/** Normalize requirement format (handle details array format) */
function normalizeReqs(raw: any[]): any[] {
  const result: any[] = [];
  let counter = 0;

  for (const item of raw) {
    // Format 1: Has details array (category+details format)
    if (item.details && Array.isArray(item.details)) {
      item.details.forEach((detail: string, i: number) => {
        counter++;
        result.push({
          id: `REQ-${String(counter).padStart(3, "0")}`,
          sourceText: detail,
          name: item.name || item.category || "",
          type: item.type || "technical",
          priority: item.priority || "essential",
          category: item.category || "",
        });
      });
    }
    // Format 2: Simple sourceText format
    else if (item.sourceText) {
      counter++;
      result.push({
        id: item.id || `REQ-${String(counter).padStart(3, "0")}`,
        sourceText: item.sourceText,
        name: item.name || "",
        type: item.type || "technical",
        priority: item.priority || "essential",
        category: item.category || "",
      });
    }
  }

  return result;
}

async function extractRequirements(filePath: string, fileName: string) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: readFileSync(filePath) });
  const result = await parser.getText();
  await parser.destroy();

  const text = cleanText(result.text);

  // Find requirements section
  const keywords = ["요구사항 목록", "요구사항 상세내용", "요구사항 개요", "제안 요청 내용", "제안요청 내용"];
  let startPos = 0;
  for (const kw of keywords) {
    const idx = text.indexOf(kw);
    if (idx >= 0) {
      startPos = Math.max(0, idx - 200);
      break;
    }
  }

  const excerpt = text.slice(startPos, startPos + 12000);

  console.log(`\n[${fileName}] 분석 중... (${text.length}자 중 ${excerpt.length}자)`);

  const response = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `RFP 문서:\n${excerpt}\n\n---\n요구사항을 JSON 배열로 출력:` },
    ],
    temperature: 0.05,
    max_tokens: 8192,
  });

  const content = response.choices[0]?.message?.content || "";
  const rawReqs = parseRequirements(content);
  const reqs = normalizeReqs(rawReqs);

  console.log(`[${fileName}] ${reqs.length}개 요구사항 추출됨`);
  return { fileName, text, reqs };
}

async function main() {
  const results: Awaited<ReturnType<typeof extractRequirements>>[] = [];

  for (const f of files) {
    const r = await extractRequirements(f.path, f.name);
    results.push(r);
  }

  // Print results
  for (const r of results) {
    console.log("\n" + "=".repeat(70));
    console.log(`📋 [${r.fileName}] 요구사항 ${r.reqs.length}개`);
    console.log("=".repeat(70));
    r.reqs.slice(0, 25).forEach((req, i) => {
      const src = (req.category ? `[${req.category}] ` : "") + (req.sourceText || "");
      console.log(`  ${i + 1}. ${src.slice(0, 130)}`);
      console.log(`     🏷️ ${req.type} | 중요도: ${req.priority}`);
    });
    if (r.reqs.length > 25) {
      console.log(`  ... 외 ${r.reqs.length - 25}개`);
    }
  }

  // Stats
  console.log("\n" + "=".repeat(70));
  console.log("📊 통계");
  console.log("=".repeat(70));
  for (const r of results) {
    const types: Record<string, number> = {};
    const prios: Record<string, number> = {};
    r.reqs.forEach((req: any) => {
      types[req.type] = (types[req.type] || 0) + 1;
      prios[req.priority] = (prios[req.priority] || 0) + 1;
    });
    console.log(`[${r.fileName}]: ${r.reqs.length}개`);
    console.log(`  유형: ${JSON.stringify(types)}`);
    console.log(`  중요도: ${JSON.stringify(prios)}`);
  }

  // Cross-RFP similarity
  if (results.length === 2) {
    const [tech, poly] = results;
    console.log("\n" + "=".repeat(70));
    console.log("🔗 [유사도 테스트] 한국기술대 → 한국폴리텍");
    console.log("=".repeat(70));

    for (const q of tech.reqs.slice(0, 5)) {
      console.log(`\n[검색] ${(q.sourceText || "").slice(0, 100)}`);

      const searchRes = await client.chat.completions.create({
        model: process.env.LLM_MODEL,
        messages: [
          { role: "system", content: "RFP 비교 전문가. 두 RFP 간 유사 요구사항을 찾아 비교하세요." },
          { role: "user", content: `요구사항: ${q.sourceText}\n\n비교 RFP:\n${poly.text.slice(0, 6000)}` },
        ],
        temperature: 0.1,
        max_tokens: 500,
      });

      const answer = searchRes.choices[0]?.message?.content || "";
      console.log(`  → ${answer.slice(0, 200)}`);
    }
  }
}

main().catch(console.error);
