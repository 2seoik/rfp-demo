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

## 2단계: batch-concurrency ✅ 완료

- [x] 배치 생성 함수 (max 10 items / 16000 chars)
- [x] 배치 LLM 요청 스키마 변경
- [x] 프롬프트 계약 강화 (ID 불변/순서/누락 방지)
- [x] ID reconciliation 구현 (누락/중복/미지 ID 검출)
- [x] 실패 ID만 재시도 (최대 2회)
- [x] 제한된 병렬 처리 (동시 2개, runWithConcurrency)
- [x] timeout + 오류 분류 (timeout/429/5xx 등)
- [x] 부분 성공 처리 (PARTIAL, 개별 상태)
- [x] 배치별 로깅 개선
- [x] 테스트 추가 (35개, +7 신규)
- [x] TypeScript 타입 체크 통과
- [x] vitest 35/35 통과
- [x] standalone test 49/49 통과

### 수정 파일
- `scripts/worker.ts` — 배치 처리, 병렬, reconciliation, 재시도 로직 추가
- `src/lib/__tests__/requirement-id.test.ts` — 7개 신규 배치 테스트 추가
- `docs/agent-tasks/progress.md` — 이 파일

### 호출 흐름 변화
```
변경 전: 59개 블록 → 59회 개별 호출 (순차) → ~17분
변경 후: 59개 블록 → ~6~10개 배치 → 2개씩 병렬 호출 → ~3~5분
         실패 ID만 재시도 (최대 2회) → 최종 실패는 raw_only 보존
```

## 3단계: provider-benchmark-embedding ⬜
