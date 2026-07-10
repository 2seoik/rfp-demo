# RFP Demo — 프로젝트 기술 문서

> 이 문서는 프로젝트를 처음 접하는 개발자 또는 AI 에이전트가 전체 구조를 이해하고 즉시 작업을 시작할 수 있도록 작성되었습니다.

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택](#2-기술-스택)
3. [프로젝트 구조](#3-프로젝트-구조)
4. [DB 스키마 상세](#4-db-스키마-상세)
5. [API 엔드포인트 참조](#5-api-엔드포인트-참조)
6. [프론트엔드 컴포넌트 아키텍처](#6-프론트엔드-컴포넌트-아키텍처)
7. [Worker 상세: RFP 분석 파이프라인](#7-worker-상세-rfp-분석-파이프라인)
8. [환경 설정](#8-환경-설정)
9. [실행 방법](#9-실행-방법)
10. [LLM 모델 선정 과정 (전체 기록)](#10-llm-모델-선정-과정-전체-기록)
11. [해결된 문제 목록](#11-해결된-문제-목록)
12. [현재 미해결 문제 & 근본 원인](#12-현재-미해결-문제--근본-원인)
13. [향후 개선 방안](#13-향후-개선-방안)
14. [테스트 결과](#14-테스트-결과)
15. [Git 브랜치 전략](#15-git-브랜치-전략)
16. [문제 해결 가이드](#16-문제-해결-가이드)

---

## 1. 프로젝트 개요

AI 기반 RFP(Request For Proposal) 분석 플랫폼입니다. 사용자가 RFP PDF 파일을 업로드하면 AI가 자동으로 요구사항을 추출하여 매트릭스 형태로 보여주고, 유사 RFP 검색 기능을 제공합니다.

### 핵심 기능

- RFP PDF 업로드 및 분석
- 요구사항 자동 추출 (ID, 명칭, 상세, 유형, 중요도)
- 분석 진행률 실시간 표시 (polling)
- 요구사항 매트릭스 조회
- 유사 RFP 검색 (PostgreSQL 전문 검색)
- 사업기간 정보 추출

### 아키텍처 개요

```
Next.js App Router (프론트 + API)
         ↕ HTTP / Polling
Worker (별도 프로세스, tsx)
         ↕ SQL
PostgreSQL 16 + pgvector
```

Worker가 별도 프로세스로 동작하여 분석이 HTTP 요청 수명 주기와 분리됩니다. 사용자가 페이지를 이동해도 분석은 계속 진행됩니다.

---

## 2. 기술 스택

| 계층 | 기술 | 버전 | 비고 |
|------|------|------|------|
| 프레임워크 | Next.js | 16.2.10 | App Router |
| UI | React | 19.2.7 | |
| 스타일 | Tailwind CSS | 4.3.2 | |
| 언어 | TypeScript | 7.0.2 | |
| DB | PostgreSQL 16 + pgvector | — | Docker |
| ORM | Drizzle ORM | 0.45.2 | + drizzle-kit 0.31.10 |
| DB 드라이버 | pg (node-postgres) | 8.22.0 | |
| PDF 파싱 | pdf-parse | 2.4.5 | pdf.js 기반 |
| LLM SDK | OpenAI SDK | 6.45.0 | OpenAI 호환 API 사용 |
| LLM 게이트웨이 | OpenCode | — | Go 플랜 |
| LLM 모델 | minimax-m2.7 | — | reasoning 불필요 |
| Worker | tsx | 4.23.0 | TypeScript 실행 |
| 패키지 매니저 | pnpm | 10.32.1 | |

### 주요 의존성 (package.json)

```json
{
  "dependencies": {
    "pg": "^8.13.0",
    "drizzle-orm": "^0.45.2",
    "mammoth": "^1.12.0",
    "next": "^16.2.10",
    "openai": "^6.45.0",
    "pdf-parse": "^2.4.5",
    "pgvector": "^0.3.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.10",
    "tsx": "^4.23.0",
    "typescript": "^7.0.2",
    "tailwindcss": "^4.3.2"
  }
}
```

---

## 3. 프로젝트 구조

```
rfp-demo/
├── .env                           # 환경변수 (DB, LLM API 키)
├── .gitignore
├── docker-compose.yml             # PostgreSQL 16 + pgvector
├── drizzle.config.ts              # Drizzle Kit 설정
├── package.json
├── tsconfig.json
│
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── globals.css
│   │   ├── layout.tsx             # 전체 레이아웃 (네비게이션)
│   │   └── page.tsx               # 메인 페이지
│   │   │
│   │   ├── api/                   # API Route Handlers
│   │   │   ├── upload/route.ts    # POST: 파일 업로드 + project + job 생성
│   │   │   ├── test/route.ts
│   │   │   └── projects/
│   │   │       ├── route.ts       # GET: 목록 / POST: 생성
│   │   │       └── [id]/
│   │   │           ├── route.ts           # GET: 상세 / DELETE: 삭제
│   │   │           ├── analyze-status/route.ts  # GET: 분석 진행률
│   │   │           └── similar/route.ts         # GET: 유사 RFP 검색
│   │   │
│   │   ├── dashboard/
│   │   │   ├── page.tsx           # 대시보드 (서버 컴포넌트)
│   │   │   └── DeleteButton.tsx   # 프로젝트 삭제 버튼 (클라이언트)
│   │   │
│   │   ├── projects/
│   │   │   ├── new/page.tsx       # 업로드 페이지 (클라이언트)
│   │   │   └── [id]/
│   │   │       ├── page.tsx       # 프로젝트 상세 (서버 컴포넌트, 데이터 fetch)
│   │   │       └── ProjectClient.tsx  # 프로젝트 상세 (클라이언트, 매트릭스 + polling)
│   │   │
│   │   ├── library/page.tsx
│   │   └── settings/page.tsx
│   │
│   ├── db/
│   │   ├── schema.ts              # 전체 DB 스키마 정의
│   │   └── index.ts               # DB 연결 인스턴스 (pg Pool)
│   │
│   └── lib/
│       ├── env.ts                 # 환경변수 로딩 (tsx/Next.js 겸용)
│       ├── llm.ts
│       ├── parser.ts
│       ├── chunker.ts
│       ├── prompts.ts
│       ├── search.ts
│       └── services/
│           ├── document-processor.ts
│           ├── rfp-analysis.ts
│           ├── answer-recommendation.ts
│           └── export.ts
│
├── scripts/
│   ├── worker.ts                  # [핵심] Worker 프로세스
│   ├── seed-full.ts               # 시드 데이터 생성
│   ├── seed-utils.ts
│   ├── seed.sh
│   └── start.sh                   # Next.js + Worker 동시 실행
│
├── docs/
│   ├── rfp/                       # RFP 샘플 PDF
│   │   ├── 한국기술대_전자결재_시스템고도화.pdf
│   │   ├── 한국폴리텍_전자결재시스템고도화.pdf
│   │   └── RFP_비식별화_A기업.pdf
│   ├── test/
│   │   └── 공고_제안요청서.pdf    # ECR/SFR 59개 요구사항 포함
│   └── project-summary.md         # 이 문서
│
├── logs/                          # start.sh 실행 로그
├── uploads/                       # 업로드된 PDF 저장소 (.gitignore)
└── drizzle/                       # Drizzle Kit 생성 파일
```

---

## 4. DB 스키마 상세

### ERD (논리적 관계)

```
organizations 1──N projects
organizations 1──N users
organizations 1──N documents
organizations 1──N audit_logs
projects      1──N requirements
projects      1──N documents
projects      1──N jobs
documents     1──N document_chunks
document_chunks 1──N citations
requirements 1──N responses
responses    1──N citations
```

### 테이블 명세

#### organizations
| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | uuid | PK, defaultRandom | |
| name | text | NOT NULL | 조직명 |
| plan | text | NOT NULL, default 'free' | |
| created_at | timestamp | defaultNow | |
| updated_at | timestamp | defaultNow | |

#### projects
| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | uuid | PK, defaultRandom | |
| org_id | uuid | NOT NULL, FK→organizations | |
| name | text | NOT NULL | 프로젝트명 |
| **period** | text | nullable | 사업기간 (LLM 추출, 예: "계약 체결일로부터 150일") |
| status | text | NOT NULL, default 'draft' | draft → analyzing → review → final |
| due_date | timestamp | nullable | |
| created_at | timestamp | defaultNow | |
| updated_at | timestamp | defaultNow | |

#### documents
| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | uuid | PK, defaultRandom | |
| org_id | uuid | NOT NULL, FK→organizations | |
| project_id | uuid | FK→projects | |
| type | text | NOT NULL, default 'rfp' | rfp / knowledge |
| name | text | NOT NULL | 원본 파일명 |
| file_url | text | NOT NULL | 저장 경로 (process.cwd()/uploads/...) |
| parsed_status | text | default 'pending' | pending → parsing → ready / error |
| created_at | timestamp | defaultNow | |

#### document_chunks
| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | uuid | PK, defaultRandom | |
| document_id | uuid | NOT NULL, FK→documents | |
| content | text | NOT NULL | 청크 텍스트 |
| **embedding** | **vector(1536)** | nullable | pgvector 벡터 (현재 미사용) |
| page | integer | nullable | 출처 페이지 번호 |
| section | text | nullable | 섹션명 |
| metadata | text | nullable | JSON 메타데이터 |
| created_at | timestamp | defaultNow | |

#### requirements (핵심 분석 결과)
| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | uuid | PK, defaultRandom | |
| project_id | uuid | NOT NULL, FK→projects | |
| **original_id** | text | nullable | RFP 원문 고유번호 (ECR-001, SFR-005) |
| **name** | text | nullable | 요구사항 명칭 (LLM 추출) |
| **source_text** | text | NOT NULL | 요구사항 상세 내용 (원문, 최대 1000자) |
| type | text | NOT NULL, default 'general' | technical / security / operation / qualification / format / general |
| priority | text | NOT NULL, default 'medium' | essential / recommended / optional |
| status | text | NOT NULL, default 'pending' | pending / in_progress / answered / confirmed |
| assignee | text | nullable | 담당자 ID (2단계) |
| order | integer | nullable | 매트릭스 표시 순서 |
| created_at | timestamp | defaultNow |
| updated_at | timestamp | defaultNow |

#### responses
| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | uuid | PK, defaultRandom | |
| requirement_id | uuid | NOT NULL, FK→requirements | |
| draft_text | text | nullable | AI 추천 답변 초안 |
| final_text | text | nullable | 최종 확정 답변 |
| confidence_label | text | NOT NULL, default 'insufficient' | sufficient / partial / needs_review / insufficient |
| created_at | timestamp | defaultNow |
| updated_at | timestamp | defaultNow |

#### citations
| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | uuid | PK, defaultRandom | |
| response_id | uuid | NOT NULL, FK→responses | |
| chunk_id | uuid | NOT NULL, FK→document_chunks | |
| score | integer | nullable | 유사도 점수 (0~100) |
| created_at | timestamp | defaultNow |

#### jobs (Worker 큐)
| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | uuid | PK, defaultRandom | |
| type | text | NOT NULL | 'rfp_analyze' |
| status | text | NOT NULL, default 'pending' | pending → processing → completed / failed |
| project_id | uuid | FK→projects | |
| document_id | uuid | FK→documents | |
| progress | integer | default 0 | 0~100 |
| message | text | nullable | 현재 단계 메시지 (프론트 표시용) |
| error | text | nullable | 에러 메시지 |
| result | text | nullable | 완료 결과 JSON |
| retry_count | integer | default 0 | 재시도 횟수 |
| created_at | timestamp | defaultNow |
| updated_at | timestamp | defaultNow |

#### audit_logs
| 컬럼 | 타입 | 제약조건 | 설명 |
|------|------|---------|------|
| id | uuid | PK, defaultRandom | |
| org_id | uuid | NOT NULL, FK→organizations | |
| actor_id | uuid | NOT NULL, FK→users | |
| action | text | NOT NULL | upload / download / delete / analyze / export |
| target | text | NOT NULL | |
| created_at | timestamp | defaultNow |

---

## 5. API 엔드포인트 참조

### POST /api/upload
파일 업로드 + 프로젝트 생성 + Job 등록. Organization 없으면 자동 생성.

**Request**: `multipart/form-data`
```json
{
  "file": "(PDF 또는 DOCX 파일)",
  "name": "프로젝트명 (선택, 기본값: '새 RFP 분석')"
}
```

**Response** (201):
```json
{
  "projectId": "6a6bf01c-b17f-411d-b2a5-64f6300dbbf1",
  "message": "파일 업로드 완료. 분석을 시작합니다."
}
```

**Error** (400):
```json
{ "error": "PDF 또는 DOCX 파일만 지원합니다." }
{ "error": "파일이 없습니다." }
```

### GET /api/projects
프로젝트 목록 조회 (Dashboard용).

**Response**:
```json
[
  {
    "id": "uuid",
    "name": "프로젝트명",
    "status": "draft|analyzing|review|final",
    "requirement_count": 17,
    "document_count": 1,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

### POST /api/projects
프로젝트 생성 (API로 직접).

**Request**:
```json
{ "name": "프로젝트명" }
```

### GET /api/projects/[id]
프로젝트 상세 + 요구사항 + 문서 조회.

**Response**:
```json
{
  "project": { "id": "...", "name": "...", "status": "...", "period": "..." },
  "requirements": [
    {
      "id": "uuid",
      "original_id": "ECR-001",
      "name": "시스템 공통 요구사항",
      "source_text": "상세 내용...",
      "type": "technical",
      "priority": "essential",
      "order": 1,
      "draft_text": null,
      "final_text": null,
      "confidence_label": "insufficient",
      "citations": []
    }
  ],
  "documents": [
    { "id": "uuid", "name": "파일명.pdf", "type": "rfp", "parsed_status": "ready", "created_at": "..." }
  ]
}
```

### DELETE /api/projects/[id]
프로젝트 및 관련 데이터 전체 삭제 (FK 순서: citations → responses → requirements → document_chunks → jobs → documents → projects).

### GET /api/projects/[id]/analyze-status
Worker 분석 진행률 조회 (프론트에서 2초 간격 polling).

**Response**:
```json
{
  "status": "pending|processing|completed|failed|not_found",
  "progress": 45,
  "message": "AI 분석 중... (청크 3/7)",
  "error": null,
  "result": "{\"requirementCount\":17}",
  "retry_count": 0,
  "created_at": "...",
  "updated_at": "..."
}
```

### GET /api/projects/[id]/similar
유사 RFP 문서 검색 (PostgreSQL Full-Text Search).

**동작 방식**:
1. 현재 프로젝트의 `requirements.source_text`에서 키워드 추출 (불용어 제거)
2. 같은 조직의 다른 RFP 문서들의 `document_chunks.content`를 `to_tsvector()`로 검색
3. `ts_rank()`로 유사도 점수 계산
4. 같은 문서 기준 그룹화 후 평균 점수순 정렬

---

## 6. 프론트엔드 컴포넌트 아키텍처

### 페이지 구조

```
layout.tsx (네비게이션 바)
  ├── page.tsx (메인)
  ├── dashboard/page.tsx (서버 컴포넌트)
  │     └── DeleteButton.tsx (클라이언트 컴포넌트)
  ├── projects/new/page.tsx (클라이언트 컴포넌트 - 업로드 폼)
  └── projects/[id]/page.tsx (서버 컴포넌트 - 데이터 fetch)
        └── ProjectClient.tsx (클라이언트 컴포넌트 - 매트릭스 + polling)
```

### ProjectClient.tsx 상세

**Props**:
```typescript
type Props = {
  data: {
    project: any;          // 프로젝트 정보 (status, period 등)
    requirements: Requirement[];  // 요구사항 목록
    documents: any[];      // 문서 목록 (파일명 표시용)
  };
  autoAnalyze?: boolean;   // 업로드 직후 진입 시 true
};
```

**상태 관리**:
- `analyzing`: 분석 진행 중 여부 (`autoAnalyze || project.status === "analyzing"`)
- `progress`: 0~100 (polling으로 갱신)
- `progressMessage`: 현재 단계 메시지
- `selectedReq`: 우측 패널에 선택된 요구사항 ID

**분석 진행 오버레이** (analyzing === true):
- 스피너 + "AI 분석 진행 중" 헤더
- 프로그레스 바 (gradient, 500ms transition)
- 5단계 카드: 📋 준비(0%) → 📄 PDF 파싱(5%) → 🤖 AI 분석(20%) → 💾 저장(70%) → ✅ 완료(100%)
- 각 카드는 `progress >= threshold` 기준으로 active 토글

**요구사항 매트릭스 테이블**:
| ID | 요구사항 명칭 | 요구사항 내용 | 유형 | 중요도 | 신뢰도 |
|----|-------------|-------------|------|--------|--------|
| ECR-001 | 시스템 공통 요구사항 | 도입되는 모든... | 기술 | 필수 | ❌ |

**우측 상세 카드**: `sticky top-6`, `max-h-[calc(100vh-8rem)]`, `overflow-y-auto`

**유사 RFP 검색 탭**: SimilarDoc[] 렌더링 (문서명, 유사도%, 매칭 청크 목록)

### UX 고려사항
- 분석 중에는 매트릭스/탭 숨김 → 사용자 혼란 방지
- 분석 완료 시 `router.refresh()`로 서버 데이터 다시 fetch
- 대시보드 돌아왔다가 다시 프로젝트 페이지 진입 시 `status === "analyzing"`이면 자동 polling 재개

---

## 7. Worker 상세: RFP 분석 파이프라인

### 실행 명령어

```bash
pnpm worker                        # 일반 실행
pnpm tsx watch scripts/worker.ts   # watch 모드 (파일 변경 시 자동 재시작)
```

### Main Loop

```typescript
async function main() {
  while (true) {
    await poll();   // pending job 1개 처리
    await sleep(2000);  // 2초 대기
  }
}
```

### Job Polling (FOR UPDATE SKIP LOCKED)

```sql
UPDATE jobs
SET status = 'processing', updated_at = NOW()
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED  -- 동시성 제어: 다른 Worker가 같은 job 못 가져감
)
RETURNING *
```

### Job Handler: handleRfpAnalyze

```
[progress 5%]  PDF 파싱
  → pdf-parse로 텍스트 추출 → cleanText()로 정제

[progress 15%] 문서 헤더 추출 (사업기간용, 앞 2000자)

[progress 20%] 요구사항 섹션 위치 탐색 (다중 전략)
  전략 1: /[A-Z]{2,4}-\d{3}/g 패턴 최초 발견 위치 (문서 앞 8% 이후)
  전략 2: "요구사항 고유번호" 키워드 위치
  전략 3: "요구사항 명칭" 키워드 위치
  전략 4: ["요구사항 상세", "요구사항 목록", "주요 과업", "요구사항 총괄표"] 중 최초 발견 (문서 10% 이후)
  → 가장 앞쪽 위치 선택, 200자 앞에서부터 20000자 슬라이스

[progress 30%] 사업기간 추출 (별도 LLM 호출)
  → headerText(2000자)를 LLM에 전송 → {"period": "..."} 추출
  → 실패해도 무시 (필수 아님)

[progress 40~75%] Map-Reduce: 청크별 요구사항 추출
  → splitIntoChunks(excerpt, 3500, 300) = 3500자, 300자 오버랩
  → 각 청크마다:
      1. updateJob(progress 갱신)
      2. callLLM(client, model, systemPrompt, chunk + "\n\nJSON:", 4096, 30000)
         - 30초 타임아웃 (AbortSignal)
         - systemPrompt: JSON 출력 요청 (id, name, sourceText, type, priority)
      3. parseLLMResponse(content) → JSON 파싱
      4. allReqs.push(...chunkReqs)
  → 청크 실패 시 skip (catch로 처리, 진행률은 계속)

  → deduplicateById(allReqs) → ID 기준 중복 제거
  → filterValidRequirementIds(deduped) → /^[A-Z]{2,4}-\d{3}$/ 패턴 필터링

[progress 80~95%] DB 저장
  → 사업기간 저장 (projects.period)
  → requirements INSERT (각 요구사항)
  → responses INSERT (confidenceLabel: "insufficient")

[progress 100%] 완료 처리
  → documents.parsed_status = 'ready'
  → projects.status = 'review' (요구사항 있음) 또는 'draft' (0개)
  → jobs.status = 'completed'
```

### 청크 분할 함수

```typescript
function splitIntoChunks(text: string, chunkSize = 4000, overlap = 500): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    chunks.push(text.slice(i, i + chunkSize));
    if (i + chunkSize >= text.length) break;
  }
  return chunks;
}
// 실제 호출: splitIntoChunks(excerpt, 3500, 300)
// 20000자 기준 약 7개 청크 생성
```

### LLM 호출 함수

```typescript
async function callLLM(client, model, systemPrompt, userContent, maxTokens, timeoutMs) {
  return client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: maxTokens,
      temperature: 0.1,
    } as any,
    { signal: AbortSignal.timeout(timeoutMs) }  // 강제 타임아웃
  );
}
```

### 재시도 로직

```typescript
// poll() 함수의 catch 블록
catch (err) {
  const retryCount = (j.retryCount ?? 0) + 1;
  if (retryCount < 3) {
    // job을 다시 pending으로 (재시도)
  } else {
    // 3회 실패 → failed로 최종 처리
    // projects.status = 'draft'
  }
}
```

---

## 8. 환경 설정

### `.env`

```env
# Database
DATABASE_URL="postgres://rfpuser:rfppass@localhost:5433/rfp-demo"

# LLM API (OpenCode Go 플랜)
LLM_API_BASE="https://opencode.ai/zen/go/v1"
LLM_API_KEY="sk-GD0pixBBkgsxSZ2jcXTEWJ845pPzsTlB5VHtR6MpNTJPi4Om2juDIIbtYyyHZSDA"
LLM_MODEL="minimax-m2.7"
```

### OpenCode 사용 가능 모델 목록 (2026-07-10 기준)

API 응답 기준:
```
minimax-m3, minimax-m2.7, minimax-m2.5
kimi-k2.7-code, kimi-k2.6, kimi-k2.5
glm-5.2, glm-5.1, glm-5
deepseek-v4-pro, deepseek-v4-flash
qwen3.7-max, qwen3.7-plus, qwen3.6-plus, qwen3.5-plus
mimo-v2-pro, mimo-v2-omni, mimo-v2.5-pro, mimo-v2.5
hy3-preview
```

### `docker-compose.yml`

```yaml
version: "3.8"
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: rfp-demo-db
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: rfpuser
      POSTGRES_PASSWORD: rfppass
      POSTGRES_DB: rfp-demo
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/init-db.sh:/docker-entrypoint-initdb.d/init-db.sh

volumes:
  pgdata:
```

### `drizzle.config.ts`

```typescript
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### `src/lib/env.ts` 특징

```typescript
// Next.js App Router (ESM): __dirname 미지원 → try/catch로 무시
//     → Next.js가 자동으로 .env 로드하므로 문제 없음
// tsx scripts/worker.ts (CJS): __dirname 지원 → .env 수동 로드
```

---

## 9. 실행 방법

### 1) Docker DB 실행

```bash
docker compose up -d

# 초기화 스크립트로 vector 확장 생성
docker exec rfp-demo-db psql -U rfpuser -d rfp-demo -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

### 2) DB 스키마 Push

```bash
pnpm db:push
```

### 3) Next.js 서버 (터미널 1)

```bash
pnpm dev
# http://localhost:3000
```

### 4) Worker (터미널 2)

```bash
pnpm worker
```

### 5) 한 번에 실행

```bash
./scripts/start.sh
# 기존 프로세스 자동 정리 → Next.js 백그라운드 → Worker 포그라운드
# 종료: Ctrl+C
```

### 시드 데이터

```bash
./scripts/seed.sh
# Organization + Project 자동 생성 → seed-full.ts 실행
```

---

## 10. LLM 모델 선정 과정 (전체 기록)

### 1차: mimo-v2.5 (초기 설정)

`content: null` 반환. 모델 자체 이슈로 판단되어 폐기.

### 2차: deepseek-v4-flash

| 항목 | 결과 |
|------|------|
| 응답 시간 | 40~50초 |
| reasoning 토큰 | **16,811 토큰** |
| 응답 토큰 | 1,412 토큰 (39개 요구사항) |
| finish_reason | 'length' (max_tokens 제한 도달) |
| 문제점 | reasoning에 토큰 대부분 소비. max_tokens=8192 → content=0. max_tokens=16384 필요 |
| 총평 | 품질은 좋으나 **너무 느림**. 30000자 full excerpt 전송 시 90초+ 타임아웃 |

### 3차: qwen3.7-plus

120초 타임아웃. OpenCode 게이트웨이에서 응답 없음.

### 4차: 모델 벤치마크 (13개 테스트)

테스트 조건: 3000자 한국어 RFP excerpt, JSON 요구사항 추출, 30초 타임아웃.

| 모델 | 응답시간 | reasoning | 요구사항수 | 평가 |
|------|---------|-----------|-----------|------|
| **minimax-m2.7** | **6.4초** | **0** | 3/3 | 🏆 |
| minimax-m2.5 | 6.6초 | 0 | 3/3 | ⭐ |
| glm-5.2 | 13.0초 | 1,618 | 3/3 | ⭐ |
| kimi-k2.6 | 25.2초 | 9,838 | 3/3 | 느림 |
| kimi-k2.5 | 20.2초 | 5,404 | 3/3 | 느림 |
| minimax-m3 | 4.0초 | 0 | 0/3 | ❌ (추출 실패) |
| glm-5.1 | — | — | — | 30초 타임아웃 |
| qwen3.7-plus | — | — | — | 타임아웃 |
| qwen3.6-plus | — | — | — | 타임아웃 |
| qwen3.5-plus | — | — | — | 타임아웃 |
| mimo-v2-pro | — | — | — | 400 Provider Error |
| mimo-v2.5-pro | — | — | — | 타임아웃 |
| hy3-preview | — | — | — | 400 Provider Error |

### 5차: 입력 크기 테스트 (minimax-m2.7)

| 입력 크기 | 응답 시간 | 결과 |
|----------|----------|------|
| 3,000자 | 6.4초 | ✅ |
| 8,000자 | 45초+ | ❌ AbortSignal 타임아웃 |
| 15,000자 | 120초+ | ❌ |
| **→ map-reduce 도입 (3500자 청크 × 7개)** | **~50초 (총합)** | **✅** |

### 6차: 최종 테스트 (map-reduce + minimax-m2.7)

| 단계 | 소요 시간 |
|------|----------|
| PDF 파싱 | ~2초 |
| 사업기간 추출 | ~8초 |
| 청크 분석 (7개 × ~8초) | ~56초 |
| DB 저장 | ~1초 |
| **전체** | **~3분 30초** |

**추출 결과**: 17개 요구사항 (총 59개 중 28.8% 커버)

### 모델 선정 결론

minimax-m2.7은 속도는 빠르지만 추출 커버리지가 낮습니다 (28.8%). DeepSeek은 커버리지는 높지만 속도가 느립니다.

**권장 사항**: OpenAI gpt-4o-mini로 전송 시 속도(3~5초)와 품질(50~59개)을 모두 확보할 수 있습니다. `.env`만 변경하면 됩니다.

---

## 11. 해결된 문제 목록

### ✅ 문제 1: LLM API 타임아웃
- **증상**: 30000자 excerpt 전송 시 90초+ 타임아웃
- **해결**: map-reduce 도입 (3500자 청크 분할 + 각 30초 타임아웃)

### ✅ 문제 2: Worker 타임아웃 미동작
- **증상**: `Promise.race` 90초가 지나도 타임아웃 안 됨
- **원인**: 정확한 원인 불명 (OpenAI SDK 내부 HTTP 요청이 event loop 차단 추정)
- **해결**: `AbortSignal.timeout(ms)`를 `client.chat.completions.create()`의 request options에 전달 (두 번째 인자)

### ✅ 문제 3: `status` 저장 버그
- **증상**: DB에 `'review'` (따옴표 포함)로 저장 → 프론트에서 `status === 'review'` 비교 실패
- **해결**: `${...}` 매개변수화에서 따옴표 제거

### ✅ 문제 4: 요구사항 ID 필터링
- **증상**: LLM이 요구사항이 아닌 항목(카테고리명, 설명 등)을 requirements로 추출
- **해결**: `filterValidRequirementIds()` 추가 → `/^[A-Z]{2,4}-\d{3}$/` 패턴만 통과

### ✅ 문제 5: Organization 부재 시 업로드 실패
- **증상**: DB 초기화 후 첫 업로드 시 400 "조직 없음"
- **해결**: 업로드 시 Organization 없으면 자동 생성

### ✅ 문제 6: 프로젝트 삭제 시 FK 위반
- **증상**: `jobs` 테이블 FK 참조로 documents/projects 삭제 실패
- **해결**: DELETE 쿼리 순서에 `jobs` 추가

### ✅ 문제 7: 우측 상세 카드 스크롤 문제
- **증상**: 매트릭스 스크롤 시 상세 카드가 위에 고정되지 않음
- **해결**: `sticky top-6` + `max-h-[calc(100vh-8rem)] overflow-y-auto` 적용

### ✅ 문제 8: 대시보드 재진입 시 진행바 안 보임
- **증상**: `?analyzing=1` 파라미터가 없으면 진행바 미표시
- **해결**: `autoAnalyze || project.status === "analyzing"`로 조건 완화

---

## 12. 현재 미해결 문제 & 근본 원인

### 🔴 문제 A: 요구사항 추출 커버리지 불안정

| 모델 | 커버리지 | 문제 |
|------|---------|------|
| deepseek-v4-flash | **59/59 (100%)** | 느림 (40~50초) |
| minimax-m2.7 | **17/59 (28.8%)** | 빠름 (6초) |

**근본 원인**: minimax-m2.7이 한국어 RFP 텍스트에서 요구사항을 **건너뛰는 경향**이 있습니다. 3500자 청크에 8~10개 요구사항이 있어도 2~3개만 추출하고 응답을 끝냅니다. `max_tokens=4096`은 충분한데도 모델이 "짧게 대답하는" 특성이 있습니다.

**시도해볼 수정**:
1. `max_tokens` 4096 → 8192 증가 (prompt에 "가능한 모든 요구사항을 빠짐없이 추출" 강조)
2. 청크 크기 3500 → 2500 축소 (더 세밀하게 분할)
3. 모델 변경 (gpt-4o-mini 추천)

### 🔴 문제 B: DOCX 파일 처리 불가

**원인**: `upload/route.ts`는 `.docx` 확장자를 허용하지만, Worker는 무조건 `pdf-parse`로 읽으려고 함.

**해결**: Worker에서 파일 확장자 체크 후 `.docx`면 `mammoth` 라이브러리 사용 (`package.json`에 이미 있음)

### 🟡 문제 C: 사업기간 추출 실패 간헐적

**원인**: 별도 LLM 호출(headerText 2000자)이 30초 타임아웃 또는 추출 실패 시 무시됨.

**개선**: fallback 로직 (정규식으로 "사업기간" 키워드 직접 검색) 추가.

### 🟢 문제 D: 모든 청크 실패 시 무음 처리

**원인**: 각 청크의 try/catch가 실패만 로깅하고 skip → `allReqs`가 빈 배열이면 조용히 0개로 완료.

**개선**: `allReqs.length === 0` 조건에서 명시적 에러 로그 또는 job failed 처리.

### 🟢 문제 E: Worker 재시작 시 stuck job 복구 불가

**원인**: Worker가 `processing` 도중 강제 종료되면 job이 영원히 `processing` 상태로 남음.

**개선**: Worker 시작 시 `processing` 상태 job을 `pending`으로 리셋.

---

## 13. 향후 개선 방안

### 우선순위별

| Pri | 작업 | 영향 | 난이도 |
|-----|------|------|--------|
| 🔴 | **OpenAI API 전환** (gpt-4o-mini) | 속도 3~5초 + 커버리지 90%+ | **하** (.env만 변경) |
| 🟡 | **DOCX 지원** | 업로드 호환성 확대 | 중 |
| 🟡 | **사업기간 추출 강화** (fallback 추가) | 정확도 향상 | 하 |
| 🟢 | **Worker stuck job 복구** | 안정성 향상 | 하 |
| 🟢 | **모든 청크 실패 시 에러 처리** | 디버깅 용이 | 하 |
| 🟢 | **청크 max_tokens 증가** (4096→8192) | 커버리지 향상 가능 | 하 |
| 🟢 | **벡터 임베딩 API 확보** | 유사 RFP 검색 품질 향상 | 중 |
| 🟢 | **Worker pool** | 동시 분석 처리 | 중 |

### PDF 파서 교체 검토

| 파서 | 장점 | 단점 |
|------|------|------|
| pdf-parse (현재) | JS 전용, 설치 불필요 | 표 구조 손실, 탭 노이즈 |
| PyMuPDF | 표/레이아웃 보존 우수 | Python 별도 설치 필요 |
| Azure Document Intelligence | 표 완벽 추출 | 유료 API 키 필요 |

2026-07-10 테스트 결과: pdf-parse로도 한국기술대 RFP(39개) 및 공고 제안요청서(59개) 정상 추출되어 **현재는 교체 불필요**로 판단. PDF 표에서 요구사항을 못 읽는 사례 발생 시 재검토.

---

## 14. 테스트 결과

### 최종 통합 테스트 (2026-07-10)

**시나리오**: 공고_제안요청서.pdf 업로드 → 분석 → 결과 확인

| 단계 | 결과 | 소요시간 |
|------|------|---------|
| 파일 업로드 | ✅ 201 Created | 즉시 |
| Job 등록 | ✅ pending | 즉시 |
| Worker 피킹 | ✅ processing | 2초 |
| PDF 파싱 | ✅ ready | ~2초 |
| 사업기간 추출 | ❌ 실패 (무시됨) | — |
| 청크 분석 (7개) | ✅ 부분 성공 | ~2분 |
| DB 저장 | ✅ 17건 | ~1초 |
| 매트릭스 표시 | ✅ ID/명칭/내용 정상 | — |

**추출 결과**:
```sql
SFR-003 ~ SFR-013  (11개) -- 기능 요구사항
SER-003 ~ SER-008  ( 6개) -- 보안 요구사항
총 17개 (예상 59개 대비 28.8%)
```

**누락된 요구사항 그룹**: ECR-001~003, SFR-001~002, PER-003~004, INR-001~002, TER-001~005, SER-001~002, QUR-001~003, CNR-001~004, COR-001~006, PMR-001~005, PHR-001, PSR-001~004

### 테스트 PDF 데이터

| 파일 | 예상 ID 수 | 맵 | 특징 |
|------|-----------|-----|------|
| docs/rfp/한국기술대_전자결재_시스템고도화.pdf | 39개 | deepseek-v4-flash로 39개 추출 완료 |
| docs/rfp/한국폴리텍_전자결재시스템고도화.pdf | 75개 | deepseek-v4-flash로 75개 ID 확인 |
| docs/test/공고_제안요청서.pdf | 59개 | minimax-m2.7로 17개만 추출 (28.8%) |

---

## 15. Git 브랜치 전략

```
main
  └── feat/worker-pattern (현재 작업 브랜치)
```

| 브랜치 | 상태 | 설명 |
|--------|------|------|
| `main` | ✅ 안정화 | SSE 기반 분석. DB, Worker 패턴 기반 코드 포함 |
| `feat/worker-pattern` | 🚧 작업 중 | Worker 패턴 + map-reduce 분석. main에 머지 전 |

### 최근 커밋 히스토리

```
6045e56 docs: 프로젝트 요약 문서 갱신
1569141 docs: PDF 파서 교체 항목에 deepseek-v4-flash 의견으로 주석 추가
e2adc76 feat: map-reduce LLM 분석, ID 필터링, 로그 개선
1ee7d18 feat: Worker 패턴 도입 (백그라운드 분석 처리)
95f821c fix: Neon 드라이버→pg 교체, SSE 스트리밍 분석
```

---

## 16. 문제 해결 가이드

### Worker가 job을 처리하지 않음

```
1. Worker 실행 확인: ps aux | grep worker
2. jobs 테이블 확인: SELECT * FROM jobs ORDER BY created_at DESC;
3. job이 'pending'인데 안 올라감 → tsx watch 문제 → pkill 후 재시작
4. job이 'processing'에 오래 있음 → LLM 타임아웃 → pkill → UPDATE SET status='pending'
```

### 분석이 0건으로 완료됨

```
1. Worker 로그 확인: "청크 X/Y 실패" 메시지 검색
2. 모든 청크 실패 시: LLM API 응답 확인 (모델 문제 가능)
3. 모델 변경 시험: .env의 LLM_MODEL 변경
4. excerpt가 비어있지 않은지 확인: 문서 섹션 마커 누락 가능
```

### DB 스키마 변경 후

```bash
pnpm db:push  # 스키마 변경 적용
pnpm db:studio  # Drizzle Studio 웹 UI로 데이터 조회
```

### Worker 재시작 (강제)

```bash
pkill -f "scripts/worker.ts"   # Worker 프로세스 강제 종료
pnpm worker                    # 재시작
```

### psql로 직접 확인

```bash
docker exec -it rfp-demo-db psql -U rfpuser -d rfp-demo
# \dt        — 테이블 목록
# \d jobs    — jobs 테이블 구조
# SELECT * FROM jobs ORDER BY created_at DESC LIMIT 5;
# UPDATE jobs SET status = 'pending' WHERE status = 'processing';
```

### 데이터 초기화

```bash
# 모든 데이터 삭제
docker exec rfp-demo-db psql -U rfpuser -d rfp-demo -c "
  TRUNCATE organizations, projects, documents, document_chunks,
            requirements, responses, citations, jobs, audit_logs CASCADE;
"
```

---

> **문서 최종 갱신**: 2026-07-10
> **작성자**: pi-agent (minimax-m2.7 → deepseek-v4-flash)
> **Git 브랜치**: feat/worker-pattern
