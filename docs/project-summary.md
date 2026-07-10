# RFP Demo 프로젝트 요약

## 1. 프로젝트 구조

```
rfp-demo/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── upload/route.ts          # 파일 업로드 + 프로젝트 생성 + job 등록
│   │   │   ├── projects/
│   │   │   │   ├── route.ts             # 프로젝트 목록/생성
│   │   │   │   ├── [id]/route.ts        # 프로젝트 상세/삭제
│   │   │   │   ├── [id]/analyze-status/route.ts  # 분석 진행률 polling API
│   │   │   │   └── [id]/similar/route.ts         # 유사 RFP 검색
│   │   │   └── test/route.ts
│   │   ├── projects/
│   │   │   ├── new/page.tsx             # 업로드 페이지
│   │   │   └── [id]/
│   │   │       ├── page.tsx             # 프로젝트 상세 (서버 컴포넌트)
│   │   │       └── ProjectClient.tsx    # 프로젝트 상세 (클라이언트, 매트릭스 + 진행률)
│   │   ├── dashboard/page.tsx           # 대시보드
│   │   └── layout.tsx
│   ├── db/
│   │   ├── schema.ts                    # 전체 DB 스키마
│   │   └── index.ts                     # DB 연결 (pg)
│   └── lib/
│       ├── env.ts                       # 환경변수 로딩
│       ├── llm.ts
│       ├── parser.ts
│       ├── chunker.ts
│       └── services/
├── scripts/
│   ├── worker.ts                        # Worker 프로세스 (map-reduce 분석, 핵심)
│   ├── seed-full.ts                     # 시드 데이터 생성
│   ├── seed-utils.ts
│   ├── seed.sh                          # 시드 실행 스크립트
│   └── start.sh                         # Next.js + Worker 동시 실행
├── docs/
│   ├── rfp/                             # RFP 샘플 PDF
│   ├── test/공고_제안요청서.pdf         # 테스트용 PDF
│   └── project-summary.md              # 이 문서
├── drizzle.config.ts
├── docker-compose.yml                   # PostgreSQL (pgvector)
└── package.json
```

## 2. DB 스키마

| 테이블 | 주요 컬럼 | 설명 |
|--------|----------|------|
| `organizations` | id, name, plan | 조직 (업로드 시 자동 생성) |
| `projects` | id, name, status(draft/analyzing/review/final), **period** | 프로젝트 + 사업기간 |
| `documents` | id, project_id, name, file_url, parsed_status | 업로드된 PDF 파일 |
| `document_chunks` | id, document_id, content, embedding(1536), page | PDF 청크 + 벡터 임베딩 |
| `requirements` | id, project_id, **original_id**(ECR-001), **name**(명칭), **source_text**(상세), type, priority | 요구사항 |
| `responses` | id, requirement_id, draft_text, confidence_label | 요구사항별 AI 답변 |
| `citations` | id, response_id, chunk_id, score | 답변 참조 연결 |
| `jobs` | id, type, status(pending/processing/completed/failed), project_id, document_id, progress(0~100), message, error, retry_count | Worker 작업 큐 |

## 3. 동작 흐름

### RFP 업로드 → 분석 (map-reduce 방식)

```
[1] 사용자 업로드
    POST /api/upload → 파일 저장 + org 자동 생성 + project 생성 + job 등록 (pending)
    ← { projectId } 즉시 응답

[2] 프론트 이동
    → /projects/{id}?analyzing=1

[3] Worker (별도 프로세스, pnpm worker)
    → 2초마다 pending job polling (FOR UPDATE SKIP LOCKED)
    → PDF 파싱 (pdf-parse)
    → 요구사항 섹션 찾기 (다중 전략: ID 패턴, 키워드, 본문 마커)
    → 사업기간 추출 (별도 LLM 호출, 짧은 입력)
    → map-reduce: 3500자 청크 분할 → 각 청크 LLM 호출 → 결과 합치기
    → 중복 제거 (ID 기준) → 유효 ID 필터링 ([A-Z]{2,4}-\d{3} 패턴)
    → requirements 저장
    → project.status = 'review'

[4] 프론트 polling
    → 2초마다 GET /api/projects/{id}/analyze-status
    → 프로그레스 바 + 5단계 카드(준비/PDF파싱/AI분석/저장/완료) 표시
    → 완료 시 router.refresh()
```

### Worker 분석 진행률

| Progress | 단계 | 설명 |
|----------|------|------|
| 5% | PDF 파싱 | pdf-parse로 텍스트 추출 |
| 15% | 사업정보 추출 | 문서 앞부분에서 사업기간 |
| 20% | 요구사항 섹션 찾기 | 다중 전략으로 시작 위치 탐색 |
| 30% | 사업기간 추출 | 별도 LLM 호출 (짧은 입력) |
| 40~75% | **map-reduce AI 분석** | 3500자 청크별 LLM 호출 (30초 타임아웃) |
| 80~95% | DB 저장 | 요구사항 + 응답 저장 |
| 100% | 완료 | project.status = 'review' |

## 4. LLM 모델 선정 과정

### 테스트 결과 (OpenCode API, 2026-07-10)

| 모델 | 응답시간 | reasoning | 요구사항 추출 | 채택 |
|------|---------|-----------|-------------|------|
| **minimax-m2.7** | **6.4초** | **0** | ✅ 3개 | 🏆 채택 |
| minimax-m2.5 | 6.6초 | 0 | ✅ 3개 | 후보 |
| glm-5.2 | 13초 | 1618 | ✅ 3개 | 양호 |
| kimi-k2.6 | 25초 | 9838 | ✅ 3개 | 느림 |
| kimi-k2.5 | 20초 | 5404 | ✅ 3개 | 느림 |
| deepseek-v4-flash | 40~50초 | 16811 | ✅ (토큰 과다) | ❌ |
| mimo-v2.5 | — | — | ❌ content: null | ❌ |
| qwen3.7-plus | 120초+ | — | 타임아웃 | ❌ |

### 선정 이유: `minimax-m2.7`
- reasoning 토큰 0 (DeepSeek는 16000+ 소비)
- 응답 속도 6.4초 (DeepSeek 대비 7~8배 빠름)
- 요구사항 정상 추출

### 입력 크기별 응답 시간 (minimax-m2.7)

| 입력 크기 | 응답 시간 |
|----------|----------|
| 3,000자 | 6.4초 ✅ |
| 8,000자 | 45초+ (타임아웃) ❌ |

→ 이 때문에 **map-reduce 방식** 도입 (3500자 청크 분할)

## 5. 해결된 문제

### ✅ 문제 1: LLM API 응답 시간 → map-reduce로 해결

| 항목 | 이전 | 현재 |
|------|------|------|
| 모델 | deepseek-v4-flash | **minimax-m2.7** |
| 방식 | 30000자 한 번에 전송 | **3500자 청크 분할 (map-reduce)** |
| 타임아웃 | Promise.race (미동작) | **AbortSignal.timeout(30초)** |
| 예상 소요 | 45초+ (타임아웃 실패) | 청크당 8초 × 6개 = **약 50초** |

### ✅ 문제 2: status 저장 버그 수정

```typescript
// 이전 (버그): status에 따옴표 포함 저장 → "'review'"
UPDATE projects SET status = ${reqs.length > 0 ? "'review'" : "'draft'"}

// 현재 (수정): 정상 저장 → "review"
UPDATE projects SET status = ${reqs.length > 0 ? "review" : "draft"}
```

### ✅ 문제 3: 요구사항 ID 필터링

LLM이 요구사항 고유번호가 아닌 값들도 추출하는 문제 해결:

```typescript
// [A-Z]{2,4}-\d{3} 패턴만 유지 (ECR-001, SFR-005, COR-002 등)
function filterValidRequirementIds(reqs: any[]): any[] {
  const idRegex = /^[A-Z]{2,4}-\d{3}$/;
  return reqs.filter((r) => idRegex.test(r.id || r.originalId || ""));
}
```

### ✅ 문제 4: Worker 타임아웃 불안정

- `Promise.race` + `setTimeout` → 미동작 (90초 지나도 타임아웃 안 됨)
- **`AbortSignal.timeout()`** 으로 대체 (Node.js 24 기본 API, 정상 동작 확인)
- OpenAI SDK v6 타입에 `signal`이 없어서 `as any` 캐스팅 사용

### ✅ 문제 5: Organization 자동 생성

업로드 시 Organization이 없으면 자동 생성:
```typescript
if (!org) {
  const [newOrg] = await db.insert(organizations).values({ name: "기본 조직", plan: "free" }).returning();
  org = newOrg;
}
```

## 6. 환경 설정

```env
# Database
DATABASE_URL="postgres://rfpuser:rfppass@localhost:5433/rfp-demo"

# LLM API (OpenCode Go 플랜)
LLM_API_BASE="https://opencode.ai/zen/go/v1"
LLM_API_KEY="sk-..."   # OpenCode API 키
LLM_MODEL="minimax-m2.7"

# Docker
docker compose up -d   # PostgreSQL + pgvector
```

## 7. 실행 방법

```bash
# 1. Docker DB 실행
docker compose up -d

# 2. DB 스키마 Push
pnpm db:push

# 3. Next.js 서버 (터미널 1)
pnpm dev

# 4. Worker (터미널 2)
pnpm worker

# 또는 한 번에 (자동 프로세스 정리 + Next.js + Worker)
./scripts/start.sh
```

### Worker 로그 예시

```
==================================================
🧑‍🏭 RFP Worker 시작 (map-reduce 모드)
   Model: minimax-m2.7
   Polling interval: 2초
   PID: 12345
==================================================
[20:15:30][abcdef12] 🚀 작업 시작: rfp_analyze (project=cbda10dd)
[20:15:30][abcdef12] 🔍 RFP 분석 시작: 공고_제안요청서.pdf
[20:15:32][abcdef12] 📄 PDF 파싱 완료: 공고_제안요청서.pdf (76705자)
[20:15:33][abcdef12] 📌 요구사항 시작: 7005자 위치
[20:15:33][abcdef12] 📋 요구사항 섹션 추출 (20000자)
[20:15:34][abcdef12] 📦 청크 분할: 6개
[20:15:35][abcdef12] 📅 사업기간: 계약 체결일로부터 150일
[20:15:36][abcdef12]   청크 1/6: 12개 추출
[20:15:44][abcdef12]   청크 2/6: 10개 추출
...
[20:16:10][abcdef12] 📋 총 75개 → 중복 제거 65개 → ID 필터링 후 59개
[20:16:15][abcdef12] ✅ RFP 분석 완료: 공고_제안요청서.pdf (59개 요구사항)
```

## 8. 요구사항 매트릭스

### 매트릭스 컬럼

| 컬럼 | DB 컬럼 | 설명 |
|------|---------|------|
| ID | `requirements.original_id` | ECR-001, SFR-005 등 RFP 고유번호 |
| 요구사항 명칭 | `requirements.name` | RFP 원문의 요구사항 제목 |
| 요구사항 내용 | `requirements.source_text` | 상세 설명 (원문 그대로) |
| 유형 | `requirements.type` | technical/security/operation 등 |
| 중요도 | `requirements.priority` | essential/recommended/optional |
| 신뢰도 | `responses.confidence_label` | sufficient/insufficient 등 |

### 헤더 영역

```
📁 프로젝트명
📎 PDF 파일명                ← documents.name
📅 사업기간: ...             ← projects.period
RFP 분석 결과 · 요구사항 N개 추출
```

## 9. 유사 RFP 검색

현재 **PostgreSQL 전문 검색(Full-Text Search)** 방식:
- `requirements.source_text`에서 키워드 추출 (불용어 제거)
- `document_chunks.content`를 `to_tsvector`로 검색
- `ts_rank()`로 유사도 점수 계산
- 벡터 임베딩(`embedding` 컬럼)은 API 404로 미사용 중

## 10. 테스트용 PDF

| 파일 | 요구사항 수 | 상태 |
|------|-----------|------|
| `docs/rfp/한국기술대_전자결재_시스템고도화.pdf` | 39개 | ✅ 분석 완료 (구 모델) |
| `docs/rfp/한국폴리텍_전자결재시스템고도화.pdf` | — | 미테스트 |
| `docs/test/공고_제안요청서.pdf` | 59개 (ECR/SFR 등) | map-reduce 적용 대상 |

## 11. 개선이 필요한 부분

| 우선순위 | 항목 | 이유 |
|---------|------|------|
| 🟡 1 | **PDF 파서 교체** | pdf-parse(pdf.js)는 표/레이아웃 정보 손실. PyMuPDF 또는 Azure Document Intelligence 고려. *※ deepseek-v4-flash의 의견 — minimax-m2.7 테스트 결과 pdf-parse로도 충분하여 보류* |
| 🟢 2 | **벡터 임베딩 재활성화** | 1536차원 embedding 컬럼은 있으나 API 404로 미사용 중. 임베딩 API 확보 시 의미 검색 가능 |
| 🟢 3 | **Worker 동시성** | 현재는 단일 Worker가 순차 처리. job이 많아지면 Worker pool 필요 |
| 🟢 4 | **청크 최적화** | 현재 3500자 고정 분할. 요구사항 경계를 인식하여 분할하면 품질 향상 |

## 12. Git 브랜치

```
main                 → SSE streaming (안정화, 커밋 완료)
feat/worker-pattern  → Worker 패턴 + map-reduce (현재 작업 브랜치)
```
