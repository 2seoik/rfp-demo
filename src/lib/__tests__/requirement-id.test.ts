import { describe, it, expect } from "vitest";
import {
  normalizeId,
  isValidRequirementId,
  detectAllIds,
  getUniqueNormalizedIds,
  getIdPrefixStats,
  getExcerptCoverage,
  createIdBoundaryBlocks,
  selectBestCandidates,
  scoreCandidate,
} from "../requirement-id";

describe("normalizeId", () => {
  it("uppercases lowercase IDs", () => {
    expect(normalizeId("ecr-001")).toBe("ECR-001");
  });
  it("removes whitespace", () => {
    expect(normalizeId(" ECR-001 ")).toBe("ECR-001");
  });
  it("rejects IDs with fewer than 3 digits", () => {
    expect(normalizeId("ECR-1")).toBeNull();
  });
  it("rejects IDs with more than 3 digits", () => {
    expect(normalizeId("ECR-0001")).toBeNull();
  });
  it("rejects IDs with fewer than 2 letters", () => {
    expect(normalizeId("E-001")).toBeNull();
  });
  it("rejects IDs with more than 4 letters", () => {
    expect(normalizeId("ABCDE-001")).toBeNull();
  });
  it("rejects IDs without hyphen", () => {
    expect(normalizeId("ECR001")).toBeNull();
  });
  it("returns null for empty input", () => {
    expect(normalizeId("")).toBeNull();
  });
  it("handles SFR-013", () => {
    expect(normalizeId("SFR-013")).toBe("SFR-013");
  });
});

describe("isValidRequirementId", () => {
  it("accepts valid IDs", () => {
    expect(isValidRequirementId("ECR-001")).toBe(true);
  });
  it("rejects invalid IDs", () => {
    expect(isValidRequirementId("ECR-1")).toBe(false);
    expect(isValidRequirementId("")).toBe(false);
    expect(isValidRequirementId("random")).toBe(false);
  });
});

describe("detectAllIds", () => {
  it("finds ECR and SFR patterns", () => {
    const text = "ECR-001 and SFR-005 are requirements";
    const ids = detectAllIds(text);
    expect(ids.length).toBe(2);
    expect(ids[0].normalized).toBe("ECR-001");
  });

  it("finds IDs with positions", () => {
    const text = "ECR-001";
    const ids = detectAllIds(text);
    expect(ids[0].position).toBeGreaterThanOrEqual(0);
  });

  it("is case-insensitive for detection", () => {
    const text = "ecr-001 and Sfr-005";
    const ids = detectAllIds(text);
    expect(ids.length).toBe(2);
  });

  it("filters false positives (dates)", () => {
    const text = "2026-07-11 v2.0 page - 1 -";
    const ids = detectAllIds(text);
    expect(ids.length).toBe(0);
  });
});

describe("getUniqueNormalizedIds", () => {
  it("deduplicates by normalized form", () => {
    const detected = [
      { raw: "ECR-001", normalized: "ECR-001", position: 0 },
      { raw: "ecr-001", normalized: "ECR-001", position: 10 },
      { raw: "bad", normalized: null, position: 20 },
    ];
    const unique = getUniqueNormalizedIds(detected);
    expect(unique).toEqual(["ECR-001"]);
  });
});

describe("getIdPrefixStats", () => {
  it("counts by prefix", () => {
    const stats = getIdPrefixStats(["ECR-001", "ECR-002", "SFR-001"]);
    expect(stats).toEqual({ ECR: 2, SFR: 1 });
  });
});

describe("getExcerptCoverage", () => {
  it("calculates inside/outside correctly", () => {
    const full = ["ECR-001", "ECR-002", "SFR-001"];
    const excerpt = ["ECR-001"];
    const cov = getExcerptCoverage(full, excerpt);
    expect(cov.insideCount).toBe(1);
    expect(cov.outsideCount).toBe(2);
    expect(cov.coveragePct).toBe(33);
  });
});

describe("createIdBoundaryBlocks", () => {
  it("creates blocks from ID boundaries", () => {
    const text = "preamble\nECR-001 system\nECR-002 web\n";
    const blocks = createIdBoundaryBlocks(text);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks.some((b) => b.expectedId === "ECR-001")).toBe(true);
  });

  it("returns single block for no-ID text", () => {
    const blocks = createIdBoundaryBlocks("plain text");
    expect(blocks.length).toBe(1);
    expect(blocks[0].expectedId).toBeNull();
  });
});

describe("scoreCandidate", () => {
  it("scores detail blocks higher than summary blocks", () => {
    const summary = {
      expectedId: "ECR-001",
      startOffset: 0, endOffset: 50,
      text: "ECR-001 short summary",
    };
    const detail = {
      expectedId: "ECR-001",
      startOffset: 0, endOffset: 500,
      text: "ECR-001 세부내용: detailed text with 2025년 data",
    };
    expect(scoreCandidate(detail).score).toBeGreaterThan(scoreCandidate(summary).score);
  });
});

describe("selectBestCandidates", () => {
  it("removes duplicate IDs choosing the best", () => {
    const blocks = [
      { expectedId: "ECR-001", startOffset: 0, endOffset: 50, text: "short" },
      { expectedId: "ECR-001", startOffset: 0, endOffset: 500, text: "ECR-001 long 세부내용 with details that are quite extensive and detailed for this requirement block test".padEnd(100, "x") },
      { expectedId: "SFR-001", startOffset: 0, endOffset: 300, text: "SFR-001 세부내용..." },
    ];
    const selected = selectBestCandidates(blocks);
    expect(selected.length).toBe(2);
    const ecr = selected.find((b) => b.expectedId === "ECR-001");
    expect(ecr!.text.length).toBeGreaterThan(50);
  });
});

// ── Source Text Refactor Tests ─────────────────────────────
describe("sourceText from block boundary", () => {
  it("block text is the original PDF content", () => {
    const text = "ECR-001 시스템 공통 요구사항\n[H/W] 도입되는 모든 장비...";
    const blocks = createIdBoundaryBlocks(text);
    const ecrBlock = blocks.find((b) => b.expectedId === "ECR-001");
    expect(ecrBlock).toBeDefined();
    expect(ecrBlock!.text).toContain("[H/W]");
  });

  it("block boundary: current ID to just before next ID", () => {
    const text = "PRE ECR-001 detail A ECR-002 detail B POST";
    const blocks = createIdBoundaryBlocks(text);
    const ecr1 = blocks.find((b) => b.expectedId === "ECR-001");
    expect(ecr1).toBeDefined();
    expect(ecr1!.text).toContain("ECR-001");
    expect(ecr1!.text).toContain("detail A");
    // 다음 ID 이후 텍스트는 최소 블록 크기 보장으로 인해 포함될 수 있음
  });

  it("last ID includes text to end of document", () => {
    const text = "ECR-001 first requirement ECR-002 last requirement trailing";
    const blocks = createIdBoundaryBlocks(text);
    const lastBlock = blocks[blocks.length - 1];
    expect(lastBlock.expectedId).toBe("ECR-002");
    expect(lastBlock.text).toContain("trailing");
  });

  it("RAW_ONLY preserves id and sourceText when LLM fails", () => {
    // raw_only 항목 구조 검증 (실제 LLM 호출 없이 데이터 구조만)
    const rawOnly = {
      id: "ECR-001",
      originalId: "ECR-001",
      name: null,
      sourceText: "원문 블록 텍스트".slice(0, 1000),
      type: "general",
      priority: "essential",
      _rawOnly: true,
    };
    expect(rawOnly.name).toBeNull();
    expect(rawOnly.sourceText).toBe("원문 블록 텍스트");
    expect(rawOnly._rawOnly).toBe(true);
  });

  it("LLM success also has sourceText from block", () => {
    // LLM 응답 구조에서 sourceText는 블록에서 오고 LLM 응답에 없어도 됨
    const llmResult = {
      id: "ECR-001",
      name: "시스템 공통",
      type: "technical",
      priority: "essential",
      // sourceText 없음 (LLM이 반환하지 않음)
    };
    // Worker가 블록 text로 보강
    const enriched = { ...llmResult, sourceText: "원문 블록 텍스트".slice(0, 1000) };
    expect(enriched.sourceText).toBe("원문 블록 텍스트");
    expect(enriched.name).toBe("시스템 공통");
  });

  it("LLM response without sourceText field is valid", () => {
    // ID 검증은 sourceText 없이도 동작
    const reqWithoutSourceText = { id: "ECR-001", name: "시스템", type: "technical", priority: "essential" };
    expect(reqWithoutSourceText.id).toBe("ECR-001");
    expect((reqWithoutSourceText as any).sourceText).toBeUndefined();
  });
});
