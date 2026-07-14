import { db } from "drizzle";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

// ── 불용어: 일반 + RFP 템플릿 보일러플레이트 라벨 ──────────────
const STOPWORDS = new Set([
  // 일반 불용어
  "것","수","및","또는","이","그","있는","해야","통해","대한","위한","관련",
  "가능","필요","제공","지원","사용","기능","요구사항","시스템","구축","방안",
  "제시","작성","포함","내용","없음","있음","경우","등","위해","따라","대해",
  "통한","대비","기반","통하여","때문","매우","모든","각종","다양",
  "있도록","있으며","통합","가장","갖추","결과","계획","관리","구분","구성",
  "그리고","기준","기타","년도","다른","다음","당해","대상","또한","만족",
  "목적","방법","범위","부분","사항","설계","설정","성능","수행","시행",
  "업무","없는","여부","연계","영향","예정","완료","요청","위한","유지",
  "이미","이상","이후","일정","자체","작업","장애","저장","적용","정도",
  "정의","조건","조치","주요","준수","중인","진행","측정","추진",
  "추가","축소","출력","특정","판단","필수","필요","하고","하게",
  "함께","해당","확보","확인","환경","활용","회신",
  // RFP 템플릿 보일러플레이트 라벨
  "분류","고유번호","명칭","세부","세부내용","상세설명",
  "산출정보","관련요구사항","응락수준",
  "원","요구","사항","요구사항명","요구사항내용",
  "참조","참고","별첨","붙임",
]);

// ── 키워드 추출 (source_text → 최대 15개) ────────────────
function extractKeywords(text: string): string[] {
  if (!text) return [];
  const words = new Set<string>();
  (text.match(/[가-힣]{2,}/g) || []).forEach((w) => {
    if (!STOPWORDS.has(w) && w.length >= 2) words.add(w);
  });
  (text.match(/[A-Za-z]{2,}/g) || []).forEach((t) => words.add(t));
  return Array.from(words).slice(0, 15);
}

// ── 보일러플레이트 제거 (표시용) ─────────────────────────────
function stripBoilerplate(text: string): string {
  return text
    .replace(
      /^(요구사항\s*(분류|고유번호|명칭|세부내용|명|내용|상세|상세설명)|산출정보|관련요구사항|응락수준|정의)\s*[:：]?\s*.*$/gm,
      ""
    )
    .replace(/^[○●•·]\s*/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ── API 핸들러 ─────────────────────────────────────────────
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. 프로젝트 정보
    const [proj] = (await db.execute(sql`
      SELECT org_id FROM projects WHERE id = ${id}::uuid LIMIT 1
    `)).rows ?? [];
    if (!proj) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 2. 현재 프로젝트의 모든 요구사항
    const sourceReqs = (await db.execute(sql`
      SELECT id, original_id, name, source_text FROM requirements
      WHERE project_id = ${id}::uuid
      ORDER BY "order"
    `)).rows ?? [];

    if (sourceReqs.length === 0) {
      return NextResponse.json({
        similar: [],
        sourceReqCount: 0,
        message: "요구사항이 없습니다.",
      });
    }

    // ── 현재 프로젝트 + 타겟 프로젝트 요약 정보 ──
    const extBizName = (ht: string) => {
      const p = /(?:사\s*업\s*명|사업명)\s*[:：]?\s*(.+?)(?:\n|$)/gi;
      let m;
      while ((m = p.exec(ht)) !== null) {
        const c = m[1].trim();
        if (c.length >= 5 && !/^[·.\s\d]+$/.test(c)) return c.replace(/\t/g,'').replace(/\s{2,}/g,' ');
      }
      // fallback: find first non-TOC non-empty line longer than 10 chars
      const line = ht.split("\n").find((l: string) => {
        const t = l.trim();
        return t.length > 10 && (t.match(/[·.]/g)||[]).length < 4;
      });
      return line?.trim().replace(/\t/g,'').replace(/\s{2,}/g,' ') || "";
    };

    const [sourceDoc] = (await db.execute(sql`
      SELECT d.name, p.period, p.name AS project_name, d.header_text FROM documents d
      JOIN projects p ON p.id = d.project_id
      WHERE d.project_id = ${id}::uuid AND d.type = 'rfp'
      LIMIT 1
    `)).rows ?? [];

    const sourceTopType = await db.execute(sql`
      SELECT type FROM requirements
      WHERE project_id = ${id}::uuid
      GROUP BY type ORDER BY COUNT(*) DESC LIMIT 1
    `);

    const src = sourceDoc as any;
    const sourceInfo = {
      name: src?.project_name || "",
      bizName: src?.header_text ? extBizName(src.header_text) : "",
      period: src?.period || "",
      docName: src?.name || "",
      reqCount: sourceReqs.length,
      topType: (sourceTopType.rows?.[0] as any)?.type || "",
    };

    // 타겟 프로젝트 상세 (이후 그룹화 시 병합)
    const targetDetails = (await db.execute(sql`
      SELECT
        p.id AS project_id, p.name, p.period,
        d.name AS doc_name, d.header_text,
        (SELECT COUNT(*) FROM requirements WHERE project_id = p.id) AS req_count
      FROM projects p
      JOIN documents d ON d.project_id = p.id AND d.type = 'rfp'
      WHERE p.org_id = ${(proj as any).org_id}::uuid AND p.id != ${id}::uuid
    `)).rows ?? [];

    const targetInfoMap: Record<string, any> = {};
    for (const td of targetDetails as any[]) {
      targetInfoMap[td.project_id] = {
        bizName: td.header_text ? extBizName(td.header_text) : "",
        period: td.period || "",
        docName: td.doc_name || "",
        reqCount: Number(td.req_count) || 0,
      };
    }

    // 3. 키워드 추출 (표시용) + 요구사항별 OR tsquery 생성
    const keywords = extractKeywords(
      sourceReqs.map((r: any) => r.source_text).join(" ")
    );

    // 요구사항별 OR tsquery (공백 이스케이프 포함)
    const sourceRows = (sourceReqs as any[])
      .map((r) => {
        const kw = extractKeywords(r.source_text);
        if (kw.length < 2) return null;
        const escaped = kw.map((w) => `'${w.replace(/'/g, "''")}'`).join(" | ");
        return { id: r.id, tsqueryStr: escaped };
      })
      .filter(Boolean);

    const orgId = (proj as any).org_id;
    const hasSourceQueries = sourceRows.length > 0;

    // ── 4a. 문서 헤더 비교 (문서수준 유사도) ──
    let headerResults: any[] = [];
    let headerKwStr = "";

    const [currentDoc] = (await db.execute(sql`
      SELECT header_text FROM documents
      WHERE project_id = ${id}::uuid AND type = 'rfp' AND header_text IS NOT NULL
      LIMIT 1
    `)).rows ?? [];

    if (currentDoc && (currentDoc as any).header_text) {
      const headerText: string = (currentDoc as any).header_text;
      const headerKw = extractKeywords(headerText);
      if (headerKw.length >= 2) {
        headerKwStr = headerKw.map((w) => `'${w.replace(/'/g, "''")}'`).join(" | ");

        headerResults = (await db.execute(sql`
          SELECT
            d.project_id AS target_project_id,
            p.name AS target_project_name,
            ROUND(ts_rank(
              to_tsvector('simple', d.header_text),
              to_tsquery('simple', ${headerKwStr})
            )::numeric * 500) AS header_score,
            ts_headline(
              'simple',
              d.header_text,
              to_tsquery('simple', ${headerKwStr}),
              'StartSel=<mark>, StopSel=</mark>, MaxWords=40, MinWords=10, ShortWord=2'
            ) AS header_headline
          FROM documents d
          JOIN projects p ON p.id = d.project_id
            AND p.org_id = ${orgId}::uuid
          WHERE d.type = 'rfp'
            AND d.project_id != ${id}::uuid
            AND d.header_text IS NOT NULL
            AND to_tsvector('simple', d.header_text)
                @@ to_tsquery('simple', ${headerKwStr})
          ORDER BY header_score DESC
        `)).rows ?? [];
      }
    }

    // ── 자기 자신과의 ts_rank 계산 (정규화 기준점, 동일 문서 = 100%) ──
    let headerSelfScore = 0;
    if (headerKwStr && (currentDoc as any).header_text) {
      const selfRow = (await db.execute(sql`
        SELECT ts_rank(
          to_tsvector('simple', ${(currentDoc as any).header_text}),
          to_tsquery('simple', ${headerKwStr})
        )::numeric AS self_rank
      `)).rows ?? [];
      const selfRankRaw = Number((selfRow[0] as any)?.self_rank || 0);
      headerSelfScore = Math.round(selfRankRaw * 500);
    }

    // ── 4b. 요구사항별 tsquery VALUES 절 구성 ──
    let contentPairsQuery;
    if (hasSourceQueries) {
      const valueFragments = sourceRows.map(
        (sr) => sql`(${sr!.id}::uuid, ${sr!.tsqueryStr})`
      );
      const valuesClause = sql.join(valueFragments, sql`, `);

      contentPairsQuery = sql`
        content_base AS (
          SELECT
            sq.source_id,
            r1.original_id AS source_oid,
            r1.name AS source_name,
            r2.id AS target_id,
            r2.original_id AS target_oid,
            r2.name AS target_name,
            LEFT(r2.source_text, 300) AS target_text,
            ts_headline(
              'simple',
              r2.source_text,
              to_tsquery('simple', sq.tsquery_str),
              'StartSel=<mark>, StopSel=</mark>, MaxWords=60, MinWords=15, ShortWord=2'
            ) AS target_headline,
            r2.project_id AS target_project_id,
            p.name AS target_project_name,
            ROUND(
              ts_rank(
                to_tsvector('simple', r2.source_text),
                to_tsquery('simple', sq.tsquery_str)
              )::numeric * 500
            ) AS score,
            'content' AS match_type
          FROM (VALUES ${valuesClause}) AS sq(source_id, tsquery_str)
          JOIN requirements r1 ON r1.id = sq.source_id
          JOIN requirements r2 ON r2.project_id != r1.project_id
          JOIN projects p ON p.id = r2.project_id
            AND p.org_id = ${orgId}::uuid
          WHERE to_tsvector('simple', r2.source_text)
                @@ to_tsquery('simple', sq.tsquery_str)
        )
      `;
    }

    // 5. 단일 쿼리: ID 참고 + 내용 FTS
    const allPairs = (await db.execute(sql`
      WITH id_pairs AS (
        SELECT
          r1.id AS source_id,
          r1.original_id AS source_oid,
          r1.name AS source_name,
          r2.id AS target_id,
          r2.original_id AS target_oid,
          r2.name AS target_name,
          LEFT(r2.source_text, 300) AS target_text,
          '' AS target_headline,
          r2.project_id AS target_project_id,
          p.name AS target_project_name,
          0 AS score,
          'id' AS match_type
        FROM requirements r1
        JOIN requirements r2
          ON r1.original_id = r2.original_id
          AND r1.project_id != r2.project_id
        JOIN projects p ON p.id = r2.project_id
          AND p.org_id = ${orgId}::uuid
        WHERE r1.project_id = ${id}::uuid
      )${hasSourceQueries ? sql`,` : sql``}
      ${hasSourceQueries ? contentPairsQuery! : sql``}
      SELECT * FROM id_pairs
      ${hasSourceQueries ? sql`UNION ALL` : sql``}
      ${hasSourceQueries ? sql`SELECT * FROM content_base` : sql``}
      ORDER BY target_project_id, match_type DESC, score DESC
    `)).rows ?? [];

    // 6. 타겟 프로젝트별 그룹화 (헤더 정보 + 요구사항 페어)
    const projectGroups: Record<
      string,
      {
        projectId: string;
        projectName: string;
        headerScore: number;
        headerHeadline: string;
        idPairs: any[];
        contentPairs: any[];
        idMatchedSourceIds: Set<string>;
        contentMatchedSourceIds: Set<string>;
      }
    > = {};

    // 헤더 비교 결과로 그룹 시드 생성
    for (const hr of headerResults as any[]) {
      const pid = hr.target_project_id;
      projectGroups[pid] = {
        projectId: pid,
        projectName: hr.target_project_name,
        headerScore: headerSelfScore > 0 ? Math.min(100, Math.round(Number(hr.header_score) / headerSelfScore * 100)) : Number(hr.header_score),
        headerHeadline: hr.header_headline || "",
        idPairs: [],
        contentPairs: [],
        idMatchedSourceIds: new Set(),
        contentMatchedSourceIds: new Set(),
      };
    }

    // 요구사항 페어 추가
    for (const row of allPairs as any[]) {
      const pid = row.target_project_id;
      if (!projectGroups[pid]) {
        projectGroups[pid] = {
          projectId: pid,
          projectName: row.target_project_name,
          headerScore: 0,
          headerHeadline: "",
          idPairs: [],
          contentPairs: [],
          idMatchedSourceIds: new Set(),
          contentMatchedSourceIds: new Set(),
        };
      }

      const pair = {
        sourceId: row.source_id,
        sourceOriginalId: row.source_oid,
        sourceName: row.source_name,
        targetId: row.target_id,
        targetOriginalId: row.target_oid,
        targetName: row.target_name,
        targetText: row.target_text || "",
        targetHeadline: row.target_headline || "",
        matchType: row.match_type as "id" | "content",
        score: Number(row.score),
      };

      if (row.match_type === "id") {
        projectGroups[pid].idPairs.push(pair);
        projectGroups[pid].idMatchedSourceIds.add(row.source_id);
      } else {
        projectGroups[pid].contentPairs.push(pair);
        projectGroups[pid].contentMatchedSourceIds.add(row.source_id);
      }
    }

    // 7. 유사도 계산 + 응답 조립
    const totalSource = sourceReqs.length;

    const similar = Object.values(projectGroups)
      .map((g) => {
        const idMatchCount = g.idMatchedSourceIds.size;

        // 요구사항 유사도 = 매칭 비율 (몇 %의 요구사항이 매칭됐는가)
        const contentSimilarity =
          totalSource > 0
            ? Math.round((g.contentMatchedSourceIds.size / totalSource) * 100)
            : 0;

        const headerSimilarity = g.headerScore;

        // 종합 유사도 = 사업개요(header) 1차 신호 (요구사항은 근거 표시용)
        const overallSimilarity = headerSimilarity;

        const idOverlap =
          totalSource > 0
            ? Math.round((idMatchCount / totalSource) * 100)
            : 0;

        // 중복 제거 페어 병합: content (점수순) → id
        const seenPairs = new Set<string>();
        const mergedPairs: any[] = [];

        for (const p of [
          ...g.contentPairs.sort((a: any, b: any) => b.score - a.score),
          ...g.idPairs,
        ]) {
          const key = `${p.sourceId}::${p.targetId}`;
          if (!seenPairs.has(key)) {
            seenPairs.add(key);
            mergedPairs.push(p);
          }
        }

        // 설명 조립 (사업개요 = 1차 신호, 요구사항 = 근거)
        let explanation = "";
        const hdrLabel =
          headerSimilarity >= 80
            ? "매우 유사한"
            : headerSimilarity >= 50
              ? "유사한"
              : headerSimilarity > 0
                ? "일부 유사한"
                : "유사하지 않은";

        if (headerSimilarity >= 60) {
          explanation = `${g.projectName}은(는) 사업개요 기준 ${hdrLabel} 프로젝트입니다 (문서 유사도 ${headerSimilarity}%).`;
        } else if (headerSimilarity > 0) {
          explanation = `${g.projectName}은(는) 사업개요가 일부 유사합니다 (${headerSimilarity}%).`;
        } else {
          explanation = `${g.projectName}과(와) 사업개요 수준의 유사성을 찾지 못했습니다.`;
        }

        if (contentSimilarity >= 80) {
          explanation += ` ${totalSource}개 요구사항 대부분이 키워드 매칭됩니다.`;
        } else if (g.contentPairs.length > 0) {
          explanation += ` ${g.contentMatchedSourceIds.size}개 요구사항에서 ${g.contentPairs.length}건의 키워드 매칭이 발견되었습니다.`;
        }

        if (idOverlap > 30) {
          explanation += ` ${idOverlap}%의 요구사항 ID가 동일한 RFP 템플릿을 공유합니다.`;
        }

        return {
          projectId: g.projectId,
          projectName: g.projectName,
          overallSimilarity,
          headerSimilarity,
          headerMatchText: g.headerHeadline,
          bizName: targetInfoMap[g.projectId]?.bizName || "",
          period: targetInfoMap[g.projectId]?.period || "",
          docName: targetInfoMap[g.projectId]?.docName || "",
          reqCount: targetInfoMap[g.projectId]?.reqCount || 0,
          matchedPairs: mergedPairs.slice(0, 80),
          idMatchCount,
          contentMatchCount: g.contentPairs.length,
          breakdown: {
            headerSimilarity,
            idOverlap,
            contentSimilarity: contentSimilarity,
          },
          explanation,
        };
      })
      .sort((a, b) => b.overallSimilarity - a.overallSimilarity);

    return NextResponse.json({
      sourceProject: sourceInfo,
      similar,
      sourceReqCount: totalSource,
      keywords: keywords.slice(0, 10),
    });
  } catch (error: any) {
    console.error("Similar search failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
