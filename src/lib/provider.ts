// ─── LLM Provider Adapter ──────────────────────────────────
// 모델별 호출 차이를 추상화하고 응답 정규화를 담당합니다.

export interface RequirementBatchInput {
  requirements: Array<{
    id: string;
    text: string;
  }>;
}

export interface RequirementBatchOutput {
  requirements: Array<{
    id: string;
    name: string | null;
    type: string | null;
    priority: string | null;
  }>;
}

export interface DiagnosticMeta {
  provider: string;
  model: string;
  httpStatus?: number;
  finishReason?: string;
  responseContentLength: number;
  reasoningContentLength: number;
  rawContentPreview: string;
  elapsedMs: number;
  errorType?: string;
}

export interface LlmProviderConfig {
  name: string;
  provider: "openai-compatible";
  temperature?: number;
  maxTokens?: number;
}

export interface EnrichBatchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxTokens?: number;
  onDiagnostic?: (meta: DiagnosticMeta) => void;
}

// ─── Model Configuration ───────────────────────────────────
const MODEL_CONFIG: Record<string, LlmProviderConfig> = {
  "kimi-k2.6": { name: "kimi-k2.6", provider: "openai-compatible" },
  "kimi-k2.5": { name: "kimi-k2.5", provider: "openai-compatible" },
  "minimax-m2.7": { name: "minimax-m2.7", provider: "openai-compatible" },
  "minimax-m2.5": { name: "minimax-m2.5", provider: "openai-compatible" },
  "mimo-v2.5": { name: "mimo-v2.5", provider: "openai-compatible" },
  "mimo-v2.5-pro": { name: "mimo-v2.5-pro", provider: "openai-compatible" },
  "glm-5.2": { name: "glm-5.2", provider: "openai-compatible" },
  "deepseek-v4-flash": { name: "deepseek-v4-flash", provider: "openai-compatible" },
  "qwen3.7-plus": { name: "qwen3.7-plus", provider: "openai-compatible" },
  "hy3-preview": { name: "hy3-preview", provider: "openai-compatible" },
};

export function getModelConfig(model: string): LlmProviderConfig {
  return MODEL_CONFIG[model] || { name: model, provider: "openai-compatible" };
}

export function getPrimaryModel(): string {
  return process.env.RFP_LLM_PRIMARY_MODEL || process.env.LLM_MODEL || "kimi-k2.6";
}

export function getFallbackModels(): string[] {
  const fallback = process.env.RFP_LLM_FALLBACK_MODELS;
  if (fallback) return fallback.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

// ─── Response Normalization ─────────────────────────────────
export function normalizeLlmResponse(
  raw: any,
  model: string
): { content: string; reasoningLen: number } {
  const choice = raw?.choices?.[0];
  const message = choice?.message || {};

  let content = message.content;
  let reasoningLen = 0;

  // reasoning_content가 별도 필드로 오는 경우
  if (typeof message.reasoning_content === "string") {
    reasoningLen = message.reasoning_content.length;
  }

  // content가 배열인 경우 합치기
  if (Array.isArray(content)) {
    content = content.map((p: any) => p.text || p.content || "").join("");
  }

  // content가 객체인 경우
  if (typeof content === "object" && content !== null) {
    content = JSON.stringify(content);
  }

  // 빈 content → 빈 문자열로 통일
  if (content === null || content === undefined) {
    content = "";
  }

  // content가 이미 JSON 문자열인지 확인하고 code fence 제거
  if (typeof content === "string") {
    content = content.replace(/```json\s*|```\s*/gm, "").trim();
  }

  return { content, reasoningLen };
}

export function classifyProviderError(e: any): {
  errorType: string;
  retryable: boolean;
} {
  const msg = (e.message || String(e)).toLowerCase();
  if (msg.includes("request was aborted") || msg.includes("timeout"))
    return { errorType: "timeout", retryable: true };
  if (msg.includes("429"))
    return { errorType: "rate_limit", retryable: true };
  if (msg.includes("500") || msg.includes("502") || msg.includes("503"))
    return { errorType: "server_error", retryable: true };
  if (msg.includes("400") || msg.includes("401") || msg.includes("403"))
    return { errorType: "auth_error", retryable: false };
  return { errorType: "unknown", retryable: false };
}

export function isEmptyResponse(content: string): boolean {
  return !content || content.trim().length === 0;
}

// ─── Provider Adapter ──────────────────────────────────────
export async function enrichBatch(
  client: any,
  model: string,
  input: RequirementBatchInput,
  options: EnrichBatchOptions = {}
): Promise<RequirementBatchOutput> {
  const config = getModelConfig(model);
  const startMs = Date.now();

  const systemPrompt = [
    "RFP 요구사항 목록을 받아 각 요구사항의 name, type, priority를 JSON으로 반환하세요.",
    '출력: {"requirements":[{"id":"ECR-001","name":"명칭","type":"technical","priority":"essential"}]}',
    "",
    "규칙:",
    "- 입력으로 받은 모든 ID에 대해 정확히 하나의 결과를 반환한다.",
    "- ID 문자열을 수정하지 않는다.",
    "- 입력에 없는 ID를 생성하지 않는다.",
    "- 판단할 수 없는 값은 null로 반환한다.",
    "- type: technical | security | operation | qualification | format | general",
    "- priority: essential | recommended | optional",
    "- JSON 외의 설명이나 마크다운을 출력하지 않는다.",
  ].join("\n");

  const inputText = input.requirements
    .map((r) => `--- ID: ${r.id} ---\n${r.text.slice(0, 1500)}`)
    .join("\n\n");

  const userContent = `입력 ID: ${input.requirements.map((r) => r.id).join(", ")}\n\n${inputText}\n\nJSON:`;

  try {
    const res = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: options.maxTokens || config.maxTokens || 4096,
        temperature: config.temperature ?? 0,
      } as any,
      { signal: options.signal || options.timeoutMs ? AbortSignal.timeout(options.timeoutMs || 60000) : undefined }
    );

    const normalized = normalizeLlmResponse(res, model);
    const elapsed = Date.now() - startMs;

    if (isEmptyResponse(normalized.content)) {
      options.onDiagnostic?.({
        provider: config.provider, model,
        responseContentLength: 0,
        reasoningContentLength: normalized.reasoningLen,
        rawContentPreview: "",
        finishReason: res?.choices?.[0]?.finish_reason,
        elapsedMs: elapsed,
        errorType: "empty_response",
      });
      return { requirements: [] };
    }

    const outputReqs = parseResponseJson(normalized.content);
    options.onDiagnostic?.({
      provider: config.provider, model,
      responseContentLength: normalized.content.length,
      reasoningContentLength: normalized.reasoningLen,
      rawContentPreview: normalized.content.slice(0, 200),
      finishReason: res?.choices?.[0]?.finish_reason,
      elapsedMs: elapsed,
    });

    return {
      requirements: outputReqs.map((r: any) => ({
        id: (r.id || "").toUpperCase(),
        name: r.name || null,
        type: r.type || null,
        priority: r.priority || null,
      })),
    };
  } catch (e: any) {
    const { errorType, retryable } = classifyProviderError(e);
    const elapsed = Date.now() - startMs;
    options.onDiagnostic?.({
      provider: config.provider, model,
      responseContentLength: 0,
      reasoningContentLength: 0,
      rawContentPreview: "",
      elapsedMs: elapsed,
      errorType,
    });
    throw Object.assign(e, { providerErrorType: errorType, retryable });
  }
}

// ─── JSON Parsing ──────────────────────────────────────────
export function parseResponseJson(content: string): any[] {
  // 1. code fence 제거 (중복 방지)
  let cleaned = content
    .replace(/```json\s*/gm, "")
    .replace(/```\s*/gm, "")
    .trim();

  // 2. JSON 파싱 시도
  let raw: any;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    // 3. code fence 내 JSON 추출 시도
    const codeMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeMatch) {
      try { raw = JSON.parse(codeMatch[1]); } catch {}
    }
    if (!raw) {
      // 4. { }로 감싸진 첫 번째 JSON 객체 추출
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try { raw = JSON.parse(objMatch[0]); } catch {}
      }
    }
  }

  if (!raw) return [];

  if (Array.isArray(raw)) return raw;
  if (raw.requirements && Array.isArray(raw.requirements)) return raw.requirements;
  return [];
}

// ─── Diagnostic Logging ────────────────────────────────────
export function formatDiagnostic(meta: DiagnosticMeta): string {
  return [
    `provider=${meta.provider}`,
    `model=${meta.model}`,
    `http=${meta.httpStatus || "-"}`,
    `finish=${meta.finishReason || "-"}`,
    `content=${meta.responseContentLength}B`,
    `reasoning=${meta.reasoningContentLength}B`,
    `elapsed=${meta.elapsedMs}ms`,
    meta.errorType ? `error=${meta.errorType}` : "",
  ].filter(Boolean).join(" ");
}
