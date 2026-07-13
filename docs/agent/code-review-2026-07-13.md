# RFP Demo 코드 검토 보고서

> 검토일: 2026-07-13
> 대상 브랜치: `feat/similar-ui-ux`
> 검토 범위: `src/`(35파일), `scripts/worker.ts`(831행), `src/db/`, API 라우트, 프론트엔드 페이지, 서비스/라이브러리, 문서
> 성격: 정적 코드 검토 + 보안 스캔 + UX 분석. **코드 수정 없음.**

이 보고서의 핵심 항목은 `docs/agent/rfp-pipeline-spec.md` §16(알려진 문제)·§17(개선 우선순위)로 이관되었다. 이 파일은 검토 근거와 세부 설명을 보존한다.

---

## 1. 검증 방법

- 전체 소스 파일 정독 (`read` 50+회)
- `npx tsc --noEmit` 타입 검사
- 보안 스캔: `.gitignore` 추적 상태, 하드코딩 자격증명, `bodySizeLimit`, `dangerouslySetInnerHTML`
- 교차 참조: git 히스토리, 마이그레이션 파일, 환경변수 기본값 분산
- UX 정성 분석: 인지 부하, affordance, 전환 최적화

---

## 2. 타입 검사 결과 (`npx tsc --noEmit`)

| 파일 | 오류 수 | 비고 |
|---|---:|---|
| `scripts/backfill-headers.ts` | 4 | 하드코딩 DB 연결 + 타입 |
| `src/lib/services/rfp-analysis.ts` | 3 | 미사용(dead) 서비스 |
| `scripts/seed-full.ts` | 1 | 시드 스크립트 |
| `scripts/analyze-rfps.ts` | 2 | 진단 스크립트 |

운영 코드(`src/app/`, `scripts/worker.ts`)에는 타입 오류가 없다. 오류는 전부 스크립트/미사용 서비스에 국한된다.

---

## 3. 보안 스캔

| 항목 | 결과 |
|---|---|
| `.env` git 추적 | ❌ 추적 안 됨 (안전) |
| `uploads/` git 추적 | ❌ 추적 안 됨 (안전) |
| `next.config.ts` `bodySizeLimit` | ❌ 미설정 |
| 하드코딩 DB 연결 | ⚠️ `scripts/backfill-headers.ts`에 `DATABASE_URL` 하드코딩 |
| `dangerouslySetInnerHTML` | ⚠️ `ProjectClient.tsx` 620–625, 660–665 (LLM/`ts_headline` HTML 직접 주입) |
| `/api/test` 보호 | ❌ 인증/조직 범위 검증 없음 |
| 업로드 MIME 검증 | ❌ 확장자만 검증 |

---

## 4. 핵심 발견 (우선순위별)

### P0 — 보안 / 데이터 무결성 (즉시)

#### 4.1 업로드 검증 미흡
- `src/app/api/upload/route.ts`는 파일 확장자만 검증. MIME 타입, 최대 크기 미검증.
- 원본 파일명을 그대로 사용 → 경로 traversal 위험.
- `next.config.ts`에 `bodySizeLimit` 미설정.
- **권장**: MIME 검증 + `path.basename()` 정규화 + 명시적 크기 제한.

#### 4.2 프로젝트 삭제 시 트랜잭션 + 파일 정리 누락
- `DELETE /api/projects/[id]`가 테이블별 DELETE를 순차 실행하되 `db.transaction()` 래핑 없음. 중간 실패 시 부분 삭제.
- `uploads/` 원본 파일 미정리 → 디스크 누적.
- **권장**: 전체 DELETE 트랜잭션 래핑 + 성공 후 디스크 파일 정리.

#### 4.3 `dangerouslySetInnerHTML` HTML 주입 위험
- `ProjectClient.tsx` 620–625, 660–665가 LLM 생성 텍스트와 `similar/route.ts`의 `ts_headline`(`<mark>` 포함) 결과를 그대로 주입.
- 허용 태그 화이트리스트 또는 살균(sanitize) 필요.

#### 4.4 `/api/test` 보호 없음
- `src/app/api/test/route.ts`가 인증/조직 범위 검증 없이 프로덕션 노출.
- **권장**: 프로덕션 빌드 제외 또는 인증 게이트.

#### 4.5 재분석 시 기존 요구사항 미삭제
- Worker가 동일 프로젝트 재분석 시 기존 `requirements` 미삭제.
- `UNIQUE(project_id, original_id)` + SELECT-before-INSERT로 중복 INSERT는 막히나, 이전 분석 잔재가 섞일 수 있음.
- **권장**: 재분석 시작 시 동일 `project_id`의 `requirements` 먼저 비우기.

#### 4.6 `analyze-status` 정렬 미지정
- `GET /api/projects/[id]/analyze-status`가 `ORDER BY` 없이 반환. PostgreSQL은 정렬 미지정 시 순서 미보장.
- 프론트 매트릭스 행 순서가 호출마다 달라질 수 있음.
- **권장**: `ORDER BY "order"` 또는 `ORDER BY original_id`.

### P1 — 안정성 / 코드 품질

#### 4.7 FK `ON DELETE CASCADE` 미설정
- `src/db/schema.ts` 외래키가 `ON DELETE` 동작 미명시. 테이블마다 수동 DELETE 필요.
- `CASCADE` 설정 시 삭제 코드 단순화, 누락 위험 감소. 마이그레이션 검증 후 적용.

#### 4.8 미사용(Dead) 분석 파이프라인 4건
- `scripts/worker.ts` — 운영 (ID 경계 분할 + 배치 동시 호출)
- `src/app/api/projects/[id]/analyze/route.ts` — SSE 동기 분석 (미사용)
- `src/lib/services/rfp-analysis.ts` — 별도 분석 서비스 (미사용, 타입 오류 3건)
- `src/lib/services/document-processor.ts` — 청크 생성 (미사용)
- `src/lib/search.ts` `hybridSearch` — pgvector 하이브리드 검색 (미사용, `document_chunks` 비어 있음)
- **권장**: 미사용 코드 제거 또는 `deprecated` 표시. 임베딩 재도입 시 분리 브랜치에서 복원.

#### 4.9 설정 페이지 미작동
- `/settings`가 기본값만 표시, 저장 로직 없음. 모델 목록이 `provider.ts`의 `MODEL_CONFIG`와 불일치.
- **권장**: 저장 API 연결 또는 페이지 제거 검토.

#### 4.10 환경변수 기본값 분산
- `src/lib/provider.ts`와 `src/lib/env.ts`가 각각 별도 기본값 보유. 단일 진실 공급원 통일 필요.

#### 4.11 유사 검색 GIN 인덱스 미설정
- `requirements.source_text`·`documents.header_text`에 `to_tsvector` FTS 수행하나 GIN 인덱스 없음. 데이터 증가 시 성능 저하.

### P2 — 기능 완성 / UX

#### 4.12 미연결 서비스
- `src/lib/services/export.ts`(내보내기), `src/lib/services/answer-recommendation.ts`(응답 추천) 구현되었으나 UI 호출 지점 없음.

#### 4.13 매트릭스 정렬/필터 부재 + 모바일 a11y
- 요구사항 매트릭스에 정렬/필터 없음.
- 대시보드 삭제 버튼 모바일 접근성 저하. 스크린 리더 라벨·포커스 링 보강 필요.

---

## 5. UX 심층 분석

> 미관을 넘어 인지 부하 최소화, affordance, 전환 최적화 관점.

### 5.1 인지 부하

| 문제 | 영향 | 위치 |
|---|---|---|
| 분석 진행률 메시지가 Worker 내부 단어 그대로 | 비전문가 이해 곤란 | `ProjectClient.tsx` polling |
| 유사도 점수 의미 불명확 | "82%가 무엇을 의미?" | 유사 문서 탭 |
| 요구사항 매트릭스에 정렬/필터 없음 | 59행을 한 번에 스캔해야 함 | `ProjectClient.tsx` |
| 사업기간·상태 등 메타데이터 분산 표시 | 핵심 정보 파악에 추가 스캔 | 프로젝트 상세 |

**권장**:
- 진행률 메시지를 사용자 친화적으로 매핑 (예: "AI가 문서를 읽고 있습니다" → "AI 분석 중").
- 유사도 점수 옆에 툴팁/설명 라벨로 의미 제공 (`explanation` 필드는 이미 존재, UI 노출 점검).
- 매트릭스 헤더에 정렬 토글 + 유형/중요도 필터 드롭다운.

### 5.2 Affordance

| 요소 | 현재 | 권장 |
|---|---|---|
| 업로드 드래그앤드롭 | 불명확 | 점선 영역 + hover 상태로 드롭 가능성 시각화 |
| 유사 문서 카드 클릭 | 클릭 가능한지 불명확 | hover lift + 커서 pointer + "자세히 보기" 암시 |
| 요구사항 행 선택 | 행 전체가 클릭 영역인지 불명확 | hover 배경 + "선택" 표시 |
| 삭제 버튼 | 텍스트만 | 확인 다이얼로그 + 위험 색상 |
| 분석 재실행 | 취소로 표기됨(실제는 중단) | "중단" 라벨로 의도 정확화 |

### 5.3 전환 최적화

- **핵심 전환**: RFP 업로드 → 분석 완료 → 유사 RFP 활용 → 응답 작성.
- 현재 끊김 지점:
  - 분석 완료 후 "다음에 뭘 해야 하는지" 안내 없음 → 유사 문서 탭/내보내기로 자연스럽게 유도하는 CTA 필요.
  - 유사 문서 결과에서 "이 RFP의 응답을 참고해 작성" 경로 없음 → `answer-recommendation.ts` 연결 시 전환 강화.
  - 내보내기(export) 기능이 구현되었으나 UI 진입점 없음 → 결과 화면에 "내보내기" CTA 배치.
- **권장**: 분석 완료 화면에 3단계 넥스트 액션(유사 RFP 비교 / 응답 초안 생성 / 내보내기) 명시.

### 5.4 모바일

- 삭제 버튼 터치 영역 최소. 스크린 리더 라벨·포커스 링 보강.
- 매트릭스가 모바일에서 스크롤 부담 큼 → 카드 뷰 전환 옵션.

---

## 6. 우선순위 매트릭스

| 우선순위 | 항목 | 영향 | 노력 | §16 |
|---|---|---|---|---|
| P0 | 4.1 업로드 MIME+크기+path.basename | 보안 | 소 | 16.6 |
| P0 | 4.3 `dangerouslySetInnerHTML` 살균 | 보안 | 소-중 | 16.8 |
| P0 | 4.2 삭제 트랜잭션+파일 정리 | 무결성 | 중 | 16.7 |
| P0 | 4.4 `/api/test` 보호 | 보안 | 소 | 16.9 |
| P0 | 4.5 재분석 requirements 비우기 | 무결성 | 소 | 16.10 |
| P0 | 4.6 `analyze-status` 정렬 | 무결성 | 소 | 16.11 |
| P1 | 4.7 FK CASCADE + 일괄 INSERT | 안정성 | 중 | 16.12 |
| P1 | 4.8 dead code 제거 | 품질 | 중 | 16.13 |
| P1 | 4.9 설정 페이지 | 기능 | 중 | 16.14 |
| P1 | 4.10 env 기본값 통일 | 품질 | 소 | 16.15 |
| P1 | 4.11 GIN 인덱스 | 성능 | 소 | 16.16 |
| P2 | 4.12 미연결 서비스 UI | 기능 | 중 | 16.17 |
| P2 | 4.13 매트릭스 정렬/필터 + a11y | UX | 중 | 16.18 |

---

## 7. 검증하지 못한 항목

- `pnpm test` 등 실제 테스트 명령 미실행 (검토 세션이라 검증 명령 선별 필요).
- DB 마이그레이션 적용 여부 미확인 (운영 DB 접근 불가).
- LLM 실제 호출 품질 미검증 (API 키/비용 제약).
- 성능 수치(응답 시간, 메모리) 미측정 (정적 검토).

---

## 8. 남은 위험

- `minimax-m2.7` 호출 시 content 미반환 이슈가 현재 운영 환경에서 재현 중 → 모델 교체 전까지 `kimi-k2.6` fallback 의존 (17분/프로젝트).
- `document_chunks` 테이블 비어 있음 → 향후 임베딩 도입 시 `hybridSearch` 재활성화 검토 필요.
- 삭제한 dead code가 향후 임베딩/SSE 경로에서 재필요할 수 있음 → git 히스토리에서 복원 가능.

---

## 9. 권장 다음 단계

1. P0 6건(4.1~4.6) 순차 구현 — 각 항목별 별도 세션 권장 (AGENTS.md 단계별 작업 규칙).
2. P0 완료 후 P1: FK CASCADE + dead code 제거 + 설정 페이지 + env 통일 + GIN 인덱스.
3. P2: 미연결 서비스 UI 연결 + 매트릭스 정렬/필터 + 모바일 a11y.
4. 각 단계 완료 시 본 보고서와 `rfp-pipeline-spec.md` §16/§17의 상태(✅/🔴)를 갱신.
