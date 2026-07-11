# 남은 작업 & 향후 로드맵

> 최종 갱신: 2026-07-11 | 브랜치: feat/worker-pattern

## ✅ 완료 (M0-M3)

- M0: 요구사항 추출 파이프라인 진단
- M1-A: 구조화 진단 로그 추가 (`[DIAG]`)
- M1-B: ID 검출/정규화 순수 함수 모듈 (`src/lib/requirement-id.ts`)
- M1-C: ID 경계 기반 블록 분할 + 중복 후보 품질 선택
- M2: LLM 응답 ID 검증 + 1회 재시도 + raw_only 원문 보존
- M3: DB 트랜잭션 + SELECT-before-INSERT 중복 방지 + UNIQUE constraint 마이그레이션

## 🔧 남은 작업

### P0 — 마이그레이션 적용

```bash
# UNIQUE constraint 적용 (중복 방지 강화)
pnpm db:push
```

**선행조건**: 현재 DB에 중복 데이터 없음 확인 필요

### P1 — Worker 안정화

1. **Stuck job 복구**: Worker 시작 시 10분 이상 `processing` 상태인 job → `pending` 복구 ✅ 완료
2. **모든 블록 실패 감지**: 성공 블록 0개 → job failed 처리 ✅ 완료
3. **DOCX 파서 분기**: `mammoth` 라이브러리 사용 (이미 설치됨) ✅ 완료
4. **사업기간 정규식 fallback**: LLM 실패 시 정규식으로 "사업기간", "계약기간" 등 키워드 검색

### P2 — 추출 품질

1. **LLM 모델 변경 검토**: `minimax-m2.7` → `gpt-4o-mini` 또는 다른 빠른 모델
2. **`scoreCandidate` 점수 함수 튜닝**: 다양한 RFP 형식에 맞게 가중치 조정
3. **2회차 재시도 로직 개선**: 재시도 프롬프트 정교화

### P3 — 검색 & 확장

1. **벡터 임베딩 API 확보**: `document_chunks.embedding` 컬럼 활용
2. **Worker pool**: 다중 병렬 분석
3. **자동화 테스트**: API, Worker, 파서, 청킹, 필터링

## 테스트 PDF

| 파일 | 예상 ID | 현재 결과 |
|------|--------|----------|
| `docs/test/공고_제안요청서.pdf` | 59개 | ✅ 59/59 (100%) |
| `docs/rfp/한국기술대_전자결재_시스템고도화.pdf` | 39개 | 미테스트 |
| `docs/rfp/한국폴리텍_전자결재시스템고도화.pdf` | 75개 | 미테스트 |

## 실행 방법

```bash
# 서버 + Worker 시작
./scripts/start.sh

# 개별 실행
pnpm dev       # Next.js (포트 3000)
pnpm worker    # Worker
```

## 참고 문서

- `docs/project-summary.md` — 전체 프로젝트 기술 문서
- `docs/agent/rfp-pipeline-spec.md` — 구현 명세
- `docs/agent/STATUS.md` — 단계별 상세 기록
