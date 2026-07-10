import { db } from "@/db";
import { requirements, responses, citations } from "@/db/schema";
import { chat, ChatMessage } from "@/lib/llm";
import { RFP_ANALYSIS_SYSTEM_PROMPT } from "@/lib/prompts";
import { eq, sql } from "drizzle-orm";

export type ExtractedRequirement = {
  id: string;
  sourceText: string;
  type: string;
  priority: string;
  pageNumber: number | null;
};

/**
 * Extract requirements from RFP text using LLM.
 */
export async function extractRequirements(
  rfpText: string,
  projectId: string
): Promise<ExtractedRequirement[]> {
  const messages: ChatMessage[] = [
    { role: "system", content: RFP_ANALYSIS_SYSTEM_PROMPT },
    {
      role: "user",
      content: `다음 RFP 문서를 분석하여 요구사항을 JSON 배열로 추출해주세요.\n\n---RFP 문서 시작---\n${rfpText}\n---RFP 문서 끝---`,
    },
  ];

  const response = await chat(messages, {
    temperature: 0.05,
    responseFormat: "json_object",
  });

  let extracted: { requirements: ExtractedRequirement[] } | ExtractedRequirement[];
  try {
    const parsed = JSON.parse(response.content);
    extracted = Array.isArray(parsed) ? parsed : parsed.requirements ?? [];
  } catch {
    console.error("Failed to parse LLM response:", response.content);
    throw new Error("요구사항 추출 결과를 파싱하는 데 실패했습니다.");
  }

  // Store in database
  for (let i = 0; i < extracted.length; i++) {
    const req = extracted[i];
    const [inserted] = await db
      .insert(requirements)
      .values({
        projectId,
        sourceText: req.sourceText,
        type: req.type || "general",
        priority: req.priority || "medium",
        status: "pending",
        order: i + 1,
      })
      .returning();

    // Create empty response placeholder
    await db.insert(responses).values({
      requirementId: inserted.id,
      confidenceLabel: "insufficient",
    });
  }

  return extracted;
}

/**
 * Get all requirements for a project.
 */
export async function getProjectRequirements(projectId: string) {
  return await db
    .select()
    .from(requirements)
    .where(eq(requirements.projectId, projectId))
    .orderBy(requirements.order);
}

/**
 * Get requirement with its response and citations via raw SQL join.
 */
export async function getRequirementDetail(requirementId: string) {
  const [req] = await db
    .select()
    .from(requirements)
    .where(eq(requirements.id, requirementId))
    .limit(1);

  if (!req) return null;

  const resps = await db
    .select()
    .from(responses)
    .where(eq(responses.requirementId, requirementId))
    .limit(1);

  const resp = resps[0] ?? null;

  let cites: any[] = [];
  if (resp) {
    const result = await db.execute(sql`
      SELECT
        cit.*,
        dc.content as chunk_content,
        dc.page,
        dc.section,
        d.name as document_name
      FROM citations cit
      JOIN document_chunks dc ON dc.id = cit.chunk_id
      JOIN documents d ON d.id = dc.document_id
      WHERE cit.response_id = ${resp.id}
      ORDER BY cit.score DESC
    `);
    cites = result.rows ?? [];
  }

  return { requirement: req, response: resp, citations: cites };
}
