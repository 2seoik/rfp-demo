const getEnv = (key: string, fallback?: string): string => {
  const val = process.env[key] ?? fallback;
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
};

export const env = {
  DATABASE_URL: process.env.DATABASE_URL, // 선택적 (DB 없이 LLM 테스트 가능)
  LLM_API_BASE: process.env.LLM_API_BASE ?? "https://api.opencode.ai/v1",
  LLM_API_KEY: getEnv("LLM_API_KEY"),
  LLM_MODEL: process.env.LLM_MODEL ?? "deepseek-chat",
  AUTH_SECRET: process.env.AUTH_SECRET,
};
