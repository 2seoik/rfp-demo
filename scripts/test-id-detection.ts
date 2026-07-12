// ─── ID 검출 모듈 검증 스크립트 ───────────────────────────
// LLM 호출 없이 순수 함수만 테스트한다.

import {
  detectAllIds,
  normalizeId,
  isValidRequirementId,
  getUniqueNormalizedIds,
  getIdPrefixStats,
  getExcerptCoverage,
  createIdBoundaryBlocks,
  selectBestCandidates,
  scoreCandidate,
  type RequirementBlock,
} from "../src/lib/requirement-id";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
  }
}

// ── normalizeId ─────────────────────────────────────────
console.log("\n📋 normalizeId");
assert(normalizeId("ECR-001") === "ECR-001", "ECR-001 → ECR-001");
assert(normalizeId("ecr-001") === "ECR-001", "ecr-001 → ECR-001 (lowercase)");
assert(normalizeId("ECR-001 ") === "ECR-001", "trailing space removed");
assert(normalizeId(" ECR-001") === "ECR-001", "leading space removed");
assert(normalizeId("SFR-013") === "SFR-013", "SFR-013 valid");
assert(normalizeId("COR-006") === "COR-006", "COR-006 valid");
assertEqual(normalizeId("ECR-1"), null, "ECR-1 → null (digit count < 3)");
assertEqual(normalizeId("ECR-0001"), null, "ECR-0001 → null (digit count > 3)");
assertEqual(normalizeId("E-001"), null, "E-001 → null (letter count < 2)");
assertEqual(normalizeId("ABCDE-001"), null, "ABCDE-001 → null (letter count > 4)");
assertEqual(normalizeId("ECR001"), null, "ECR001 → null (no hyphen)");
assertEqual(normalizeId(""), null, "empty → null");
assert(normalizeId("abc-123") === "ABC-123", "abc-123 → ABC-123 (lowercase+hyphen)");

// ── isValidRequirementId ──────────────────────────────────
console.log("\n📋 isValidRequirementId");
assert(isValidRequirementId("ECR-001"), "ECR-001 is valid");
assert(isValidRequirementId("SFR-013"), "SFR-013 is valid");
assert(!isValidRequirementId("ECR-1"), "ECR-1 is invalid");
assert(!isValidRequirementId(""), "empty invalid");
assert(!isValidRequirementId("just text"), "random text invalid");

// ── detectAllIds ──────────────────────────────────────────
console.log("\n📋 detectAllIds");

const text1 =
  "요구사항 고유번호 ECR-001\n" +
  "요구사항 명칭 시스템 공통 요구사항\n" +
  "요구사항 고유번호 ECR-002\n" +
  "다음은 SFR-001~SFR-005까지 나열한다\n";

const detected1 = detectAllIds(text1);
assert(detected1.length >= 3, `detected count: ${detected1.length} (expected ≥3)`);
assert(detected1.some((d) => d.raw === "ECR-001"), "ECR-001 detected");
assert(detected1.some((d) => d.raw === "ECR-002"), "ECR-002 detected");
// Check positions
const ecr001 = detected1.find((d) => d.normalized === "ECR-001");
assert(ecr001 !== undefined && ecr001.position > 0, "ECR-001 has position > 0");

// ── detectAllIds: 대소문자 혼합 ───────────────────────────
const text2 = "ecr-001 과 Sfr-005 는 동시에 존재한다";
const detected2 = detectAllIds(text2);
assert(detected2.length === 2, `case insensitive: ${detected2.length}`);
assert(detected2.some((d) => d.raw === "ecr-001" && d.normalized === "ECR-001"), "ecr-001 normalized");
assert(detected2.some((d) => d.raw === "Sfr-005" && d.normalized === "SFR-005"), "Sfr-005 normalized");

// ── detectAllIds: 오탐 방지 (날짜/버전/페이지) ──────────────
console.log("\n📋 detectAllIds: false positive prevention");
const falseText = "2026-07-11 버전 v2.0 페이지 - 1 - 섹션 1.2.3";
const falseDetected = detectAllIds(falseText);
assert(falseDetected.length === 0, `no false positives: ${falseDetected.length} detected`);

// ── detectAllIds: 2자 prefix도 검출 ──────────────────────
const text3 = "요구사항 ZZ-001 과 AB-999 도 검출해야 한다";
const detected3 = detectAllIds(text3);
assert(detected3.some((d) => d.normalized === "ZZ-001"), "ZZ-001 detected (2-char prefix)");
assert(detected3.some((d) => d.normalized === "AB-999"), "AB-999 detected");

// ── getUniqueNormalizedIds ───────────────────────────────
console.log("\n📋 getUniqueNormalizedIds");
const dupIds: any[] = [
  { raw: "ECR-001", normalized: "ECR-001", position: 100 },
  { raw: "ecr-001", normalized: "ECR-001", position: 200 },
  { raw: "SFR-001", normalized: "SFR-001", position: 300 },
  { raw: "bad", normalized: null, position: 400 },
];
assertEqual(getUniqueNormalizedIds(dupIds), ["ECR-001", "SFR-001"], "dedup: 4→2");

// ── getIdPrefixStats ─────────────────────────────────────
console.log("\n📋 getIdPrefixStats");
const ids = ["ECR-001", "ECR-002", "ECR-003", "SFR-001", "SFR-002", "COR-001"];
assertEqual(getIdPrefixStats(ids), { ECR: 3, SFR: 2, COR: 1 }, "prefix stats");

// ── getExcerptCoverage ───────────────────────────────────
console.log("\n📋 getExcerptCoverage");
const full = ["ECR-001", "ECR-002", "ECR-003", "SFR-001", "SFR-002"];
const excp = ["ECR-001", "ECR-002"];
const cov = getExcerptCoverage(full, excp);
assert(cov.insideCount === 2, "2 inside");
assert(cov.outsideCount === 3, "3 outside");
assert(cov.totalCount === 5, "5 total");
assert(cov.coveragePct === 40, "coverage 40%");
assertEqual(cov.inside, ["ECR-001", "ECR-002"], "inside list correct");
assertEqual(cov.outside, ["ECR-003", "SFR-001", "SFR-002"], "outside list correct");

// ── createIdBoundaryBlocks ────────────────────────────────
console.log("\n📋 createIdBoundaryBlocks");

// ID 2개가 포함된 기본 텍스트
const basicExcerpt =
  "일부 서문 텍스트.\n" +
  "요구사항 고유번호 ECR-001\n" +
  "요구사항 명칭 시스템 공통 요구사항\n" +
  "요구사항 상세설명 정의 도입 시스템에 대한 공통 요구사항\n" +
  "세부내용 도입되는 모든 장비 운영의 안정성 확보...\n" +
  "요구사항 고유번호 ECR-002\n" +
  "요구사항 명칭 웹한글 기안기 서버 도입\n";

const basicBlocks = createIdBoundaryBlocks(basicExcerpt);
assert(basicBlocks.length >= 2, `blocks created: ${basicBlocks.length} (expected ≥2)`);
assert(
  basicBlocks.some((b) => b.expectedId === "ECR-001"),
  "first block has ECR-001"
);
assert(
  basicBlocks.some((b) => b.expectedId === "ECR-002"),
  "second block has ECR-002"
);

// ID가 없는 텍스트
const noIdExcerpt = "ID가 없는 일반 텍스트입니다.";
const noIdBlocks = createIdBoundaryBlocks(noIdExcerpt);
assert(noIdBlocks.length === 1, "no-ID text → 1 block");
assert(noIdBlocks[0].expectedId === null, "no-ID block has null expectedId");

// ── scoreCandidate ─────────────────────────────────────────
console.log("\n📋 scoreCandidate");

const detailBlock = {
  expectedId: "ECR-001",
  startOffset: 0,
  endOffset: 500,
  text: "ECR-001 시스템 공통 요구사항. 세부내용: 도입되는 모든 장비... 2025년",
};
const scored = scoreCandidate(detailBlock);
assert(scored.score > 0, "detail block has positive score");
assert(scored.hasDetailMarker, "has detail marker");

// 새 마커 테스트: "정의", "[H/W]", "○", "※" 등
const hwBlock = {
  expectedId: "ECR-002",
  startOffset: 0,
  endOffset: 300,
  text: "ECR-002 웹한글 기안기 서버 도입. 정의: [H/W] ○ 도입되는 모든 장비는 이중화... 2025년",
};
const hwScored = scoreCandidate(hwBlock);
assert(hwScored.hasDetailMarker, "[H/W] + ○ detected as detail marker");
assert(hwScored.score > scored.score, "H/W block with more content scores higher");

const simpleBlock = {
  expectedId: "SFR-001",
  startOffset: 0,
  endOffset: 50,
  text: "SFR-001 짧은 요구사항",
};
const simpleScored = scoreCandidate(simpleBlock);
assert(simpleScored.score < scored.score, "detail block scores higher than simple block");

// ── selectBestCandidates ──────────────────────────────────
console.log("\n📋 selectBestCandidates");

// 동일 ID의 중복 블록: 짧은 것과 긴 것
const dupBlocks: RequirementBlock[] = [
  {
    expectedId: "ECR-001",
    startOffset: 100,
    endOffset: 200,
    text: "ECR-001 짧은 총괄표 항목",
  },
  {
    expectedId: "ECR-001",
    startOffset: 500,
    endOffset: 1500,
    text: "요구사항 고유번호 ECR-001. 요구사항 상세설명. 세부내용: 도입되는 모든 장비 운영의 안정성 확보를 위해서...",
  },
  {
    expectedId: "SFR-001",
    startOffset: 1600,
    endOffset: 2500,
    text: "요구사항 고유번호 SFR-001. 세부내용: 하이브리드 웹한글 기안기를 통해...",
  },
];

const selected = selectBestCandidates(dupBlocks);
assert(selected.length === 2, `selected count: ${selected.length} (expected 2, removed 1 duplicate)`);
// ECR-001은 짧은 것과 긴 것 중 긴 것(더 높은 점수)을 선택
const ecrSelected = selected.find((b) => b.expectedId === "ECR-001");
assert(ecrSelected !== undefined, "ECR-001 selected");
assert(
  ecrSelected!.text.length > 50,
  "ECR-001 has longer text (not the summary version)"
);

// ── Summary ──────────────────────────────────────────────
console.log(`\n${"=".repeat(40)}`);
console.log(`  통과: ${passed} / 실패: ${failed} / 총합: ${passed + failed}`);
if (failed > 0) {
  console.log("  ❌ FAILED");
  process.exit(1);
} else {
  console.log("  ✅ ALL PASSED");
}
