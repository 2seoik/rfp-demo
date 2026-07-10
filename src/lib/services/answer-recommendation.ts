import { db } from "@/db";
import { responses, citations, documentChunks, documents } from "@/db/schema";
import { chat, ChatMessage } from "@/lib/llm";
import { ANSWER_RECOMMENDATION_SYSTEM_PROMPT } from "@/lib/prompts";
import { hybridSearch, SearchResult } from "@/lib/search";
import { eq, sql } from "drizzle-orm";

type RecommendationResult = {
  draftText: string;
  confidenceLabel: "sufficient" | "partial" | "needs_review" | "insufficient";
  reasoning: string;
  citations: SearchResult[];
};

/**
 * Generate answer recommendation for a requirement.
 * Uses hybrid search to find relevant knowledge chunks,
 * then LLM generates a grounded answer.
 */
export async function generateAnswerRecommendation(
  requirementId: string,
  projectId: string,
  orgId: string,
  requirementText: string
): Promise<RecommendationResult> {
  // 1. Hybrid search for relevant knowledge
  const searchResults = await hybridSearch(requirementText, {
    orgId,
    topK: 5,
  });

  // 2. If no relevant docs found, return insufficient
  if (searchResults.length === 0) {
    return {
      draftText: "",
      confidenceLabel: "insufficient",
      reasoning: "관련 문서에서 요구사항과 일치하는 내용을 찾을 수 없습니다.",
      citations: [],
    };
  }

  // 3. Build context from search results
  const contextChunks = searchResults
    .map(
      (r, i) =>
        `[청크 ${i + 1}] (문서: ${r.documentId}, 페이지: ${r.page ?? "?"}, 유사도: ${r.score}%)\n${r.content}`
    )
    .join("\n\n");

  // 4. Generate answer using LLM
  const messages: ChatMessage[] = [
    { role: "system", content: ANSWER_RECOMMENDATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: `## 요구사항\n${requirementText}\n\n## 근거 문서 조각들\n${contextChunks}\n\n위 근거를 바탕으로 요구사항에 대한 답변 초안을 JSON 형식으로 작성해주세요.`,
    },
  ];

  const response = await chat(messages, {
    temperature: 0.1,
    responseFormat: "json_object",
  });

  let result: {
    draftText: string;
    confidenceLabel: string;
    reasoning: string;
  };
  try {
    result = JSON.parse(response.content);
  } catch {
    console.error("Failed to parse LLM response:", response.content);
    return {
      draftText: "",
      confidenceLabel: "insufficient",
      reasoning: "LLM 응답 파싱 실패",
      citations: searchResults,
    };
  }

  const confidenceLabel = ["sufficient", "partial", "needs_review", "insufficient"].includes(
    result.confidenceLabel
  )
    ? (result.confidenceLabel as RecommendationResult["confidenceLabel"])
    : "needs_review";

  // 5. Save to database
  // Find the response record for this requirement
  const [existingResponse] = await db
    .select()
    .from(responses)
    .where(eq(responses.requirementId, requirementId))
    .limit(1);

  if (existingResponse) {
    await db
      .update(responses)
      .set({
        draftText: result.draftText,
        confidenceLabel,
        updatedAt: new Date(),
      })
      .where(eq(responses.id, existingResponse.id));

    // Save citations
    for (const sr of searchResults) {
      await db
        .insert(citations)
        .values({
          responseId: existingResponse.id,
          chunkId: sr.chunkId,
          score: sr.score,
        })
        .onConflictDoNothing();
    }
  }

  return {
    draftText: result.draftText,
    confidenceLabel,
    reasoning: result.reasoning,
    citations: searchResults,
  };
}

/**
 * Update the final answer text for a requirement response.
 */
export async function updateFinalAnswer(
  responseId: string,
  finalText: string
) {
  await db
    .update(responses)
    .set({
      finalText,
      updatedAt: new Date(),
    })
    .where(eq(responses.id, responseId));
}
