import OpenAI from "openai";
import { env } from "./env";

// OpenAI-compatible client factory
// Supports: DeepSeek, GLM, GPT, Claude (via API proxy), etc.
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: env.LLM_API_BASE,
      apiKey: env.LLM_API_KEY,
    });
  }
  return client;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMConfig = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
};

/**
 * Send a chat completion request to the configured LLM provider.
 * All providers use OpenAI-compatible API format.
 */
export async function chat(
  messages: ChatMessage[],
  config: LLMConfig = {}
) {
  const c = getClient();
  const response = await c.chat.completions.create({
    model: config.model ?? env.LLM_MODEL,
    messages,
    temperature: config.temperature ?? 0.1,
    max_tokens: config.maxTokens ?? 4096,
    response_format: config.responseFormat === "json_object"
      ? { type: "json_object" }
      : undefined,
  });

  return {
    content: response.choices[0]?.message?.content ?? "",
    usage: response.usage,
  };
}

/**
 * Get an embedding vector for a text string.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const c = getClient();
  const response = await c.embeddings.create({
    model: "text-embedding-3-large", // OpenAI 모델 사용 (opencode go에서 지원하는 embedding 모델로 변경 가능)
    input: text,
  });
  return response.data[0]?.embedding ?? [];
}

/**
 * Get embeddings for multiple texts in batch.
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const c = getClient();
  const response = await c.embeddings.create({
    model: "text-embedding-3-large",
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}
