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
│   ├── worker.ts                        # Worker 프로세스 (핵심)
│   ├── seed-full.ts                     # 시드 데이터 생성
│   ├── seed-utils.ts
│   ├── seed.sh                          # 시드 실행 스크립트
│   └── start.sh                         # Next.js + Worker 동시 실행
├── docs/
│   ├── rfp/                             # RFP 샘플 PDF
│   └── test/공고_제안요청서.pdf         # 테스트용 PDF
├── drizzle.config.ts
├── docker-compose.yml                   # PostgreSQL (pgvector)
└── package.json
```

## 2. DB 스키마

| 테이블 | 주요 컬럼 | 설명 |
|--------|----------|------|
| `organizations` | id, name, plan | 조직 |
| `projects` | id, name, status(draft/analyzing/review/final), **period** | 프로젝트 + 사업기간 |
| `documents` | id, project_id, name, file_url, parsed_status | 업로드된 PDF 파일 |
| `document_chunks` | id, document_id, content, embedding(1536), page | PDF 청크 + 벡터 임베딩 |
| `requirements` | id, project_id, **original_id**(ECR-001), **name**(명칭), **source_text**(상세), type, priority | 요구사항 |
| `responses` | id, requirement_id, draft_text, confidence_label | 요구사항별 AI 답변 |
| `citations` | id, response_id, chunk_id, score | 답변 참조 연결 |
| `jobs` | id, type, status(pending/processing/completed/failed), project_id, document_id, progress(0~100), message, error, retry_count | Worker 작업 큐 |

## 3. 동작 흐름

### RFP 업로드 → 분석

```
[1] 사용자 업로드
    POST /api/upload → 파일 저장 + org 자동 생성 + project 생성 + job 등록 (pending)
    ← { projectId } 즉시 응답
    
[2] 프론트 이동
    → /projects/{id}?analyzing=1
    
[3] Worker (별도 프로세스)
    pnpm worker
    → 2초마다 pending job polling (FOR UPDATE SKIP LOCKED)
    → PDF 파싱 (pdf-parse)
    → 요구사항 섹션 찾기 (다중 전략)
    → LLM 호출 (deepseek-v4-flash)
    → requirements 저장
    → project.status = 'review'
    
[4] 프론트 polling
    → 2초마다 GET /api/projects/{id}/analyze-status
    → 프로그레스 바 + 단계 카드 표시
    → 완료 시 router.refresh()
```

## 4. 현재 겪고 있는 문제

### 문제 1: LLM API 응답 시간
- **증상**: LLM 호출이 30초~90초 이상 소요됨
- **원인**: `opencode.ai` API 게이트웨이가 한국어 RFP 분석에 매우 느림
- **영향**: 사용자 경험 저하, 타임아웃 설정 어려움
- **시도한 해결**:
  - `mimo-v2.5` → content: null 반환 (모델 이슈)
  - `deepseek-v4-flash` → 40~50초 소요, 추론(reasoning) 토큰 과다
  - `qwen3.7-plus` → 120초 타임아웃
  - `max_tokens: 8192→16384` → 응답 잘림 방지
  - `Promise.race` 타임아웃 → 동작 안 함
  - `AbortSignal.timeout()` → 적용 완료 (90초)
  - "NO REASONING" 프롬프트 → DeepSeek는 그래도 reasoning 함

### 문제 2: 요구사항 섹션 추출의 어려움
- **증상**: RFP마다 구조(목차 체계, 섹션 명칭, 표 형식)가 달라서 특정 마커에 의존하기 어려움
- **현재 해결**: 4가지 전략(요구사항ID 패턴, "요구사항 고유번호", "요구사항 명칭", 본문 마커) 중 가장 앞쪽 위치 선택
- **추출 범위**: 시작점-200자 ~ +30000자 (충분히 넉넉)

### 문제 3: Worker 타임아웃 불안정
- `Promise.race` + `setTimeout`이 실제로 동작하지 않는 현상 (90초가 지나도 타임아웃 안 됨)
- `AbortSignal.timeout()`으로 대체 (Node.js 24 기본 API)
- OpenAI SDK v6 타입에 `signal`이 없어서 `as any` 캐스팅 필요

## 5. 환경 설정

```env
# Database
DATABASE_URL="postgres://rfpuser:rfppass@localhost:5433/rfp-demo"

# LLM API (OpenCode)
LLM_API_BASE="https://opencode.ai/zen/go/v1"
LLM_API_KEY="sk-..."   # OpenCode API 키
LLM_MODEL="deepseek-v4-flash"

# Docker
docker compose up -d   # PostgreSQL + pgvector
```

## 6. 실행 방법

```bash
# 1. Docker DB 실행
docker compose up -d

# 2. DB 스키마 Push
pnpm db:push

# 3. Next.js 서버 (터미널 1)
pnpm dev

# 4. Worker (터미널 2)
pnpm worker

# 또는 한 번에
./scripts/start.sh
```

## 7. 테스트용 PDF

- `docs/rfp/한국기술대_전자결재_시스템고도화.pdf` — 분석 완료 (39건, 정상)
- `docs/rfp/한국폴리텍_전자결재시스템고도화.pdf` — 미테스트
- `docs/test/공고_제안요청서.pdf` — ECR, SFR 등 59개 요구사항 포함 (분석 실패 중)

## 8. 개선이 필요한 부분

| 우선순위 | 항목 | 이유 |
|---------|------|------|
| 🔴 1 | **빠른 LLM API** | 현재 API가 너무 느림. OpenAI / Anthropic / Together 등 직접 API 키 사용 고려 |
| 🟡 2 | **PDF 파서 교체** | pdf-parse(pdf.js)는 표/레이아웃 정보 손실. PyMuPDF 또는 Azure Document Intelligence 고려 |
| 🟢 3 | **벡터 임베딩 재활성화** | 1536차원 embedding 컬럼은 있으나 API 404로 미사용 중 |
| 🟢 4 | **Worker 동시성** | 현재는 단일 Worker가 순차 처리. job이 많아지면 Worker pool 필요 |
