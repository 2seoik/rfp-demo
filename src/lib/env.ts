import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env file manually (tsx/Node doesn't auto-load .env)
try {
  const envPath = resolve(__dirname, "../../.env");
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes if any
    const cleaned = value.replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = cleaned;
    }
  }
} catch {
  // .env 파일이 없으면 무시 (다른 환경에서 알아서 주입)
}

const getEnv = (key: string, fallback?: string): string => {
  const val = process.env[key] ?? fallback;
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
};

export const env = {
  DATABASE_URL: process.env.DATABASE_URL, // 선택적 (DB 없이 LLM 테스트 가능)
  LLM_API_BASE: process.env.LLM_API_BASE, // provider.ts가 기본값 없이 설정, .env에서 주입
  LLM_API_KEY: getEnv("LLM_API_KEY"),
  LLM_MODEL: process.env.LLM_MODEL,      // provider.ts getPrimaryModel()에서 기본값 "kimi-k2.6"
  AUTH_SECRET: process.env.AUTH_SECRET,
};
