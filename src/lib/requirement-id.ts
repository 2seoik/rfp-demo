// ─── Requirement ID Detection & Normalization ──────────────
// 순수 함수만 포함. LLM 호출이나 DB 접근 없음.

/** 개별 요구사항 ID 검출 결과 */
export interface DetectedId {
  /** 원본 텍스트 그대로 (대소문자 보존) */
  raw: string;
  /** 정규화된 ID (uppercase, 공백 제거). null이면 검증 실패 */
  normalized: string | null;
  /** 문서 내 문자 오프셋 */
  position: number;
}

/** 요구사항 ID 정규식: 2~4자 대문자 + 하이픈 + 3자리 숫자 */
const REQ_ID_PATTERN = /[A-Z]{2,4}-\d{3}/gi;

/** 이미 알려진 오탐 패턴 (정규식 검출 후 2차 필터링) */
const FALSE_POSITIVE_IDS = new Set<string>([
  // 일반적인 날짜/버전/페이지 번호는 이미 [A-Z]{2,4}-\d{3}에 걸리지 않음
]);

/**
 * 텍스트 전체에서 요구사항 ID로 보이는 모든 패턴을 검출한다.
 * 검출 위치 정보를 함께 반환하여 M1-C 단계에서 경계 분할에 활용할 수 있다.
 */
export function detectAllIds(text: string): DetectedId[] {
  const results: DetectedId[] = [];
  const regex = new RegExp(REQ_ID_PATTERN.source, REQ_ID_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const normalized = normalizeId(raw);
    results.push({
      raw,
      normalized,
      position: match.index,
    });
  }
  return results;
}

/**
 * 원시 ID 문자열을 정규화한다.
 * - 대문자 변환
 * - 앞뒤 공백 제거
 * - /^[A-Z]{2,4}-\d{3}$/ 패턴 검증
 * - 알려진 오탐 제외
 * 실패 시 null 반환
 */
export function normalizeId(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  if (!/^[A-Z]{2,4}-\d{3}$/.test(trimmed)) return null;
  if (FALSE_POSITIVE_IDS.has(trimmed)) return null;
  return trimmed;
}

/**
 * 문자열이 유효한 요구사항 ID인지 검사한다.
 * LLM 응답 검증에 사용한다.
 */
export function isValidRequirementId(id: string): boolean {
  return normalizeId(id) !== null;
}

/**
 * 검출된 ID 목록에서 유효한 ID만 추출하고 중복을 제거한다.
 */
export function getUniqueNormalizedIds(detected: DetectedId[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const d of detected) {
    if (d.normalized && !seen.has(d.normalized)) {
      seen.add(d.normalized);
      result.push(d.normalized);
    }
  }
  return result;
}

/**
 * 검출된 ID 목록에서 prefix(ECR, SFR 등)별 개수 통계를 반환한다.
 */
export function getIdPrefixStats(ids: string[]): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const id of ids) {
    const prefix = id.replace(/-\d+$/, "");
    stats[prefix] = (stats[prefix] || 0) + 1;
  }
  return stats;
}

/**
 * 전체 텍스트 ID 집합 대비 excerpt ID 집합의 커버리지를 계산한다.
 */
export function getExcerptCoverage(
  fullTextIds: string[],
  excerptIds: string[]
): {
  inside: string[];
  outside: string[];
  insideCount: number;
  outsideCount: number;
  totalCount: number;
  coveragePct: number;
} {
  const excerptSet = new Set(excerptIds);
  const inside = fullTextIds.filter((id) => excerptSet.has(id));
  const outside = fullTextIds.filter((id) => !excerptSet.has(id));
  return {
    inside,
    outside,
    insideCount: inside.length,
    outsideCount: outside.length,
    totalCount: fullTextIds.length,
    coveragePct:
      fullTextIds.length > 0
        ? Math.round((inside.length / fullTextIds.length) * 100)
        : 0,
  };
}

// ─── ID Boundary Block Creation ───────────────────────────

/** ID 경계 기반 분할 블록 */
export interface RequirementBlock {
  /** 해당 블록에 기대되는 정규화된 요구사항 ID (없으면 null) */
  expectedId: string | null;
  /** 블록 텍스트 범위의 시작 offset (excerpt 기준) */
  startOffset: number;
  /** 블록 텍스트 범위의 끝 offset (excerpt 기준) */
  endOffset: number;
  /** 실제 텍스트 내용 */
  text: string;
}

/**
 * 검출된 ID 위치를 기반으로 excerpt를 ID 경계 블록으로 분할한다.
 * 각 블록은 "현재 ID 위치"부터 "다음 ID 직전"까지를 포함한다.
 * 첫 ID 이전 텍스트와 마지막 ID 이후 텍스트는 ID 없는 블록으로 취급한다.
 * 하나의 블록이 5000자를 초과하면 보조 청킹으로 분할한다.
 */
export function createIdBoundaryBlocks(
  excerpt: string,
  maxBlockSize = 5000,
  overlap = 300
): RequirementBlock[] {
  // excerpt 내 모든 ID 위치 검출
  const detected = detectAllIds(excerpt);
  const validDetected = detected.filter((d) => d.normalized !== null);

  if (validDetected.length === 0) {
    // ID가 전혀 없으면 기존 fixed-size와 유사하게 분할
    return [{
      expectedId: null,
      startOffset: 0,
      endOffset: excerpt.length,
      text: excerpt,
    }];
  }

  const blocks: RequirementBlock[] = [];

  // 첫 ID 이전 preamble
  if (validDetected[0].position > 0) {
    const preamble = excerpt.slice(0, validDetected[0].position);
    if (preamble.trim().length > 0) {
      blocks.push({
        expectedId: validDetected[0].normalized,
        startOffset: Math.max(0, validDetected[0].position - 200),
        endOffset: Math.min(excerpt.length, validDetected[0].position + maxBlockSize),
        text: excerpt.slice(
          Math.max(0, validDetected[0].position - 200),
          Math.min(excerpt.length, validDetected[0].position + maxBlockSize)
        ),
      });
    }
  }

  // ID 경계 블록: ID[i] ~ ID[i+1] 직전
  for (let i = 0; i < validDetected.length; i++) {
    const current = validDetected[i];
    const next = validDetected[i + 1];
    const blockStart = Math.max(0, current.position - 100);
    const blockEnd = next
      ? next.position  // 다음 ID 바로 직전까지
      : Math.min(excerpt.length, current.position + maxBlockSize);

    // blockEnd가 blockStart보다 작으면 보정
    const actualEnd = Math.max(blockEnd, blockStart + 100);
    const text = excerpt.slice(blockStart, Math.min(excerpt.length, actualEnd));

    // 블록이 너무 크면 보조 청킹
    if (text.length > maxBlockSize) {
      const subBlocks = splitLongBlock(text, current.normalized!, maxBlockSize, overlap);
      blocks.push(...subBlocks);
    } else {
      blocks.push({
        expectedId: current.normalized,
        startOffset: blockStart,
        endOffset: actualEnd,
        text,
      });
    }
  }

  return blocks;
}

/**
 * 긴 블록을 보조 청킹. 요구사항 하나를 여러 청크로 분할하되,
 * 모든 청크가 동일한 expectedId를 공유한다.
 */
function splitLongBlock(
  text: string,
  expectedId: string,
  maxSize: number,
  overlap: number
): RequirementBlock[] {
  const blocks: RequirementBlock[] = [];
  for (let i = 0; i < text.length; i += maxSize - overlap) {
    blocks.push({
      expectedId,
      startOffset: i,
      endOffset: Math.min(text.length, i + maxSize),
      text: text.slice(i, Math.min(text.length, i + maxSize)),
    });
    if (i + maxSize >= text.length) break;
  }
  return blocks;
}

// ─── Duplicate Candidate Selection ────────────────────────

/**
 * 동일 ID의 여러 후보 블록 중 품질 점수가 가장 높은 대표 블록을 선택한다.
 * 품질 점수는 텍스트 길이, 구조적 마커(세부내용/상세설명) 포함 여부,
 * 숫자 정보 포함 여부를 종합하여 계산한다.
 */
export interface CandidateScore {
  block: RequirementBlock;
  score: number;
  hasDetailMarker: boolean;
  length: number;
}

export function scoreCandidate(block: RequirementBlock): CandidateScore {
  // 구조적 마커: RFP 요구사항 상세에 흔히 등장하는 패턴
  const detailMarkers = ["세부내용", "상세설명", "정의", "[H/W]", "[S/W]", "○", "※"];
  const hasDetailMarker = detailMarkers.some((m) => block.text.includes(m));

  let score = 0;
  // 텍스트 길이 점수 (길수록 완성도 높음, 최대 35점)
  score += Math.min(35, Math.floor(block.text.length / 50));
  // 구조적 마커 포함 시 보너스 (25점)
  if (hasDetailMarker) score += 25;
  // ID와 설명 텍스트가 같이 있으면 보너스 (25점)
  if (
    block.expectedId &&
    block.text.includes(block.expectedId) &&
    block.text.length > 200
  )
    score += 25;
  // 숫자 정보 포함 보너스 (연도, 기간, 개수 등, 15점)
  if (/\d{4}|\d+개월|\d+일|\d+년|\d+명|\d+대/.test(block.text)) score += 15;

  return {
    block,
    score,
    hasDetailMarker,
    length: block.text.length,
  };
}

/**
 * 동일 ID의 중복 후보 블록 중 가장 높은 품질 점수를 가진 블록만 선택한다.
 */
export function selectBestCandidates(
  blocks: RequirementBlock[]
): RequirementBlock[] {
  const grouped = new Map<string, RequirementBlock[]>();
  const noIdBlocks: RequirementBlock[] = [];

  for (const block of blocks) {
    if (block.expectedId) {
      const existing = grouped.get(block.expectedId) || [];
      existing.push(block);
      grouped.set(block.expectedId, existing);
    } else {
      noIdBlocks.push(block);
    }
  }

  const result: RequirementBlock[] = [];

  // 각 ID 그룹에서 최고 점수 블록 선택
  for (const [id, candidates] of grouped) {
    if (candidates.length === 1) {
      result.push(candidates[0]);
    } else {
      const scored = candidates.map(scoreCandidate);
      // 점수순 정렬, 동점이면 긴 텍스트 우선
      scored.sort((a, b) => b.score - a.score || b.length - a.length);
      result.push(scored[0].block);
    }
  }

  // ID 없는 블록도 포함
  result.push(...noIdBlocks);

  // offset 순으로 재정렬
  result.sort((a, b) => a.startOffset - b.startOffset);
  return result;
}
