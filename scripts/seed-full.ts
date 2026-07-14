import { readFileSync } from "fs";
import { db } from "../drizzle";
import { organizations, users, projects, documents, documentChunks, requirements, responses } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { cleanText, parseRequirements, normalizeReqs } from "./seed-utils";

const client = new OpenAI({
  baseURL: process.env.LLM_API_BASE,
  apiKey: process.env.LLM_API_KEY,
});

const SYSTEM_PROMPT = `RFP 문서 분석 전문가입니다. RFP에서 요구사항을 추출해 JSON 배열로 반환하세요.

각 요구사항 형식:
{"id":"REQ-001","name":"짧은 제목","sourceText":"원문 그대로","type":"technical|security|operation|qualification|format|general","priority":"essential|recommended|optional"}

중요: 반드시 유효한 JSON 배열만 출력하세요. 추측 금지.`;

const RFP_FILES = [
  { path: "docs/rfp/한국기술대_전자결재_시스템고도화.pdf", name: "한국기술대 전자결재 시스템 고도화 RFP" },
  { path: "docs/rfp/한국폴리텍_전자결재시스템고도화.pdf", name: "한국폴리텍 전자결재 시스템 고도화 RFP" },
];

async function processRFP(filePath: string, fileName: string, projectId: string, orgId: string) {
  console.log(`\n📄 [${fileName}] 처리 시작...`);

  // 1. Parse PDF
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: readFileSync(filePath) });
  const result = await parser.getText();
  await parser.destroy();

  const text = cleanText(result.text);

  // 2. Store document in DB
  const [doc] = await db.insert(documents).values({
    orgId,
    projectId,
    type: "rfp",
    name: fileName,
    fileUrl: filePath,
    parsedStatus: "parsing",
  }).returning();
  console.log(`   📁 문서 저장됨: ${doc.id}`);

  // 3. Create chunks with embeddings
  const CHUNK_SIZE = 1000;
  const OVERLAP = 100;
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE - OVERLAP) {
    const chunkText = text.slice(i, i + CHUNK_SIZE);
    if (chunkText.trim().length > 50) {
      chunks.push({ content: chunkText, page: Math.floor(i / 3000) + 1 });
    }
  }
  console.log(`   📦 청킹 완료: ${chunks.length}개 청크`);

  // Get embeddings
  const embeddingTexts = chunks.map(c => c.content.slice(0, 500));
  console.log(`   🔮 임베딩 생성 중...`);

  try {
    const response = await client.embeddings.create({
      model: "text-embedding-3-large",
      input: embeddingTexts,
    });
    const embeddings = response.data.map(d => d.embedding);

    // Store chunks with embeddings
    for (let i = 0; i < chunks.length; i++) {
      await db.insert(documentChunks).values({
        documentId: doc.id,
        content: chunks[i].content,
        embedding: embeddings[i],
        page: chunks[i].page,
        section: "general",
      });
    }
    console.log(`   ✅ ${chunks.length}개 청크 저장 완료 (임베딩 포함)`);
  } catch (err: any) {
    console.log(`   ⚠️ 임베딩 실패 (건너뜀): ${err.message}`);
    // Store chunks without embeddings
    for (const chunk of chunks) {
      await db.insert(documentChunks).values({
        documentId: doc.id,
        content: chunk.content,
        page: chunk.page,
        section: "general",
      });
    }
  }

  // 4. Extract requirements using LLM
  const keywords = ["요구사항 목록", "요구사항 상세내용", "요구사항 개요", "제안 요청 내용", "제안요청 내용"];
  let startPos = 0;
  for (const kw of keywords) {
    const idx = text.indexOf(kw);
    if (idx >= 0) { startPos = Math.max(0, idx - 200); break; }
  }
  const excerpt = text.slice(startPos, startPos + 12000);

  console.log(`   🤖 요구사항 추출 중... (${excerpt.length}자)`);
  const response = await client.chat.completions.create({
    model: process.env.LLM_MODEL || "minimax-m2.7",
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

  console.log(`   📋 ${reqs.length}개 요구사항 추출됨`);

  // 5. Store requirements and responses
  for (let i = 0; i < reqs.length; i++) {
    const req = reqs[i];
    const [insertedReq] = await db.insert(requirements).values({
      projectId,
      sourceText: req.sourceText.slice(0, 1000),
      type: req.type || "technical",
      priority: req.priority || "essential",
      status: "pending",
      order: i + 1,
    }).returning();

    await db.insert(responses).values({
      requirementId: insertedReq.id,
      confidenceLabel: "insufficient",
    });
  }

  // 6. Update document status
  await db.update(documents).set({ parsedStatus: "ready" }).where(eq(documents.id, doc.id));

  console.log(`   ✅ [${fileName}] 처리 완료! (${reqs.length}개 요구사항)`);
  return { docId: doc.id, reqCount: reqs.length };
}

async function main() {
  console.log("=".repeat(60));
  console.log("🚀 RFP 데이터 시드 시작");
  console.log("=".repeat(60));

  // Get existing org and project
  const [org] = await db.select().from(organizations).limit(1);
  if (!org) { console.error("Organization 없음. 먼저 기본 시드를 실행하세요."); return; }

  const [proj] = await db.select().from(projects).limit(1);
  if (!proj) { console.error("Project 없음."); return; }

  console.log(`📋 Organization: ${org.name} (${org.id})`);
  console.log(`📋 Project: ${proj.name} (${proj.id})`);

  // Process each RFP
  for (const rfp of RFP_FILES) {
    try {
      await processRFP(rfp.path, rfp.name, proj.id, org.id);
    } catch (err: any) {
      console.error(`❌ [${rfp.name}] 처리 실패:`, err.message);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ 시드 완료!");
  console.log("=".repeat(60));
}

main().catch(console.error);
