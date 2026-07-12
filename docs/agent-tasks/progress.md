# RFP Demo — Agent Task Progress

## 1단계: source-text-refactor ✅ 완료

- [x] LLM 프롬프트에서 sourceText 제거
- [x] LLM 응답의 sourceText를 무시하고 PDF 원문 블록으로 대체
- [x] 재시도 프롬프트에서 sourceText 제거
- [x] raw_only 보존 로직에서 sourceText = 원문 블록 유지
- [x] 테스트 추가 (28개, +6 신규)
- [x] TypeScript 타입 체크 통과
- [x] vitest 28/28 통과
- [x] standalone test 49/49 통과

### 수정 파일
- `scripts/worker.ts` — 프롬프트 수정, sourceText 보강 로직 추가
- `src/lib/__tests__/requirement-id.test.ts` — 6개 신규 테스트 추가
- `docs/agent-tasks/progress.md` — 이 파일

## 2단계: batch-concurrency ⬜

## 3단계: provider-benchmark-embedding ⬜
