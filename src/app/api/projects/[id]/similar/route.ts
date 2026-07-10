import { db } from "@/db";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

const STOPWORDS = new Set([
  "것","수","및","또는","이","그","있는","해야","통해","대한","위한","관련",
  "가능","필요","제공","지원","사용","기능","요구사항","시스템","구축","방안",
  "제시","작성","포함","내용","없음","있음","경우","등","위해","따라","대해",
  "통한","대비","기반","통하여","때문","매우","모든","각종","다양","통해",
  "있도록","있으며","통합","가장","갖추","결과","계획","관리","구분","구성",
  "그리고","기준","기타","년도","다른","다음","당해","대상","또한","만족",
  "목적","방법","범위","부분","사항","설계","설정","성능","수행","시행",
  "업무","없는","여부","연계","영향","예정","완료","요청","위한","유지",
  "이미","이상","이후","일정","자체","작업","장애","저장","적용","정도",
  "정의","조건","조치","주요","준수","중인","지원","진행","측정","추진",
  "추가","축소","출력","통한","특정","판단","필수","필요","하고","하게",
  "함께","해당","확보","확인","환경","활용","회신","모든","각종",
]);

function extractKeywords(texts: string[]): string[] {
  const words = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    (text.match(/[가-힣]{2,}/g) || []).forEach((w: string) => {
      if (!STOPWORDS.has(w) && w.length >= 2) words.add(w);
    });
    (text.match(/[A-Za-z]{2,}/g) || []).forEach((t: string) => words.add(t));
  }
  return Array.from(words).slice(0, 15);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const reqs = (await db.execute(sql`
      SELECT source_text FROM requirements
      WHERE project_id = ${id}::uuid
      ORDER BY "order" LIMIT 20
    `)).rows ?? [];

    if (reqs.length === 0) {
      return NextResponse.json({ similar: [], message: "요구사항이 없습니다." });
    }

    const keywords = extractKeywords(reqs.map((r: any) => r.source_text));
    if (keywords.length < 2) {
      return NextResponse.json({ similar: [], message: "키워드 부족" });
    }

    const [proj] = (await db.execute(sql`
      SELECT org_id FROM projects WHERE id = ${id}::uuid LIMIT 1
    `)).rows ?? [];
    if (!proj) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const tsquery = keywords.join(" | ");

    // Get matching chunks with scores
    const chunks = (await db.execute(sql`
      SELECT
        dc.document_id,
        d.name AS document_name,
        dc.content,
        dc.page,
        ROUND(ts_rank(
          to_tsvector('simple', COALESCE(dc.content, '')),
          to_tsquery('simple', ${tsquery})
        )::numeric * 1000) AS score
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE
        d.type = 'rfp'
        AND d.org_id = ${proj.org_id}::uuid
        AND dc.document_id != ALL(
          SELECT dd.id FROM documents dd WHERE dd.project_id = ${id}::uuid
        )
        AND to_tsvector('simple', COALESCE(dc.content, '')) @@ to_tsquery('simple', ${tsquery})
      ORDER BY score DESC
    `)).rows ?? [];

    // Group and compute stats
    const grouped: Record<string, any> = {};
    for (const row of chunks as any[]) {
      const docId = row.document_id;
      if (!grouped[docId]) {
        grouped[docId] = { docId, docName: row.document_name, chunks: [], scores: [] };
      }
      grouped[docId].chunks.push({
        content: (row.content || "").slice(0, 300),
        page: row.page,
        score: Number(row.score),
      });
      grouped[docId].scores.push(Number(row.score));
    }

    const similar = Object.values(grouped)
      .map((g: any) => {
        const matchCount = g.chunks.length;
        const avgScore = Math.round(g.scores.reduce((a: number, b: number) => a + b, 0) / matchCount);
        return {
          docId: g.docId,
          docName: g.docName,
          matchCount,
          avgScore,
          chunks: g.chunks.sort((a: any, b: any) => b.score - a.score).slice(0, 5),
        };
      })
      .sort((a: any, b: any) => b.avgScore - a.avgScore);

    return NextResponse.json({ similar, totalRequirements: reqs.length, keywords: keywords.slice(0, 10) });
  } catch (error: any) {
    console.error("Similar search failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
