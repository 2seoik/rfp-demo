# RFP Demo 기술 명세서

> AI 기반 RFP(Request For Proposal) 문서 분석 플랫폼의 구현·운영 기준을 정의한다. 이 문서는 신규 개발자와 AI 에이전트가 별도 설명 없이 프로젝트 구조를 이해하고 기능을 수정하거나 확장할 수 있도록 작성되었다.
>
> 이 문서는 프로젝트의 단일 진실 공급원(single source of truth)이다. 최신 코드 검토 결과와 우선순위 매트릭스는 `docs/agent/code-review-2026-07-13.md`를 참고한다. §16(알려진 문제)과 §17(개선 우선순위)은 검토 보고서와 매핑되며, 작업 완료 시 상태(✅/⚠️/🔴)를 갱신한다.

- 기준 문서 갱신일: 2026-07-13
- 패키지 매니저: `pnpm`
- 런타임 구성: Next.js 애플리케이션 + 독립 Worker + PostgreSQL

---

## 1. 제품 정의

### 1.1 목적

사용자가 PDF 또는 DOCX 형식의 RFP 문서를 업로드하면 시스템이 문서 내용을 분석하여 요구사항을 구조화하고, 검토 가능한 요구사항 매트릭스와 유사 RFP 검색 결과를 제공한다.

### 1.2 핵심 사용자 흐름

1. 사용자가 프로젝트명과 RFP 파일을 업로드한다.
2. 서버가 프로젝트, 문서, 분석 Job을 생성한다.
3. 별도 Worker가 Job을 가져와 문서를 파싱하고 LLM 분석을 수행한다.
4. 프론트엔드는 분석 상태 API를 2초 간격으로 polling한다.
5. 분석이 완료되면 요구사항 매트릭스와 사업기간을 표시한다.
6. 사용자는 요구사항 상세와 유사 RFP 검색 결과를 검토한다.

### 1.3 핵심 기능

- PDF 및 DOCX 파일 업로드
- 비동기 RFP 분석
- 요구사항 ID, 명칭, 상세, 유형, 중요도 추출
- 사업기간 추출
- 분석 진행률 표시
- 요구사항 매트릭스 조회
- 프로젝트 및 분석 결과 삭제
- PostgreSQL Full-Text Search 기반 유사 RFP 검색

### 1.4 비목표

현재 범위에는 다음 기능이 포함되지 않는다.

- 사용자 인증 및 권한 관리 완성
- 요구사항 담당자 배정 워크플로
- 최종 제안서 자동 생성
- 벡터 임베딩 기반 의미 검색
- 분산 메시지 큐 또는 외부 Job Queue 도입
- 다중 Worker 자동 확장

---

## 2. 시스템 아키텍처

```text
Browser
  │
  │ HTTP / 2초 Polling
  ▼
Next.js 16 App Router
  ├─ Server Components
  ├─ Client Components
  └─ Route Handlers
          │
          │ SQL
          ▼
PostgreSQL 16 + pgvector
          ▲
          │ SQL Job Polling
          │
Independent Worker (tsx)
  ├─ PDF/DOCX parsing
  ├─ LLM calls
  ├─ requirement normalization
  └─ result persistence
```

### 2.1 설계 원칙

- 분석 작업은 HTTP 요청 수명 주기와 분리한다.
- Worker가 중단되어도 애플리케이션 서버는 정상 동작해야 한다.
- Job 상태는 DB를 단일 진실 공급원으로 사용한다.
- 동일 Job은 하나의 Worker만 처리해야 한다.
- 분석 중 페이지를 이탈하거나 재진입해도 진행 상태를 복구해야 한다.
- LLM 일부 청크 실패가 전체 분석을 즉시 중단시키지 않도록 한다.
- 분석 결과는 원문 추적이 가능하도록 원본 요구사항 ID와 상세 텍스트를 보존한다.

---

## 3. 기술 스택

| 영역 | 기술 | 버전/설정 |
|---|---|---|
| Web Framework | Next.js App Router | 16.2.10 |
| UI | React | 19.2.7 |
| Styling | Tailwind CSS | 4.3.2 |
| Language | TypeScript | 7.0.2 |
| Database | PostgreSQL + pgvector | PostgreSQL 16 |
| ORM | Drizzle ORM | 0.45.2 |
| Migration/Schema Tool | drizzle-kit | 0.31.10 |
| DB Driver | `pg` | 8.22.0 |
| PDF Parser | `pdf-parse` | 2.4.5 |
| DOCX Parser | `mammoth` | 1.12.0 |
| LLM SDK | OpenAI SDK | 6.45.0 |
| Worker Runtime | `tsx` | 4.23.0 |
| Package Manager | pnpm | 10.32.1 |

### 3.1 현재 LLM 기본 설정

```env
LLM_API_BASE="https://opencode.ai/zen/go/v1"
LLM_MODEL="minimax-m2.7"
```

현재 모델은 응답 속도는 빠르지만 한국어 RFP 요구사항 추출 커버리지가 낮다. 운영 품질 기준을 충족하려면 모델 교체 또는 추출 파이프라인 개선이 필요하다.

### 3.2 LLM 모델 선정 이력

> 2026-07-10~11 기준 OpenCode 게이트웨이에서 테스트한 결과. 새 모델 도입 시 이 표를 기준으로 회귀 테스트한다.

#### 벤치마크 (3000자 한국어 RFP excerpt, JSON 추출, 30초 timeout)

| 모델 | 응답시간 | reasoning | 요구사항수 | 평가 |
|---|---:|---:|---:|---|
| `minimax-m2.7` | 6.4초 | 0 | 3/3 | 속도 우수, 커버리지 낮음 |
| `minimax-m2.5` | 6.6초 | 0 | 3/3 | 속도 우수 |
| `glm-5.2` | 13.0초 | 1,618 | 3/3 | 안정 |
| `kimi-k2.6` | 25.2초 | 9,838 | 3/3 | 정확하지만 느림 (현재 운영 모델) |
| `deepseek-v4-flash` | 40~50초 | 16,811 | 39/59 | reasoning 토큰 과다, `max_tokens=16384` 필요 |
| `qwen3.7-plus` | timeout | — | — | 게이트웨이 응답 없음 |
| `mimo-v2.5` | — | — | 0/3 | `content: null` (폐기) |

#### 실제 추출 커버리지 (59개 ID 테스트 PDF)

| 모델 | 커버리지 | 특성 |
|---|---:|---|
| `deepseek-v4-flash` | 59/59 (100%) | 정확하지만 40~50초/호출 |
| `kimi-k2.6` | 59/59 (100%) | 정확, 17초/호출 → 59호출 시 ~17분 |
| `minimax-m2.7` | 17/59 (28.8%) | 빠르지만 누락 다수 |

#### 모델별 알려진 이슈

- `minimax-m2.7`: 한 청크에 여러 요구사항이 있어도 일부만 반환하는 경향. ID 경계 분할 + 배치 처리로 부분 완화.
- `deepseek-v4-flash`: reasoning 토큰이 출력을 잠식해 `max_tokens` 초과. `max_tokens=16384` 또는 reasoning 제어 필요.
- `glm-5.2`: 간헐 timeout.
- `qwen3.7-plus`: OpenCode 게이트웨이에서 응답 없음.

#### 권장

OpenAI `gpt-4o-mini` 키 확보 시 속도(3~5초)와 품질(50~59개)을 동시 확보 가능. `.env`의 `LLM_MODEL`과 `LLM_API_BASE`만 변경하면 된다.

---

## 4. 저장소 구조

```text
rfp-demo/
├── .env
├── docker-compose.yml
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── upload/route.ts
│   │   │   └── projects/
│   │   │       ├── route.ts
│   │   │       └── [id]/
│   │   │           ├── route.ts
│   │   │           ├── analyze-status/route.ts
│   │   │           └── similar/route.ts
│   │   ├── dashboard/
│   │   ├── projects/new/
│   │   ├── projects/[id]/
│   │   ├── library/
│   │   └── settings/
│   ├── db/
│   │   ├── index.ts
│   │   └── schema.ts
│   └── lib/
│       ├── env.ts
│       ├── llm.ts
│       ├── parser.ts
│       ├── chunker.ts
│       ├── prompts.ts
│       ├── search.ts
│       └── services/
├── scripts/
│   ├── worker.ts
│   ├── seed-full.ts
│   ├── seed-utils.ts
│   ├── seed.sh
│   └── start.sh
├── docs/
├── logs/
├── uploads/
└── drizzle/
```

### 4.1 디렉터리 책임

| 경로 | 책임 |
|---|---|
| `src/app` | UI, 페이지 라우팅, API Route Handlers |
| `src/db` | Drizzle 스키마와 DB 연결 |
| `src/lib` | 파서, LLM, 검색, 분석 서비스 |
| `scripts/worker.ts` | Job polling 및 RFP 분석 실행 |
| `uploads` | 업로드된 원본 파일 저장 |
| `logs` | 통합 실행 스크립트 로그 |
| `drizzle` | Drizzle 생성 산출물 |

---

## 5. 도메인 모델

### 5.1 엔터티 관계

```text
organizations 1 ── N projects
organizations 1 ── N users
organizations 1 ── N documents
organizations 1 ── N audit_logs
projects      1 ── N requirements
projects      1 ── N documents
projects      1 ── N jobs
documents     1 ── N document_chunks
document_chunks 1 ── N citations
requirements  1 ── N responses
responses     1 ── N citations
```

### 5.2 상태 정의

#### Project status

```text
draft → analyzing → review → final
```

- `draft`: 분석 전, 분석 결과 없음, 또는 분석 실패 후 복구 상태
- `analyzing`: Worker 분석 진행 중
- `review`: 하나 이상의 요구사항 추출 완료
- `final`: 사용자가 검토 및 확정을 완료한 상태

#### Document parsed status

```text
pending → parsing → ready
                  ↘ error
```

#### Job status

```text
pending → processing → completed
                     ↘ failed
```

#### Requirement status

```text
pending → in_progress → answered → confirmed
```

---

## 6. 데이터베이스 명세

모든 주요 엔터티의 기본 키는 UUID를 사용한다. 시간 컬럼은 PostgreSQL timestamp를 사용하며 생성 시점에 `NOW()` 또는 Drizzle `defaultNow()`를 적용한다.

### 6.1 `organizations`

| 컬럼 | 타입 | 제약조건 |
|---|---|---|
| `id` | uuid | PK, default random |
| `name` | text | NOT NULL |
| `plan` | text | NOT NULL, default `free` |
| `created_at` | timestamp | default now |
| `updated_at` | timestamp | default now |

### 6.2 `projects`

| 컬럼 | 타입 | 제약조건/설명 |
|---|---|---|
| `id` | uuid | PK, default random |
| `org_id` | uuid | NOT NULL, FK → organizations |
| `name` | text | NOT NULL |
| `period` | text | nullable, LLM 또는 fallback으로 추출한 사업기간 |
| `status` | text | NOT NULL, default `draft` |
| `due_date` | timestamp | nullable |
| `created_at` | timestamp | default now |
| `updated_at` | timestamp | default now |

### 6.3 `documents`

| 컬럼 | 타입 | 제약조건/설명 |
|---|---|---|
| `id` | uuid | PK |
| `org_id` | uuid | NOT NULL, FK → organizations |
| `project_id` | uuid | nullable, FK → projects |
| `type` | text | NOT NULL, default `rfp` |
| `name` | text | NOT NULL, 원본 파일명 |
| `file_url` | text | NOT NULL, 서버 파일 경로 |
| `parsed_status` | text | default `pending` |
| `created_at` | timestamp | default now |

### 6.4 `document_chunks`

| 컬럼 | 타입 | 제약조건/설명 |
|---|---|---|
| `id` | uuid | PK |
| `document_id` | uuid | NOT NULL, FK → documents |
| `content` | text | NOT NULL |
| `embedding` | vector(1536) | nullable, 현재 미사용 |
| `page` | integer | nullable |
| `section` | text | nullable |
| `metadata` | text | nullable, JSON 문자열 |
| `created_at` | timestamp | default now |

### 6.5 `requirements`

| 컬럼 | 타입 | 제약조건/설명 |
|---|---|---|
| `id` | uuid | PK |
| `project_id` | uuid | NOT NULL, FK → projects |
| `original_id` | text | nullable, 예: `ECR-001` |
| `name` | text | nullable |
| `source_text` | text | NOT NULL, 최대 1,000자 저장 권장 |
| `type` | text | NOT NULL, default `general` |
| `priority` | text | NOT NULL, default `medium` |
| `status` | text | NOT NULL, default `pending` |
| `assignee` | text | nullable |
| `order` | integer | nullable |
| `created_at` | timestamp | default now |
| `updated_at` | timestamp | default now |

허용 `type` 값:

```text
technical | security | operation | qualification | format | general
```

허용 `priority` 값:

```text
essential | recommended | optional
```

### 6.6 `responses`

| 컬럼 | 타입 | 제약조건/설명 |
|---|---|---|
| `id` | uuid | PK |
| `requirement_id` | uuid | NOT NULL, FK → requirements |
| `draft_text` | text | nullable |
| `final_text` | text | nullable |
| `confidence_label` | text | NOT NULL, default `insufficient` |
| `created_at` | timestamp | default now |
| `updated_at` | timestamp | default now |

허용 `confidence_label` 값:

```text
sufficient | partial | needs_review | insufficient
```

### 6.7 `citations`

| 컬럼 | 타입 | 제약조건/설명 |
|---|---|---|
| `id` | uuid | PK |
| `response_id` | uuid | NOT NULL, FK → responses |
| `chunk_id` | uuid | NOT NULL, FK → document_chunks |
| `score` | integer | nullable, 0~100 |
| `created_at` | timestamp | default now |

### 6.8 `jobs`

| 컬럼 | 타입 | 제약조건/설명 |
|---|---|---|
| `id` | uuid | PK |
| `type` | text | NOT NULL, 현재 `rfp_analyze` |
| `status` | text | NOT NULL, default `pending` |
| `project_id` | uuid | nullable, FK → projects |
| `document_id` | uuid | nullable, FK → documents |
| `progress` | integer | default 0, 0~100 |
| `message` | text | nullable |
| `error` | text | nullable |
| `result` | text | nullable, JSON 문자열 |
| `retry_count` | integer | default 0 |
| `created_at` | timestamp | default now |
| `updated_at` | timestamp | default now |

### 6.9 `audit_logs`

| 컬럼 | 타입 | 제약조건/설명 |
|---|---|---|
| `id` | uuid | PK |
| `org_id` | uuid | NOT NULL, FK → organizations |
| `actor_id` | uuid | NOT NULL, FK → users |
| `action` | text | NOT NULL |
| `target` | text | NOT NULL |
| `created_at` | timestamp | default now |

권장 `action` 값:

```text
upload | download | delete | analyze | export
```

### 6.10 데이터 무결성 요구사항

- `jobs.progress`는 0 이상 100 이하이어야 한다.
- `requirements.original_id`는 저장 전 정규화한다.
- 동일 프로젝트 내 같은 `original_id`는 중복 저장하지 않는다.
- 프로젝트 삭제 시 종속 데이터가 남지 않아야 한다.
- 현재 구현에서 수동 삭제 순서는 다음을 따른다.

```text
citations
→ responses
→ requirements
→ document_chunks
→ jobs
→ documents
→ projects
```

가능하면 FK에 적절한 `ON DELETE CASCADE`를 적용해 애플리케이션 삭제 로직을 단순화한다.

---

## 7. API 명세

모든 API는 JSON을 반환하며, 파일 업로드만 `multipart/form-data`를 사용한다.

### 7.1 `POST /api/upload`

RFP 파일을 저장하고 프로젝트, 문서, 분석 Job을 생성한다. 조직이 없으면 기본 조직을 자동 생성한다.

#### Request

```text
Content-Type: multipart/form-data
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `file` | 예 | PDF 또는 DOCX |
| `name` | 아니오 | 기본값 `새 RFP 분석` |

#### Success: `201 Created`

```json
{
  "projectId": "6a6bf01c-b17f-411d-b2a5-64f6300dbbf1",
  "message": "파일 업로드 완료. 분석을 시작합니다."
}
```

#### Validation error: `400 Bad Request`

```json
{ "error": "파일이 없습니다." }
```

```json
{ "error": "PDF 또는 DOCX 파일만 지원합니다." }
```

#### 동작 요구사항

- 업로드 허용 확장자는 `.pdf`, `.docx`이다.
- 실제 MIME 타입과 확장자를 모두 검증하는 것을 권장한다.
- 업로드 파일명 충돌을 방지하기 위해 UUID 기반 저장명을 사용한다.
- 프로젝트 상태는 Job 생성과 함께 `analyzing`으로 설정한다.
- 문서 상태는 `pending`으로 시작한다.
- 파일 저장 또는 DB 트랜잭션 실패 시 생성된 중간 산출물을 정리한다.

### 7.2 `GET /api/projects`

프로젝트 목록을 최신 수정일 또는 생성일 역순으로 반환한다.

```json
[
  {
    "id": "uuid",
    "name": "프로젝트명",
    "status": "analyzing",
    "requirement_count": 17,
    "document_count": 1,
    "created_at": "2026-07-10T00:00:00.000Z",
    "updated_at": "2026-07-10T00:00:00.000Z"
  }
]
```

### 7.3 `POST /api/projects`

파일 없이 프로젝트만 생성한다.

```json
{ "name": "프로젝트명" }
```

### 7.4 `GET /api/projects/:id`

프로젝트, 요구사항, 응답, 인용, 문서를 한 번에 반환한다.

```json
{
  "project": {
    "id": "uuid",
    "name": "프로젝트명",
    "status": "review",
    "period": "계약 체결일로부터 150일"
  },
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
    {
      "id": "uuid",
      "name": "파일명.pdf",
      "type": "rfp",
      "parsed_status": "ready",
      "created_at": "2026-07-10T00:00:00.000Z"
    }
  ]
}
```

#### 정렬 요구사항

요구사항은 다음 우선순위로 정렬한다.

1. `order ASC NULLS LAST`
2. `original_id ASC`
3. `created_at ASC`

### 7.5 `DELETE /api/projects/:id`

프로젝트와 모든 종속 데이터를 삭제한다.

#### Success

```json
{ "success": true }
```

#### 요구사항

- 존재하지 않는 프로젝트는 `404`를 반환한다.
- 전체 삭제는 하나의 DB 트랜잭션에서 수행한다.
- DB 삭제 성공 후 업로드 원본 파일도 삭제하는 것을 권장한다.

### 7.6 `GET /api/projects/:id/analyze-status`

해당 프로젝트의 최신 분석 Job 상태를 반환한다.

```json
{
  "status": "processing",
  "progress": 45,
  "message": "AI 분석 중... (청크 3/7)",
  "error": null,
  "result": null,
  "retry_count": 0,
  "created_at": "2026-07-10T00:00:00.000Z",
  "updated_at": "2026-07-10T00:00:00.000Z"
}
```

Job이 없으면 다음 형태를 사용한다.

```json
{
  "status": "not_found",
  "progress": 0,
  "message": null,
  "error": null
}
```

### 7.7 `GET /api/projects/:id/similar`

현재 프로젝트 요구사항과 같은 조직의 다른 RFP 문서를 비교해 유사 문서를 반환한다.

#### 검색 절차 (현재 구현: 2계층 FTS)

구현 파일: `src/app/api/projects/[id]/similar/route.ts`

**1계층 - 문서 수준 (사업개요, 종합 유사도의 1차 신호)**

1. 현재 프로젝트 RFP 문서의 `documents.header_text`에서 키워드를 추출한다 (불용어 + RFP 템플릿 보일러플레이트 라벨 제거, 최대 15개).
2. 동일 조직의 다른 프로젝트 `documents.header_text`에 `to_tsquery('simple', ...)` 검색을 수행한다.
3. `ts_rank() * 500`을 반올림해 `headerScore`를 산출한다. 이 값이 종합 유사도(`overallSimilarity`)가 된다.
4. `ts_headline()`으로 매칭 구문을 `<mark>`로 하이라이트한다.

**2계층 - 요구사항 수준 (근거/설명용)**

5. 현재 프로젝트 각 `requirements.source_text`에서 키워드를 추출해 요구사항별 OR `tsquery`를 구성한다.
6. 다른 프로젝트의 `requirements.source_text`에 검색해 `contentPairs`(페어 매핑)를 만든다. 매칭된 고유 source 요구사항 수 / 전체를 `contentSimilarity`로 산출한다.
7. 동일 `original_id`를 가진 요구사항 쌍은 `idPairs`로 별도 수집해 템플릿 공유 지표(`idOverlap`)로 사용한다.
8. 결과를 타겟 프로젝트별로 그룹화하고 `overallSimilarity`(= `headerSimilarity`) 내림차순으로 정렬한다.
9. 현재 프로젝트는 결과에서 제외한다.

#### 점수 체계

| 신호 | 값 | 역할 |
|---|---|---|
| `overallSimilarity` | `headerSimilarity` | 정렬 기준 (1차 신호) |
| `headerSimilarity` | `ts_rank * 500` (반올림) | 문서 수준 유사도 |
| `contentSimilarity` | 매칭 source 요구사항 수 / 전체 (%) | 근거/설명 |
| `idOverlap` | 동일 `original_id` 수 / 전체 (%) | 템플릿 공유 지표 |

`overallSimilarity`가 문서 수준 점수 하나로 결정되는 것은 의도적이다. 요구사항 키워드 매칭은 보일러플레이트에 의해 왜곡되기 쉬워 1차 신호로 부적절하고, 사업개요(header)가 RFP의 본질적 유사도를 더 잘 반영한다.

#### 보일러플레이트 제거

`STOPWORDS`와 `stripBoilerplate()` 정규식이 RFP 템플릿 라벨("요구사항 분류", "고유번호", "산출정보", "응락수준" 등)을 제거한다. 이는 템플릿 보일러플레이트가 검색 결과를 지배하는 것을 막기 위함이다.

#### 초기 설계 (미구현, 참고용)

초기 설계는 `document_chunks.content` 기반 하이브리드 검색(FTS + pgvector)이었으나, 임베딩 파이프라인(`EMBEDDING_API_URL`)이 설정되지 않아 `document_chunks` 테이블이 비어 있다. `src/lib/search.ts`의 `hybridSearch`는 미사용(dead code)이며, 현재는 위 2계층 FTS만 운용된다. 임베딩 도입 시 이 설계를 재검토한다.

#### 응답 (Response)

```json
{
  "sourceProject": { "name": "", "bizName": "", "period": "", "docName": "", "reqCount": 0, "topType": "" },
  "similar": [
    {
      "projectId": "uuid",
      "projectName": "유사 프로젝트",
      "overallSimilarity": 82,
      "headerSimilarity": 82,
      "headerMatchText": "<mark>...</mark>",
      "bizName": "",
      "period": "",
      "docName": "유사 RFP.pdf",
      "reqCount": 59,
      "matchedPairs": [
        {
          "sourceId": "uuid",
          "sourceOriginalId": "FN-001",
          "sourceName": "",
          "targetId": "uuid",
          "targetOriginalId": "FN-001",
          "targetName": "",
          "targetText": "",
          "targetHeadline": "<mark>...</mark>",
          "matchType": "content",
          "score": 42
        }
      ],
      "idMatchCount": 30,
      "contentMatchCount": 50,
      "breakdown": { "headerSimilarity": 82, "idOverlap": 50, "contentSimilarity": 84 },
      "explanation": "유사 프로젝트은(는) 사업개요 기준 매우 유사한 프로젝트입니다 (문서 유사도 82%). ..."
    }
  ],
  "sourceReqCount": 59,
  "keywords": ["..."]
}
```

---

## 8. 프론트엔드 명세

### 8.1 페이지 구성

```text
layout.tsx
├── page.tsx
├── dashboard/page.tsx
│   └── DeleteButton.tsx
├── projects/new/page.tsx
└── projects/[id]/page.tsx
    └── ProjectClient.tsx
```

### 8.2 Server/Client Component 경계

- 데이터 최초 조회는 Server Component에서 수행한다.
- 업로드 폼, 삭제 버튼, polling, 선택 상태는 Client Component에서 처리한다.
- 분석 완료 후 `router.refresh()`로 서버 데이터를 다시 가져온다.

### 8.3 `ProjectClient` Props

```typescript
type Props = {
  data: {
    project: {
      id: string;
      name: string;
      status: "draft" | "analyzing" | "review" | "final";
      period: string | null;
    };
    requirements: Requirement[];
    documents: DocumentSummary[];
  };
  autoAnalyze?: boolean;
};
```

`any` 사용은 점진적으로 제거하고 API 응답 타입을 공유 타입으로 정의한다.

### 8.4 상태 관리

| 상태 | 설명 |
|---|---|
| `analyzing` | `autoAnalyze || project.status === "analyzing"` |
| `progress` | 0~100 |
| `progressMessage` | Worker 단계 메시지 |
| `selectedReq` | 우측 상세에 표시할 요구사항 ID |

### 8.5 Polling 규칙

- `analyzing === true`일 때 2초 간격으로 상태 API를 호출한다.
- `completed` 수신 시 polling을 중단하고 `router.refresh()`를 호출한다.
- `failed` 수신 시 polling을 중단하고 오류 메시지를 표시한다.
- 컴포넌트 unmount 시 timer를 정리한다.
- 네트워크 오류가 일시적으로 발생해도 즉시 분석 실패로 처리하지 않는다.
- 동일 요청이 중첩되지 않도록 이전 요청 완료 후 다음 polling을 수행하는 방식을 권장한다.

### 8.6 분석 진행 UI

분석 중에는 요구사항 매트릭스와 유사 문서 탭을 숨긴다.

| 단계 | 기준 진행률 | 표시 |
|---|---:|---|
| 준비 | 0 | 📋 |
| 문서 파싱 | 5 | 📄 |
| AI 분석 | 20 | 🤖 |
| 저장 | 70 | 💾 |
| 완료 | 100 | ✅ |

진행률은 Worker가 제공하는 실제 값만 사용하며 프론트에서 임의 증가시키지 않는다.

### 8.7 요구사항 매트릭스

필수 컬럼:

| ID | 요구사항 명칭 | 요구사항 내용 | 유형 | 중요도 | 신뢰도 |
|---|---|---|---|---|---|

- `source_text`는 테이블에서 말줄임 처리한다.
- 행 선택 시 우측 상세 패널에 전체 내용을 표시한다.
- 상세 패널은 `sticky top-6`를 사용한다.
- 상세 패널 최대 높이는 `calc(100vh - 8rem)`로 제한하고 내부 스크롤을 제공한다.
- 모바일에서는 우측 패널을 하단 또는 별도 상세 화면으로 전환한다.

### 8.8 오류 상태

다음 상태를 사용자에게 구분해 표시해야 한다.

- 업로드 유효성 오류
- 서버 저장 오류
- Worker 미실행 또는 Job 대기 상태
- 분석 재시도 중
- 분석 최종 실패
- 분석 완료됐지만 요구사항이 0건인 상태
- 프로젝트 또는 문서를 찾을 수 없는 상태

---

## 9. Worker 명세

### 9.1 실행 방식

```bash
pnpm worker
```

개발 중 watch 모드:

```bash
pnpm tsx watch scripts/worker.ts
```

### 9.2 Main Loop

```typescript
async function main() {
  await recoverStuckJobs();

  while (true) {
    await poll();
    await sleep(2000);
  }
}
```

Worker 시작 시 오래된 `processing` Job을 복구해야 한다. 권장 기준은 `updated_at`이 일정 시간 이상 갱신되지 않은 Job이다.

### 9.3 Job 획득

동시 Worker 환경에서 동일 Job 중복 처리를 방지한다.

```sql
UPDATE jobs
SET status = 'processing',
    updated_at = NOW()
WHERE id = (
  SELECT id
  FROM jobs
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

위 쿼리는 트랜잭션 안에서 실행하는 것을 권장한다.

### 9.4 RFP 분석 파이프라인

```text
5%   문서 파싱
15%  헤더 텍스트 추출
20%  요구사항 섹션 탐색
30%  사업기간 추출
40~75% 청크별 요구사항 추출
80~95% DB 저장
100% 완료
```

#### 단계 1. 문서 파싱

- `.pdf`: `pdf-parse` 사용
- `.docx`: `mammoth.extractRawText()` 사용
- 그 외 확장자는 실패 처리
- 파싱 시작 시 `documents.parsed_status = 'parsing'`
- 파싱 실패 시 `documents.parsed_status = 'error'`
- `cleanText()`로 제어문자, 과도한 공백, 탭 노이즈를 정리한다.

#### 단계 2. 헤더 추출

문서 앞 2,000자를 `headerText`로 사용한다. 사업기간 추출에만 사용하며, 요구사항 분석용 텍스트와 분리한다.

#### 단계 3. 요구사항 섹션 탐색

다음 후보 위치를 탐색하고 가장 앞선 유효 위치를 선택한다.

1. 문서 앞 8% 이후에 등장하는 `/[A-Z]{2,4}-\d{3}/g` 최초 위치
2. `요구사항 고유번호`
3. `요구사항 명칭`
4. 문서 앞 10% 이후의 다음 키워드
   - `요구사항 상세`
   - `요구사항 목록`
   - `주요 과업`
   - `요구사항 총괄표`

선택 위치 200자 앞부터 최대 20,000자를 추출한다. 후보가 없으면 문서 전체 또는 합리적인 최대 길이를 fallback으로 사용해야 한다.

#### 단계 4. 사업기간 추출

1차로 정규식 또는 키워드 기반 추출을 시도한다.

권장 검색 키워드:

```text
사업기간 | 수행기간 | 계약기간 | 과업기간 | 용역기간
```

정규식 결과가 없거나 모호하면 `headerText`를 LLM에 전달한다.

LLM 응답 형식:

```json
{ "period": "계약 체결일로부터 150일" }
```

사업기간 추출 실패는 전체 Job 실패 사유가 아니다.

#### 단계 5. 청크 분할

현재 기본값:

```typescript
splitIntoChunks(excerpt, 3500, 300)
```

```typescript
function splitIntoChunks(
  text: string,
  chunkSize = 4000,
  overlap = 500,
): string[] {
  const chunks: string[] = [];

  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    chunks.push(text.slice(i, i + chunkSize));
    if (i + chunkSize >= text.length) break;
  }

  return chunks;
}
```

추출 커버리지 개선 실험 시 다음 순서로 조정한다.

1. 청크 크기 `3500 → 2500`
2. overlap `300 → 400~500`
3. `max_tokens 4096 → 8192`
4. 모델 변경

#### 단계 6. LLM 호출

```typescript
async function callLLM(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  timeoutMs: number,
) {
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
    { signal: AbortSignal.timeout(timeoutMs) },
  );
}
```

요구사항 추출 호출 기본값:

```text
max_tokens = 4096
timeout = 30000ms
temperature = 0.1
```

#### 단계 7. LLM 출력 계약

LLM은 JSON 외의 텍스트를 반환하지 않도록 지시한다.

```json
{
  "requirements": [
    {
      "id": "SFR-001",
      "name": "사용자 인증 기능",
      "sourceText": "원문 요구사항 상세",
      "type": "security",
      "priority": "essential"
    }
  ]
}
```

각 필드 규칙:

- `id`: 원문 ID. 생성하거나 추정하지 않는다.
- `name`: 원문 명칭을 우선 사용한다.
- `sourceText`: 원문 의미를 보존하고 최대 1,000자로 제한한다.
- `type`: 허용 enum 중 하나로 정규화한다.
- `priority`: 허용 enum 중 하나로 정규화한다.

#### 단계 8. 정규화 및 필터링

```typescript
const VALID_REQUIREMENT_ID = /^[A-Z]{2,4}-\d{3}$/;
```

처리 순서:

1. 코드 블록 및 불필요한 접두/접미 텍스트 제거
2. JSON 파싱
3. 필드명 정규화
4. 빈 ID 제거
5. ID uppercase 변환
6. ID 정규식 검증
7. 동일 ID 중복 제거
8. 문서 등장 순서 또는 ID 기준 정렬

중복 ID가 여러 청크에서 발견되면 더 긴 `sourceText` 또는 더 완전한 필드를 가진 항목을 우선한다.

#### 단계 9. DB 저장

하나의 트랜잭션에서 다음을 처리한다.

1. 기존 미완성 분석 결과 정리 여부 결정
2. `projects.period` 갱신
3. `requirements` 일괄 INSERT
4. 각 요구사항에 대응하는 `responses` INSERT
5. `documents.parsed_status = 'ready'`
6. 요구사항이 있으면 `projects.status = 'review'`
7. 요구사항이 없으면 오류 또는 `draft` 처리
8. `jobs.status = 'completed'`, `progress = 100`

`responses.confidence_label` 기본값은 `insufficient`이다.

### 9.5 부분 실패 정책

- 일부 청크 실패: 로그 기록 후 다음 청크 진행
- 사업기간 추출 실패: 무시하고 계속 진행
- 모든 청크 실패: Job을 성공 처리하지 않고 명시적으로 실패 처리
- LLM JSON 파싱 실패: 해당 청크를 1회 보정 재시도하는 방식을 권장
- DB 저장 실패: 전체 트랜잭션 rollback 후 Job 재시도

### 9.6 재시도 정책

최대 시도 횟수는 3회다.

```typescript
const nextRetryCount = (job.retryCount ?? 0) + 1;

if (nextRetryCount < 3) {
  // status = pending
  // retry_count = nextRetryCount
  // error = serialized error
} else {
  // status = failed
  // retry_count = nextRetryCount
  // project.status = draft
}
```

재시도 전 기존에 저장된 부분 결과가 있으면 중복을 방지해야 한다.

### 9.7 Stuck Job 복구

Worker 시작 시 다음 조건의 Job을 `pending`으로 복구한다.

```text
status = processing
AND updated_at < NOW() - STUCK_JOB_TIMEOUT
```

권장 기본값:

```text
STUCK_JOB_TIMEOUT = 10분
```

복구 시 `retry_count`를 증가시키고 복구 사유를 `error` 또는 로그에 기록한다.

---

## 10. LLM 프롬프트 요구사항

### 10.1 프롬프트 (2026-07-13 현재)

LLM은 **name만 추출**한다. type, priority, description은 LLM에서 추출하지 않는다.

```
System: You are an RFP requirement parser. Given requirement IDs with their
original text blocks, extract only the name for each ID.
Output: {"requirements":[{"id":"ECR-001","name":"System Construction"}]}

Rules:
- Return exactly one result per input ID.
- Do not modify the ID string.
- Do not generate IDs not in the input.
- name: a concise title (under 10 words) representing the requirement.
  Prefer the heading text next to the ID.
- Return null for name if uncertain.
- Output ONLY valid JSON. No markdown, no code fences, no explanation.
```

### 10.2 source_text 생성: cleanDescription 파이프라인 (6단계)

`source_text`는 LLM이 아닌 `cleanDescription()` 함수가 **결정적으로** 생성한다.

| 단계 | 내용 |
|---|---|
| 1 | ID 위치 찾고 앞부분(preamble) 버리기 |
| 2 | ID 문자열 제거 (대소문자 무관) |
| 3 | "요구사항 명칭 [name]" 패턴 제거 (RFP 템플릿 접두사 포함) |
| 4 | 표 아티팩트 정리 (·●•○, 다중 공백, 연속 줄바꿈) |
| 5 | RFP 보일러플레이트 행 제거 (요구사항, 세부내용, 정의, 산출정보, 페이지 번호, 합계, 섹션 번호) |
| 6 | `reflowLines`: 깨진 줄 이어붙이기 (pdf-parse 표 셀 줄바꿈 복원). 양쪽 25자 이상이면 붙이지 않음 |

### 10.3 프론트엔드 렌더링

- 매트릭스: `whitespace-pre-line` + `line-clamp-2` (줄바꿈 보존, 2줄 제한)
- 상세 패널: `split('\n')` + 각 줄 앞에 "•" 불릿 + `pt-3` 여백

### 10.4 설계 의도

- LLM 태스크를 name 추출로 최소화 → 속도 향상, 할루시네이션 위험 감소
- description은 결정적(deterministic) 코드 정제 → 비용 0, 항상 결과 반환, 할루시네이션 없음
- 80% 정확도 목표, 나머지 20%는 사람이 매트릭스에서 확인
- type/priority/confidence-color는 LLM 모델 변경·고도화 후 도입 검토

프롬프트 변경은 테스트 PDF 3종에 대한 회귀 테스트 후 반영한다.

---

## 11. 유사 RFP 검색 명세

> 현재 구현 상세는 §7.7을 참고한다. 본 절은 설계 의도와 제약을 기술한다.

### 11.1 현재 구현 요약

2계층 FTS (PostgreSQL `to_tsvector`):
- 1계층: `documents.header_text` 매칭 → 전체 유사도(overallSimilarity)
- 2계층: `requirements.source_text` 요구사항별 페어 매칭 → 근거 표시
- RFP 템플릿 보일러플레이트를 제거한 후 검색한다 (`STOPWORDS`, `stripBoilerplate`).

### 11.2 검색 제약

- 동일 조직 문서만 검색한다.
- 현재 프로젝트 문서는 제외한다.
- `document_chunks`/pgvector 하이브리드 검색은 미구현 (`EMBEDDING_API_URL` 미설정, `document_chunks` 비어 있음).
- `documents.type = 'rfp'`만 대상으로 한다.
- 내용이 비어 있는 청크는 제외한다.
- 반환 건수는 기본 5~10개로 제한한다.

### 11.3 향후 벡터 검색

`document_chunks.embedding vector(1536)` 컬럼은 예약되어 있다. 임베딩 API를 확보하면 다음 방식으로 전환하거나 혼합 검색을 적용한다.

```text
FTS score + vector cosine similarity + metadata filter
```

---

## 12. 환경 설정

### 12.1 `.env`

```env
DATABASE_URL="postgres://rfpuser:rfppass@localhost:5433/rfp-demo"

LLM_API_BASE="https://opencode.ai/zen/go/v1"
LLM_API_KEY="OPENCODE_API_KEY"
LLM_MODEL="minimax-m2.7"
```

권장 추가 변수:

```env
WORKER_POLL_INTERVAL_MS="2000"
LLM_TIMEOUT_MS="30000"
LLM_MAX_TOKENS="4096"
RFP_CHUNK_SIZE="3500"
RFP_CHUNK_OVERLAP="300"
RFP_MAX_EXCERPT_CHARS="20000"
STUCK_JOB_TIMEOUT_MS="600000"
MAX_JOB_RETRIES="3"
UPLOAD_DIR="uploads"
```

### 12.2 환경변수 로딩

- Next.js는 자체 `.env` 로딩을 사용한다.
- `tsx scripts/worker.ts`는 `src/lib/env.ts`에서 `.env`를 명시적으로 로드한다.
- ESM 환경에서 `__dirname`이 없을 수 있으므로 코드가 런타임별로 안전하게 동작해야 한다.
- 필수 환경변수가 없으면 애플리케이션 시작 시 즉시 실패하도록 검증한다.

### 12.3 Docker

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

필수 PostgreSQL 확장:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

---

## 13. 실행 및 개발 절차

### 13.1 초기 설정

```bash
pnpm install
docker compose up -d
pnpm db:push
```

### 13.2 개발 서버

터미널 1:

```bash
pnpm dev
```

터미널 2:

```bash
pnpm worker
```

브라우저:

```text
http://localhost:3000
```

### 13.3 통합 실행

```bash
./scripts/start.sh
```

스크립트 책임:

- 기존 Next.js/Worker 프로세스 정리
- Next.js 백그라운드 실행
- Worker 포그라운드 실행
- 종료 시 자식 프로세스 정리
- 로그를 `logs/`에 기록

### 13.4 시드

```bash
./scripts/seed.sh
```

### 13.5 스키마 작업

```bash
pnpm db:push
pnpm db:studio
```

---

## 14. 품질 요구사항

### 14.1 기능 품질

- 사용자가 파일을 업로드하면 2초 이내에 Job이 DB에 생성되어야 한다.
- Worker가 실행 중이면 평균 2초 이내에 pending Job을 가져와야 한다.
- 분석 중 페이지 이탈 후 재진입해도 상태와 진행률을 복구해야 한다.
- 요구사항 ID는 정규식 규칙을 통과한 값만 저장해야 한다.
- 프로젝트 삭제 후 관련 레코드가 남지 않아야 한다.
- DOCX 업로드를 허용한다면 Worker가 실제로 DOCX를 처리해야 한다.

### 14.2 안정성

- LLM 호출은 강제 timeout을 가져야 한다.
- Job은 최대 3회 재시도한다.
- Worker 강제 종료 후 stuck Job을 자동 복구해야 한다.
- DB 저장은 트랜잭션을 사용한다.
- 중복 Worker가 동일 Job을 처리하지 않아야 한다.

### 14.3 관측 가능성

Worker 로그에 최소 다음 정보가 포함되어야 한다.

- Job ID, Project ID, Document ID
- 파일명과 파일 형식
- 파싱 문자 수
- excerpt 시작 위치와 길이
- 청크 수
- 청크별 시작/완료/실패
- LLM 응답 시간
- 청크별 추출 개수
- 필터링 전후 요구사항 개수
- 총 처리 시간
- 재시도 횟수와 최종 오류

API 및 Worker 로그에 API 키, 전체 문서 원문, 개인정보를 노출하지 않는다.

### 14.4 보안

- 업로드 파일 확장자와 MIME 타입을 검증한다.
- 업로드 시 파일명은 `path.basename()`으로 정규화해 경로 traversal을 방지한다.
- 최대 업로드 크기를 설정한다 (`next.config.ts`의 `bodySizeLimit` 또는 업로드 라우트에서 명시적 크기 검증).
- 원본 파일명은 표시용으로만 사용하고 실제 저장명과 분리한다.
- SQL은 매개변수화한다 (Drizzle `sql` 템플릿).
- API 키는 서버/Worker에서만 사용한다 (`.env`는 git 추적 제외).
- `dangerouslySetInnerHTML`은 신뢰할 수 없는 출처의 HTML을 주입하지 않는다. LLM이 생성한 텍스트나 사용자 입력을 그대로 넣지 않으며, 허용 태그 화이트리스트를 둔다.
- 인증 도입 전이라도 모든 프로젝트 조회/수정/삭제/유사검색에 조직 범위(`org_id`) 검증을 적용한다. 다중 조직 환경에서는 한 조직의 RFP가 다른 조직에 노출되지 않아야 한다.
- 디버그/테스트 전용 엔드포인트(예: `/api/test`)는 프로덕션 빌드에서 제외하거나 인증 게이트를 둔다.
- 하드코딩된 DB 연결 문자열/자격 증명은 `.env`로 이동한다 (스크립트 포함).
- API 오류 응답에 내부 스택이나 SQL, 파일 경로를 노출하지 않는다.

---

## 15. 테스트 명세

### 15.1 단위 테스트

#### 파서

- PDF 텍스트 추출 성공
- DOCX 텍스트 추출 성공
- 지원하지 않는 확장자 거부
- 빈 문서 처리
- 텍스트 정제 결과 검증

#### 청크 분할

- 짧은 문서 1청크
- 정확한 경계 길이
- overlap 적용
- 마지막 청크 누락 없음
- 무한 루프 없음

#### 요구사항 정규화

- 유효 ID 통과
- 잘못된 ID 제거
- 소문자 ID uppercase 변환
- 동일 ID 중복 제거
- 더 완전한 중복 항목 선택
- enum fallback 처리

#### 사업기간 추출

- `계약일로부터 150일`
- `2026.01.01 ~ 2026.06.30`
- 기간 없음
- 정규식 실패 후 LLM fallback

### 15.2 API 통합 테스트

- PDF 업로드 성공
- DOCX 업로드 성공
- 잘못된 파일 형식 400
- 파일 누락 400
- 프로젝트 상세 조회
- 분석 상태 조회
- 프로젝트 삭제와 종속 데이터 정리
- 존재하지 않는 프로젝트 404
- 유사 문서 검색에서 현재 문서 제외

### 15.3 Worker 통합 테스트

- pending Job 정상 획득
- 두 Worker에서 중복 획득 방지
- LLM timeout 후 재시도
- 3회 실패 후 failed 처리
- 일부 청크 실패 후 나머지 저장
- 모든 청크 실패 시 failed 처리
- Worker 재시작 시 stuck Job 복구
- DB 저장 중 오류 발생 시 rollback

### 15.4 회귀 테스트 문서

| 파일 | 예상 요구사항 수 |
|---|---:|
| `docs/rfp/한국기술대_전자결재_시스템고도화.pdf` | 39 |
| `docs/rfp/한국폴리텍_전자결재시스템고도화.pdf` | 75 |
| `docs/test/공고_제안요청서.pdf` | 59 |

### 15.5 수용 기준

#### MVP 수용 기준

- PDF 업로드부터 매트릭스 표시까지 전체 흐름이 동작한다.
- 분석이 HTTP 요청과 독립적으로 계속된다.
- 진행률과 오류가 UI에 표시된다.
- 유효한 요구사항 ID만 저장된다.
- 프로젝트 삭제가 FK 오류 없이 완료된다.

#### 운영 전 필수 기준

- DOCX 실제 처리 지원
- stuck Job 자동 복구
- 모든 청크 실패 감지
- 업로드 제한 및 보안 검증
- 테스트 PDF 평균 추출 커버리지 90% 이상
- 같은 입력에 대한 요구사항 수 변동 범위 ±5% 이내
- 최소 3회 연속 통합 테스트 성공

---

## 16. 현재 알려진 문제

> 상태 표시: ✅ 해결됨 / ⚠️ 부분 개선 / 🔴 잔존 (2026-07-13 코드 검토 기준)

### 16.1 요구사항 추출 커버리지 불안정 ⚠️ → name 안정화, description 80%

현재 테스트 결과 (39개 ID RFP, kimi-k2.6, 6회 연속 분석):

| 지표 | 이전 | 현재 |
|---|---|---|
| name(명칭) 추출률 | 0~100% 불안정 | **39/39 (100%)** |
| description 보일러플레이트 | 심각 (페이지 번호, 표 헤더, 다음 요구사항 섞임) | **0~1건/39** (블록 경계 이슈) |
| description 읽기 품질 | 거의 불가 | **80% 양호**, 20% 사람 확인 필요 |

개선 조치 (2026-07-13):

1. ✅ ID 경계 블록 분할 + 배치 동시 호출 (M1-C, M2)
2. ✅ LLM 프롬프트 영문화 + name 전용 → 추출 안정화
3. ✅ `cleanDescription` 6단계 파이프라인: ID·name·보일러플레이트 제거 + `reflowLines` 깨진 줄 복원 (§10.2)
4. ✅ 프론트엔드: `whitespace-pre-line` + "•" 불릿 렌더링 (§10.3)
5. 🔴 고품질 모델 (gpt-4o-mini) 교체 — 미적용, 현재 kimi-k2.6으로 100% name 추출 중

`source_text`는 더 이상 LLM이나 원문 블록이 아닌 **결정적 코드 정제**로 생성된다. type/priority는 LLM에서 추출하지 않고 DB 기본값(`technical`/`essential`)을 사용한다. 모델 교체 시 신뢰할 수 있는 type/priority/description 추출을 재검토한다.

### 16.2 DOCX 처리 불일치 ✅

Worker에 `mammoth` 기반 DOCX 파서 분기가 구현되었다. 업로드 API가 DOCX를 허술하면 확장자별 파서가 정상 동작한다. (원래 항목: 업로드 API는 DOCX를 허용하지만 Worker가 PDF 파서만 사용하면 런타임 실패가 발생한다.)

### 16.3 사업기간 추출 간헐 실패 ✅

정규식/키워드 fallback이 Worker에 구현되었다. LLM 호출 실패 시에도 `period`를 정규식으로 회복한다. (원래 항목: LLM 호출 실패를 무시하므로 `period`가 비어 있을 수 있다.)

### 16.4 모든 청크 실패 시 0건 성공 처리 ✅

Worker가 성공한 청크 수가 0이면 Job을 `failed`로 처리한다. (원래 항목: 모든 청크 실패와 실제 요구사항 없음은 구분되어야 한다.)

### 16.5 Worker 중단 시 processing Job 고착 ✅

Worker 시작 시 `recoverStuckJobs()`로 `processing` 상태 Job을 `pending`으로 복구한다. (원래 항목: stuck Job 복구 로직이 없으면 수동 SQL이 필요하다.)

### 16.6 업로드 검증 미흡 (보안 P0) ✅

`src/app/api/upload/route.ts`는 파일 확장자만 검증하고 MIME 타입과 최대 크기를 검증하지 않는다. 또한 원본 파일명을 그대로 사용해 경로 traversal 위험이 있다. `next.config.ts`에 `bodySizeLimit`도 설정되어 있지 않다.

→ ✅ 해결: `path.basename()` 정규화 + MIME·확장자 매칭 검증 + 50MB 크기 제한 + 빈 파일 차단 추가.

### 16.7 프로젝트 삭제 시 트랜잭션 + 파일 정리 누락 (데이터 무결성 P0) ✅

`DELETE /api/projects/[id]`는 테이블별 DELETE 쿼리를 순서대로 실행하지만 `db.transaction()`으로 래핑하지 않는다. 중간 실패 시 부분 삭제 상태가 된다. 또한 `uploads/` 디렉토리의 원본 파일을 정리하지 않는다.

→ ✅ 해결: `db.transaction()`으로 전체 DELETE 래핑 + 커밋 성공 후 `uploads/` 내 파일 best-effort 삭제(`path.isAbsolute` + `startsWith(uploadDir)` 검증).

### 16.8 `dangerouslySetInnerHTML` HTML 주입 위험 (보안 P0) ✅

`src/app/projects/[id]/ProjectClient.tsx`가 `dangerouslySetInnerHTML`로 `similar/route.ts`의 `ts_headline` 결과(`<mark>` 포함)를 주입했다. 두 사용 지점에 공통 살균 함수 `sanitizeMarkHtml()`를 두어 `<mark>`/`</mark>` 리터럴만 허용하고 그 외 모든 태그(속성이 있는 `<mark onclick=...>` 포함)를 제거한다.

### 16.9 `/api/test` 보호 없음 (보안 P0) ✅

`src/app/api/test/route.ts`는 디버그용 엔드포인트로 인증이나 조직 범위 검증 없이 프로덕션에 노출되었다. 환경 게이트(`NODE_ENV === "production"`일 때 404)를 추가해 프로덕션 노출을 차단했다. 개발 환경에서는 기존 LLM 연결 테스트 동작을 유지한다. 인증 시스템 도입 시 환경 게이트 대신 인증 게이트로 교체를 검토한다.

### 16.10 재분석 시 기존 요구사항 미삭제 (데이터 무결성 P0) 🔴

Worker가 동일 프로젝트 재분석 시 기존 `requirements`를 삭제하지 않는다. `UNIQUE(project_id, original_id)` 제약과 SELECT-before-INSERT로 중복 INSERT는 막히지만, 이전 분석의 잔재 요구사항이 섞일 수 있다. 재분석 시작 시 동일 `project_id`의 `requirements`를 먼저 비운다.

### 16.11 `analyze-status` 정렬 미지정 (데이터 무결성 P0) ✅ (실제 문제 아님 — page.tsx에서 이미 `ORDER BY req."order"` 사용)

2026-07-13 코드 검토에서 `GET /api/projects/[id]/analyze-status`가 `ORDER BY` 없이 요구사항을 반환한다고 기록했으나, 실제로는 해당 라우트는 job 상태(status/progress/message)만 반환하고 요구사항을 반환하지 않는다. 요구사항은 `src/app/projects/[id]/page.tsx`의 `getProjectData`에서 `ORDER BY req."order"`로 이미 정렬되어 조회된다. 따라서 수정 불필요.

### 16.12 FK `ON DELETE CASCADE` 미설정 (성능/무결성 P1) ✅

`src/db/schema.ts`의 모든 종속 FK에 `ON DELETE CASCADE`를 추가했다: documents→projects, documentChunks→documents, requirements→projects, responses→requirements, citations→responses/chunks, jobs→projects/documents. `organizations`/`users` FK는 CASCADE 대상에서 제외 (의도하지 않은 조직·사용자 삭제 방지). `DELETE /api/projects/[id]`가 단일 `DELETE FROM projects`로 단순화되었다.

마이그레이션: `drizzle/0002_fk_cascade_gin_indexes.sql` (미적용 — `pnpm db:push`로 적용).

### 16.13 미사용(Dead) 분석 파이프라인 (코드 품질 P1) ✅

2026-07-13 삭제 완료 (11개 파일, -1,613행):

- `src/app/api/projects/[id]/analyze/route.ts` — SSE 동기 분석 (미사용)
- `src/lib/services/rfp-analysis.ts` — 별도 분석 서비스 (미사용, 타입 오류 3건)
- `src/lib/services/document-processor.ts` — 청크 생성 (미사용)
- `src/lib/services/answer-recommendation.ts` — 응답 추천 (미사용, UI 미연결)
- `src/lib/services/export.ts` — 내보내기 (미사용, UI 미연결)
- `src/lib/search.ts` — `hybridSearch` pgvector 하이브리드 검색
- `src/lib/prompts.ts` — 구식 프롬프트 (`RFP_ANALYSIS_SYSTEM_PROMPT`, `ANSWER_RECOMMENDATION_SYSTEM_PROMPT`)
- `src/lib/llm.ts` — `chat`/`getEmbedding` (Provider Adapter로 대체됨)
- `src/lib/chunker.ts` — 청크 분할 (Worker에 통합됨)
- `src/lib/parser.ts` — 문서 파서 (Worker에 통합됨)
- `src/app/settings/page.tsx` — 설정 페이지 (저장 로직 없음, 미사용)

연쇄 삭제: 참조 체인이 모두 단방향이었기 때문에 안전하게 일괄 제거 가능. tsc 오류 11→8 감소.

### 16.14 설정 페이지 미작동 (UX/기능 P1) ✅

`/settings` 페이지 삭제. 저장 로직과 모델 목록이 `provider.ts`와 불일치하여 혼란을 야기했다. LLM 설정은 `.env`와 `provider.ts`에서 직접 관리한다.

### 16.15 환경변수 기본값 분산 (코드 품질 P1) ✅

`src/lib/env.ts`에서 LLM 관련 기본값(`LLM_MODEL: "deepseek-chat"`, `LLM_API_BASE: "https://api.opencode.ai/v1"`)을 제거. `provider.ts`의 `getPrimaryModel()`이 단일 진실 공급원이다.

### 16.16 유사 검색 GIN 인덱스 미설정 (성능 P1) ✅

GIN 인덱스 마이그레이션 파일 생성: `idx_requirements_source_text_fts`(requirements.source_text), `idx_documents_header_text_fts`(documents.header_text). `drizzle/0002_fk_cascade_gin_indexes.sql`에 포함. 미적용 — `pnpm db:push`로 적용.

### 16.17 미연결 서비스 (기능 P2) ✅ → §16.13에 통합 삭제됨

`src/lib/services/export.ts`, `src/lib/services/answer-recommendation.ts`은 §16.13 dead code 정리에서 함께 삭제됨.

### 16.18 매트릭스 정렬/필터 부재, 모바일 삭제 접근성 (UX P2) ⚠️

요구사항 매트릭스에 정렬/필터가 없고, 대시보드 삭제 버튼이 모바일에서 접근성이 떨어진다. 스크린 리더 라벨과 포커스 링도 보강한다.

- ✅ 정렬: 매트릭스 헤더(ID/요구사항/유형) 클릭 정렬 + `aria-sort` 화살표 표시 추가.
- ✅ 삭제 버튼 a11y: `aria-label`, `focus:opacity-100`, `focus:ring`, ESC 닫기, 모달 `role="dialog"`/`aria-modal`/`aria-labelledby`, 취소 버튼 `autoFocus` 추가.
- ✅ 분석 중단 라벨 정정: “취소하고 대시보드로” → “대시보드로 이동” (분석은 백그라운드에서 유지됨을 title로 명시).
- 🔴 필터(유형/우선순위 드롭다운) 미구현 — 추후 추가.
- 🔴 중요도/신뢰도 컬럼은 LLM 모델 변경 후 신뢰할 수 있는 데이터 확보 시 추가(§8.7).

---

## 17. 개선 우선순위

> 2026-07-13 코드 검토 기준. §16 항목과 매핑. ✅ 완료 / 🔴 잔존.

### P0 (보안 + 데이터 무결성, 즉시)

| 항목 | 작업 | 완료 조건 | 상태 | §16 |
|---|---|---|---|---|
| 17.1 | 업로드 MIME + 크기 + `path.basename` 검증 | 비허용 파일 차단, 크기 초과 413 | ✅ | 16.6 |
| 17.2 | `dangerouslySetInnerHTML` 허용 태그 화이트리스트/sanitize | LLM·`ts_headline` 입력에 악의적 태그 미주입 | ✅ | 16.8 |
| 17.3 | 프로젝트 삭제 트랜잭션 + `uploads/` 파일 정리 | 중간 실패 시 롤백, 디스크 파일 정리 | ✅ | 16.7 |
| 17.4 | `/api/test` 보호 (제거 또는 인증 게이트) | 프로덕션에서 미인증 접근 차단 | ✅ | 16.9 |
| 17.5 | 재분석 시 기존 `requirements` 비우기 | 재분석 후 잔재 요구사항 0건 | 🔴 | 16.10 |
| 17.6 | `analyze-status` `ORDER BY` 명시 | 호출마다 행 순서 일정 | ✅ (실제 문제 아님) | 16.11 |
| 17.7 | 추출 커버리지 개선 | 3개 테스트 PDF 평균 90% 이상 | ⚠️ | 16.1 |

### P1 (안정성 + 코드 품질)

| 항목 | 작업 | 완료 조건 | 상태 | §16 |
|---|---|---|---|---|
| 17.8 | FK `ON DELETE CASCADE` + 일괄 INSERT | 단일 DELETE로 전파, INSERT 배치 | ✅ (마이그레이션 미적용) | 16.12 |
| 17.9 | 미사용 분석 파이프라인 제거/표시 | dead code 11건 정리 (+1,613행 삭제) | ✅ | 16.13 |
| 17.10 | 설정 페이지 저장 로직 또는 제거 | 페이지 + 네비게이션 링크 삭제 | ✅ | 16.14 |
| 17.11 | 환경변수 기본값 단일 진실 공급원 통일 | `provider.ts`/`env.ts` 불일치 제거 | ✅ | 16.15 |
| 17.12 | 유사 검색 GIN 인덱스 | FTS 쿼리 실행계획에 Index Scan | ✅ (마이그레이션 미적용) | 16.16 |
| 17.13 | 모든 청크 실패 처리 | 0건 성공 오판 제거 | ✅ | 16.4 |
| 17.14 | stuck Job 복구 | Worker 재시작 후 자동 재처리 | ✅ | 16.5 |
| 17.15 | DOCX 파서 분기 | DOCX 통합 테스트 통과 | ✅ | 16.2 |
| 17.16 | 사업기간 fallback | 대표 기간 형식 테스트 통과 | ✅ | 16.3 |

### P2 (기능 완성 + UX)

| 항목 | 작업 | 완료 조건 | 상태 | §16 |
|---|---|---|---|---|
| 17.17 | 미연결 서비스 UI 연결 (export/answer-recommendation) | UI에서 내보내기/응답 추천 호출 가능 | ✅ → §16.13과 함께 삭제 | 16.17 |
| 17.18 | 매트릭스 정렬/필터, 모바일 삭제 버튼 a11y | 정렬/필터 동작, 스크린 리더 라벨/포커스 | ⚠️ (정렬+a11y 완료, 필터 보류) | 16.18 |
| 17.19 | 벡터 검색 | FTS 대비 검색 품질 비교 | 🔴 | — |
| 17.20 | Worker pool | 다중 Job 병렬 처리 검증 | 🔴 | — |
| 17.21 | 타입 정리 | 주요 API/컴포넌트의 `any` 제거 | 🔴 | — |

---

## 18. 권장 추출 개선안

LLM이 요구사항을 누락하는 문제를 줄이기 위해 단순 고정 길이 청크보다 ID 기반 분할을 우선 검토한다.

### 18.1 ID 기반 전처리

1. 전체 텍스트에서 `/[A-Z]{2,4}-\d{3}/g`를 모두 찾는다.
2. 각 ID 시작점부터 다음 ID 직전까지를 하나의 후보 블록으로 만든다.
3. 지나치게 짧은 블록은 다음 블록과 결합한다.
4. LLM에는 블록 단위로 구조화만 요청한다.
5. 정규식으로 찾은 ID 개수와 LLM 결과 개수를 비교한다.

### 18.2 커버리지 검증

```text
coverage = 저장된 유효 요구사항 ID 수 / 원문에서 탐지한 고유 ID 수
```

- coverage가 임계값보다 낮으면 재분석한다.
- 권장 초기 임계값은 0.85다.
- 재분석 시 더 작은 청크 또는 다른 모델을 사용한다.
- 원문 ID 탐지가 불가능한 문서에서는 기존 map-reduce를 fallback으로 사용한다.

이 방식은 모델이 여러 항목 중 일부만 선택하는 문제를 줄이고, 분석 결과 누락을 정량적으로 감지할 수 있다.

---

## 19. 운영 및 문제 해결

### 19.1 Worker가 Job을 처리하지 않을 때

```bash
ps aux | grep worker
```

```sql
SELECT *
FROM jobs
ORDER BY created_at DESC;
```

`pending`이 장시간 유지되면 Worker를 재시작한다.

```bash
pkill -f "scripts/worker.ts"
pnpm worker
```

### 19.2 processing Job 수동 복구

```sql
UPDATE jobs
SET status = 'pending',
    updated_at = NOW()
WHERE status = 'processing';
```

자동 복구 기능 구현 후에는 긴급 상황에서만 사용한다.

### 19.3 분석 0건

확인 순서:

1. Worker 로그의 청크 실패 수
2. 파싱된 전체 문자 수
3. excerpt 시작 위치와 길이
4. LLM 원본 응답 유무
5. JSON 파싱 오류
6. ID 필터링 전후 개수
7. 모델과 timeout 설정

### 19.4 DB 직접 접속

```bash
docker exec -it rfp-demo-db psql -U rfpuser -d rfp-demo
```

```text
\dt
\d jobs
```

```sql
SELECT * FROM jobs ORDER BY created_at DESC LIMIT 5;
```

### 19.5 전체 데이터 초기화

```bash
docker exec rfp-demo-db psql -U rfpuser -d rfp-demo -c "
  TRUNCATE organizations, projects, documents, document_chunks,
            requirements, responses, citations, jobs, audit_logs CASCADE;
"
```

---

## 20. Git 전략

```text
main
└── feat/worker-pattern
```

- `main`: 안정화 코드
- `feat/worker-pattern`: Worker + map-reduce 분석 작업 브랜치

### 20.1 병합 전 체크리스트

- `pnpm install` 후 lockfile 일치
- `pnpm db:push` 성공
- Next.js build 성공
- Worker 단독 실행 성공
- PDF 통합 테스트 성공
- DOCX 지원 여부와 UI 문구 일치
- stuck Job 복구 테스트
- 모든 청크 실패 테스트
- 프로젝트 삭제 테스트
- `.env`와 API 키가 Git에 포함되지 않음

---

## 21. Definition of Done

기능 변경은 다음 조건을 모두 충족해야 완료로 간주한다.

- 구현 코드와 타입이 일치한다.
- 실패 경로와 재시도 동작이 정의되어 있다.
- 관련 단위 또는 통합 테스트가 추가되었다.
- Worker 로그로 문제 원인을 추적할 수 있다.
- DB 변경 사항이 `src/db/schema.ts`와 Drizzle 산출물에 반영되었다.
- API 응답 변경 시 프론트엔드 타입과 UI가 함께 수정되었다.
- 프로젝트 재진입, Worker 재시작, 네트워크 일시 오류 시나리오를 확인했다.
- 문서 또는 `rfp-pipeline-spec.md`가 최신 상태로 갱신되었다.
