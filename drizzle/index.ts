import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

// 테스트용: 연결 확인
export async function testConnection() {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("✅ DB 연결 성공:", result.rows[0].now);
    return true;
  } catch (error) {
    console.error("❌ DB 연결 실패:", error);
    return false;
  }
}
