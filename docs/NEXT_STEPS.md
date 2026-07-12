# 남은 작업 & 향후 로드맵

> 최종 갱신: 2026-07-11 | 브랜치: feat/worker-pattern

## ✅ 완료 (M0-P3)

### M: 핵심 파이프라인
- M0: 요구사항 추출 파이프라인 진단
- M1-A: 구조화 진단 로그 (`[DIAG]`)
- M1-B: ID 검출/정규화 모듈 (`src/lib/requirement-id.ts`)
- M1-C: ID 경계 블록 분할 + 중복 후보 품질 선택
- M2: LLM 응답 ID 검증 + 1회 재시도 + raw_only 원문 보존
- M3: DB 트랜잭션 + 중복 방지 + UNIQUE constraint 마이그레이션

### P1: Worker 안정성
- P1-1: Stuck job 복구 (10분 이상 processing → pending)
- P1-2: 모든 블록 실패 감지 (0건 성공 → job failed)
- P1-3: DOCX 파서 분기 (mammoth + pdf-parse)
- P1-4: 사업기간 정규식 fallback (키워드 우선 → LLM 보조)

### P2: 추출 품질
- P2-2: scoreCandidate 튜닝 (마커 확장 + 동점 tiebreaker)
- P2-3: 2회차 재시도 프롬프트 개선

### P3: 검색 & 확장
- P3-2: Worker pool (Worker ID, POLL_INTERVAL_MS)
- P3-3: 자동화 테스트 (vitest 22 unit tests)

## 🔧 남은 작업

### P0 — 마이그레이션 적용

```bash
pnpm db:push
```

### P2-1 — LLM 모델 변경 검토 (보류)

API 접근 불가로 보류. OpenCode 구독 문제 해결 후 진행.

### P3-1 — 벡터 임베딩 API 확보 (보류)

API 제한으로 보류.

## 통합 테스트 결과

| 지표 | 이전 | 이후 |
|------|------|------|
| 요구사항 추출률 | 17/59 (28.8%) | 59/59 (100%) |
| 사업기간 추출 | 미추출 | "계약일로부터 180일" |
| 단위 테스트 | 0개 | 22개 (vitest) |

## 테스트 PDF

| 파일 | 예상 ID | 결과 |
|------|--------|------|
| `docs/test/공고_제안요청서.pdf` | 59개 | ✅ 59/59 |
| `docs/test/fixtures/한국기술대_전자결재_시스템고도화.pdf` | 39개 | 미테스트 |
| `docs/test/fixtures/한국폴리텍_전자결재시스템고도화.pdf` | 75개 | 미테스트 |

## 실행 방법

```bash
pnpm dev          # Next.js (localhost:3000)
pnpm worker       # Worker (다중 실행 가능)
pnpm test         # vitest (22 tests)
./scripts/start.sh  # Next.js + Worker 동시 실행
```

## 참고 문서

- `docs/project-summary.md` — 전체 기술 문서
- `docs/agent/rfp-pipeline-spec.md` — 구현 명세
- `docs/agent/STATUS.md` — 단계별 상세 기록
