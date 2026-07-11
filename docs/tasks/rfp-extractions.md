현재 개발 중인 프로젝트를 보존하면서 **점진적으로 개선하도록 지시하는 실행용 프롬프트**입니다. `pi-agent + deepseek-v4-flash`에 그대로 입력할 수 있습니다.

당신은 현재 개발 중인 `RFP Demo` 프로젝트를 개선하는 시니어 소프트웨어 엔지니어입니다.

현재 프로젝트는 이미 상당 부분 구현되어 있으므로, 기존 코드를 전면 재작성하거나 구조를 무리하게 교체하지 마십시오. 먼저 실제 저장소와 현재 브랜치의 코드를 확인한 뒤, 기존 기능을 유지하면서 작은 단위로 안전하게 개선해야 합니다.

현재 작업 환경은 다음과 같습니다.

- 작업 도구: pi-agent
- 현재 LLM 모델: deepseek-v4-flash
- 프레임워크: Next.js App Router
- 언어: TypeScript
- 데이터베이스: PostgreSQL 16 + pgvector
- ORM: Drizzle ORM
- Worker: 별도 TypeScript 프로세스
- 문서 파싱: pdf-parse
- DOCX 파싱 후보: mammoth
- Job 처리: PostgreSQL jobs 테이블 + `FOR UPDATE SKIP LOCKED`
- 분석 방식: RFP 텍스트를 나눈 뒤 LLM으로 요구사항 추출
- 현재 주요 문제: 59개 요구사항 중 일부 모델에서 17개만 추출되는 등 커버리지가 불안정함

# **최종 목표**

RFP 문서에 존재하는 요구사항을 최대한 빠짐없이 추출하고, 각 결과가 어느 원문에서 나온 것인지 추적할 수 있는 안정적인 분석 파이프라인을 구축하십시오.

중요한 원칙은 다음과 같습니다.

1. 요구사항의 존재 여부를 LLM에만 의존하지 않는다.
2. 요구사항 ID와 원문은 가능한 한 결정론적으로 추출한다.
3. LLM은 명칭 정리, 유형 분류, 중요도 분류, 텍스트 보정에 사용한다.
4. 일부 LLM 호출이 실패해도 이미 찾은 요구사항 원문을 잃지 않는다.
5. 재시도 또는 Worker 재시작이 발생해도 중복 데이터가 생성되지 않아야 한다.
6. 기존 업로드, 프로젝트 조회, 진행률 표시, 삭제 기능을 깨뜨리지 않는다.
7. 모델 변경은 마지막 수단으로 판단하며, 먼저 파이프라인 자체의 구조적 문제를 개선한다.

# **작업 방식**

작업을 시작하기 전에 반드시 실제 코드를 확인하십시오.

특히 다음 파일과 관련 코드를 먼저 조사하십시오.

- `scripts/worker.ts`
- `src/db/schema.ts`
- `src/db/index.ts`
- `src/app/api/upload/route.ts`
- `src/app/api/projects/[id]/route.ts`
- `src/app/api/projects/[id]/analyze-status/route.ts`
- `src/app/api/projects/[id]/similar/route.ts`
- `src/lib/parser.ts`
- `src/lib/chunker.ts`
- `src/lib/prompts.ts`
- `src/lib/llm.ts`
- `src/lib/services/document-processor.ts`
- `src/lib/services/rfp-analysis.ts`
- `package.json`
- `docker-compose.yml`
- Drizzle migration 또는 생성 파일

문서의 설명과 실제 구현이 다를 수 있으므로 문서만 믿고 수정하지 마십시오.

각 작업은 다음 순서로 진행하십시오.

1. 현재 구현 확인
2. 문제 원인 확인
3. 최소 수정안 설계
4. 코드 수정
5. 타입 검사 및 테스트
6. 결과 보고
7. 다음 작업 진행

한 번에 대규모 리팩터링하지 말고, 독립적으로 검증 가능한 작은 단계로 작업하십시오.

# **가장 먼저 확인할 핵심 원인**

현재 Worker가 요구사항 시작 위치를 찾은 뒤 최대 20,000자 정도만 잘라 분석하는지 확인하십시오.

예상되는 문제 형태는 다음과 같습니다.

```typescript
const excerpt = text.slice(startPosition - 200, startPosition + 20000);
```

이와 비슷한 제한이 있다면, 문서 뒤쪽의 요구사항은 LLM에 전달되지 않으므로 절대로 추출할 수 없습니다.

다음 정보를 Worker 로그에 먼저 추가하십시오.

- 전체 파싱 텍스트 길이
- 전체 문서에서 발견한 요구사항 ID 개수
- 분석 시작 offset
- 분석 종료 offset
- 실제 분석 대상 텍스트 길이
- 분석 대상 범위 안의 요구사항 ID 개수
- 분석 대상 범위 밖의 요구사항 ID 개수
- ID prefix별 발견 개수
- 중복 ID 개수

예시 로그:

```json
{
  "totalTextLength": 84372,
  "detectedIdCount": 59,
  "excerptStart": 16420,
  "excerptEnd": 36420,
  "excerptIdCount": 21,
  "outsideExcerptIdCount": 38,
  "prefixCounts": {
    "ECR": 3,
    "SFR": 13,
    "SER": 8
  }
}
```

현재 누락이 모델 때문인지, 애초에 모델 입력에 포함되지 않았기 때문인지 먼저 확인하십시오.

# **P0: 보안 문제 확인**

프로젝트 문서 또는 Git 히스토리에 실제 LLM API 키가 포함되어 있을 가능성이 있습니다.

다음 사항을 확인하고 조치하십시오.

- 실제 API 키를 코드나 문서에 하드코딩하지 않는다.
- `.env`는 Git에서 제외한다.
- `.env.example`에는 placeholder만 둔다.
- 로그에 API 키가 출력되지 않도록 한다.
- 문서에 노출된 키는 재사용하지 않는다는 경고를 남긴다.
- Git 히스토리 제거가 필요한 경우, 임의로 강제 변경하지 말고 필요한 명령과 위험성을 보고한다.

예시:

```env
DATABASE_URL="postgres://USER:PASSWORD@HOST:PORT/DATABASE"
LLM_API_BASE="https://example.com/v1"
LLM_API_KEY="replace-me"
LLM_MODEL="deepseek-v4-flash"
```

실제 키를 응답, 로그, 커밋 메시지에 출력하지 마십시오.

# **P1: 요구사항 발견 방식을 결정론적으로 변경**

현재처럼 3,500자 단위로 문서를 자르고 LLM에게 요구사항을 찾도록만 하지 마십시오.

먼저 전체 문서에서 요구사항 ID를 정규식으로 수집하십시오.

기본 후보 정규식:

```typescript
const requirementIdPattern =
  /\b([A-Z]{2,8})\s*[-_–—]?\s*(\d{1,4})\b/g;
```

다음 형식을 동일한 ID로 정규화하십시오.

```text
SFR-001
SFR 001
SFR_001
SFR–001
SFR-1
```

정규화 결과:

```text
SFR-001
```

현재 프로젝트에서 알려진 prefix는 다음과 같습니다.

```typescript
const knownRequirementPrefixes = new Set([
  "ECR",
  "SFR",
  "PER",
  "INR",
  "TER",
  "SER",
  "QUR",
  "CNR",
  "COR",
  "PMR",
  "PHR",
  "PSR",
]);
```

단, 이 목록만 하드코딩하여 다른 문서의 새로운 prefix를 무조건 제거하지 마십시오.

권장 방식:

1. 알려진 prefix는 높은 신뢰도 후보로 처리
2. 새로운 영문 prefix도 주변 문맥에 `요구사항`, `고유번호`, `명칭`, `상세` 등이 있으면 후보로 허용
3. 날짜, 버전 번호, 페이지 번호 등의 오탐은 주변 문맥과 길이로 필터링

# **P2: 문자 수 청킹 대신 요구사항 경계로 분할**

전체 문서에서 ID 위치를 모두 찾은 뒤, 현재 ID부터 다음 ID 직전까지를 하나의 요구사항 후보 블록으로 만드십시오.

예시 타입:

```typescript
type RequirementCandidate = {
  normalizedId: string;
  rawId: string;
  rawText: string;
  startOffset: number;
  endOffset: number;
  pageStart?: number;
  pageEnd?: number;
  qualityScore?: number;
};
```

기본 분할 원리:

```typescript
for (let i = 0; i < matches.length; i++) {
  const current = matches[i];
  const next = matches[i + 1];

  candidates.push({
    normalizedId: normalizeRequirementId(current.rawId),
    rawId: current.rawId,
    rawText: fullText.slice(
      current.index,
      next?.index ?? fullText.length,
    ),
    startOffset: current.index,
    endOffset: next?.index ?? fullText.length,
  });
}
```

주의사항:

- 하나의 요구사항이 너무 길면 해당 요구사항 내부에서만 보조 청킹한다.
- 보조 청킹 시 ID와 제목을 모든 하위 청크에 다시 포함한다.
- 서로 다른 요구사항을 하나의 무관한 문자 청크에 섞지 않는다.
- 청크 overlap으로 요구사항 경계 문제를 덮으려 하지 않는다.
- 기존 `splitIntoChunks()`가 다른 기능에 사용될 수 있으므로 무조건 삭제하지 말고 분석 파이프라인에서의 사용 위치를 조정한다.

# **P3: 총괄표와 상세표 중복 처리**

같은 요구사항 ID가 문서에 여러 번 등장할 수 있습니다.

예:

- 목차
- 요구사항 총괄표
- 상세 요구사항 표
- 검수 기준
- 별첨

현재 `deduplicateById()`가 첫 번째 결과만 남긴다면, 상세 내용 대신 한 줄짜리 총괄표가 선택될 수 있습니다.

동일 ID의 후보를 모두 수집한 뒤 품질 점수를 계산하십시오.

가점 예시:

- `요구사항 명칭` 라벨이 있음
- `요구사항 상세`, `상세설명`, `세부내용` 라벨이 있음
- `산출정보`, `검수기준`, `관련 요구사항` 등이 있음
- 텍스트 길이가 충분함
- 표 헤더 다음에 등장함
- 페이지 정보를 확보할 수 있음

감점 예시:

- ID와 제목만 있는 한 줄
- 목차 또는 단순 목록
- 원문 길이가 지나치게 짧음
- 동일한 헤더가 반복됨
- 페이지 번호나 표 헤더만 포함됨

동일 ID 후보 중 가장 상세한 블록을 기본 원문으로 선택하되, 가능하면 다른 후보 위치도 출처 정보로 보존하십시오.

단순히 첫 번째 후보나 마지막 후보를 선택하지 마십시오.

# **P4: LLM의 역할 축소**

LLM에게 문서 청크에서 요구사항을 새로 발견하라고 요청하기보다, 이미 결정론적으로 확보한 요구사항 후보 블록을 구조화하도록 변경하십시오.

LLM의 역할:

- 요구사항 명칭 정리
- 요구사항 유형 분류
- 중요도 분류
- 깨진 줄바꿈 정리
- 원문을 훼손하지 않는 설명 정리
- 잘못 분할된 후보인지 판단 보조

LLM이 수정해서 반환한 텍스트로 원문을 덮어쓰지 마십시오.

반드시 다음을 분리하십시오.

```typescript
type RequirementResult = {
  originalId: string;
  rawSourceText: string;
  normalizedName: string | null;
  normalizedDescription: string | null;
  type: RequirementType;
  priority: RequirementPriority;
  extractionStatus: "enriched" | "raw_only" | "failed";
  needsReview: boolean;
};
```

`rawSourceText`는 파서가 추출한 원문이며 변경하지 않습니다.

LLM 호출이 실패한 경우에도 다음 데이터는 저장 가능해야 합니다.

- original ID
- raw source text
- source offset
- source page
- extraction status = `raw_only`
- needs review = true

LLM 실패 때문에 발견된 요구사항 자체를 버리지 마십시오.

# **deepseek-v4-flash 사용 지침**

현재 모델은 `deepseek-v4-flash`입니다.

당장 다른 모델로 변경하지 마십시오. 먼저 파이프라인 개선 후 동일한 모델로 결과를 다시 측정하십시오.

deepseek-v4-flash 호출 시 다음을 고려하십시오.

- 하나의 호출에 너무 많은 요구사항을 넣지 않는다.
- reasoning이 길어져 timeout이 발생할 수 있으므로 후보 단위 또는 소수 묶음으로 호출한다.
- 모델이 이미 발견된 ID를 변경하지 못하도록 명확히 지시한다.
- ID는 입력값을 그대로 반환하도록 한다.
- 출력 JSON 외의 설명을 최소화하도록 한다.
- 응답이 잘리면 전체 문서를 다시 보내지 말고 해당 후보만 재시도한다.
- timeout과 provider error를 구분해 기록한다.
- 입력 길이, 출력 길이, latency, 실패 사유를 분석 실행 메트릭에 남긴다.
- 가능하면 JSON Schema 또는 명시적인 runtime validator를 사용한다.
- OpenAI 호환 API가 structured output을 완전히 지원한다고 가정하지 말고 실제 응답을 검증한다.

LLM 프롬프트의 핵심 지침 예시:

```text
입력에는 하나 이상의 RFP 요구사항 후보가 포함되어 있다.

각 후보의 requirementId는 시스템이 이미 원문에서 결정론적으로 검출한 값이다.
requirementId를 수정, 생성, 추정 또는 제거하지 마라.

모든 입력 후보에 대해 정확히 하나의 결과를 반환하라.
내용이 부족하더라도 후보를 누락하지 마라.

원문에 없는 사실을 추가하지 마라.
rawSourceText를 요약한 값과 원문을 구분하라.
JSON 외의 설명을 반환하지 마라.
```

# **P5: LLM 응답 검증**

LLM 응답을 바로 DB에 저장하지 마십시오.

runtime schema validator를 사용하십시오. 현재 의존성에 적합한 검증 라이브러리가 없다면 새 의존성을 무조건 추가하지 말고, 기존 방식과 추가 도입 비용을 검토하십시오.

최소 검증 항목:

- JSON 파싱 가능 여부
- 배열 여부
- 입력 후보 수와 출력 결과 수 일치 여부
- 모든 입력 ID가 결과에 존재하는지
- 알 수 없는 ID를 새로 생성했는지
- 중복 ID가 있는지
- 허용된 type 값인지
- 허용된 priority 값인지
- 지나치게 빈 응답인지

LLM 결과가 일부 누락된 경우 전체 호출을 성공으로 간주하지 말고, 누락된 후보만 재시도하십시오.

# **P6: 분석 결과 검증 단계 추가**

DB 저장 전에 다음 메트릭을 계산하십시오.

```typescript
type AnalysisMetrics = {
  totalTextLength: number;
  detectedCandidateCount: number;
  uniqueRequirementIdCount: number;
  duplicateCandidateCount: number;
  selectedCandidateCount: number;
  llmEnrichedCount: number;
  rawOnlyCount: number;
  failedCount: number;
  invalidIdCount: number;
  coverageRatio: number;
};
```

최소 검증 규칙:

- 전체 문서에서 ID가 발견되었는데 최종 결과가 0개이면 실패
- 모든 LLM 호출이 실패했다면 정상 완료로 처리하지 않음
- 일부 후보만 보강되었다면 `completed_with_warnings` 또는 이에 준하는 상태를 사용
- 중복 ID가 최종 requirements에 두 번 저장되지 않음
- 발견한 고유 ID 수와 최종 저장 ID 수 차이를 로그에 명확히 표시
- 커버리지 기준 미달 시 사용자 검토가 필요하다는 상태를 남김

현재 DB 상태 모델을 즉시 크게 변경하기 어렵다면, 기존 `completed` 상태를 유지하면서 `jobs.result` 또는 `jobs.message`에 partial 여부를 기록하는 최소 변경부터 적용하십시오.

단, 이후 상태 분리를 위한 TODO를 남기십시오.

# **P7: 분석 실행 이력 도입 검토**

현재 [`projects.st`](http://projects.st)`atus`와 [`jobs.st`](http://jobs.st)`atus`만으로는 재분석 결과와 이전 결과를 비교하기 어렵습니다.

가능하면 `analysis_runs` 개념을 추가하십시오.

권장 필드:

```text
id
project_id
document_id
job_id
status
quality_status
parser_name
parser_version
model_provider
model_name
prompt_version
started_at
completed_at
heartbeat_at
metrics jsonb
error jsonb
created_at
```

그러나 현재 프로젝트가 진행 중이므로, 이 변경이 너무 크거나 기존 API에 큰 영향을 준다면 즉시 전면 도입하지 마십시오.

먼저 다음 중 안전한 방식을 선택하십시오.

A. 최소 변경:

- 기존 jobs.result에 분석 메트릭 저장
- requirements에 analysis job 또는 run 식별자 추가
- unique constraint 추가

B. 정식 변경:

- analysis_runs 테이블 생성
- jobs는 실행 큐
- analysis_runs는 분석 결과 이력

선택한 이유와 마이그레이션 영향을 보고하십시오.

# **P8: 중복 실행 방지와 트랜잭션**

Worker는 동일 Job을 다시 실행할 수 있다고 가정하십시오.

다음 상황을 고려하십시오.

- Worker가 DB 저장 중 종료
- LLM 호출 후 Worker 종료
- Job이 다시 pending으로 복구
- 두 Worker가 동일 프로젝트를 재분석
- 사용자가 분석 재시도 버튼을 반복 클릭

최소한 다음 unique constraint를 검토하십시오.

```sql
UNIQUE (project_id, original_id)
```

분석 이력을 도입한다면 다음이 더 적합합니다.

```sql
UNIQUE (analysis_run_id, original_id)
```

요구사항과 응답 저장은 반드시 하나의 DB 트랜잭션으로 묶으십시오.

예상 순서:

```text
BEGIN
기존 또는 해당 run의 임시 결과 정리
requirements 저장 또는 upsert
responses 저장
analysis metrics 저장
document 상태 갱신
project 또는 run 상태 갱신
job 완료 처리
COMMIT
```

중간 실패 시 전체 rollback되도록 하십시오.

재시도 시 기존 데이터와 새 데이터가 섞이지 않아야 합니다.

# **P9: Worker stuck Job 복구**

Worker 시작 시 모든 `processing` Job을 무조건 `pending`으로 바꾸지 마십시오.

여러 Worker가 있을 경우 정상 처리 중인 Job까지 중복 실행될 수 있습니다.

권장 필드:

```text
locked_by
locked_at
lease_expires_at
heartbeat_at
attempt_count
available_at
```

권장 복구 조건:

```sql
status = 'processing'
AND lease_expires_at < NOW()
```

현재 단계에서 lease 구현이 과도한 변경이라면 최소한 다음 방식으로 처리하십시오.

- `updated_at`이 일정 시간 이상 지난 processing Job만 복구
- 복구 기준 시간을 상수 또는 환경변수로 관리
- 복구 사실을 로그로 남김
- 정상 처리 중인 최신 Job은 건드리지 않음

# **P10: 문서 파싱 인터페이스 정리**

업로드 API는 PDF와 DOCX를 허용하지만 Worker가 PDF만 파싱하는지 확인하십시오.

parser 인터페이스를 다음처럼 분리하십시오.

```typescript
interface DocumentParser {
  supports(input: {
    mimeType: string;
    extension: string;
  }): boolean;

  parse(buffer: Buffer): Promise<ParsedDocument>;
}

type ParsedDocument = {
  fullText: string;
  pages: Array<{
    pageNumber?: number;
    text: string;
  }>;
  metadata: Record<string, unknown>;
};
```

구현 후보:

```text
PdfDocumentParser
DocxDocumentParser
```

DOCX에는 PDF와 같은 고정 페이지 개념이 없으므로 다음 위치 정보를 사용할 수 있습니다.

- 문단 index
- heading 경로
- 문서 offset

기존 PDF 처리를 깨뜨리지 않는 범위에서 DOCX를 추가하십시오.

# **P11: 출처 추적 강화**

현재 requirements에 `source_text`만 저장하고 출처 페이지나 offset이 없다면 보완하십시오.

최소한 다음 값을 저장할 수 있는 구조를 검토하십시오.

- document_id
- page_start
- page_end
- start_offset
- end_offset
- raw_source_text
- extraction_status
- analysis_run_id 또는 job_id

큰 스키마 변경이 부담스럽다면 requirements에 최소 필드를 추가할 수 있습니다.

정식 구조가 가능하다면 `requirement_sources` 테이블을 권장합니다.

```text
id
requirement_id
document_id
page_start
page_end
start_offset
end_offset
raw_text
source_role
created_at
```

`responses`의 citation과 요구사항 추출 출처를 혼동하지 마십시오.

- requirement source: 요구사항이 원본 RFP의 어디에서 추출되었는지
- response citation: 추천 답변이 어떤 지식 문서에 근거하는지

# **P12: 상태 모델 점검**

현재 [`projects.st`](http://projects.st)`atus`가 다음처럼 되어 있다면:

```text
draft → analyzing → review → final
```

이 값이 프로젝트 업무 상태와 분석 처리 상태를 동시에 표현하는 문제가 있습니다.

장기적으로 다음처럼 분리하는 것이 좋습니다.

프로젝트 상태:

```text
draft
review
approved
archived
```

분석 상태:

```text
queued
parsing
extracting
enriching
validating
completed
completed_with_warnings
failed
cancelled
```

하지만 현재 API와 UI가 기존 상태에 의존하고 있으므로 즉시 전면 변경하지 마십시오.

우선:

- 기존 UI 호환성을 유지
- 내부 분석 단계는 jobs.message 또는 별도 필드로 구분
- 상태 분리 필요성을 문서화
- 추후 마이그레이션 가능한 구조로 작성

# **P13: DB 스키마 불일치 확인**

다음 사항을 실제 코드에서 확인하십시오.

- ERD에는 users가 있는데 실제 users 테이블이 없는지
- audit_logs.actor_id가 존재하지 않는 users를 참조하는지
- `documents → projects`, `requirements → projects` 삭제 정책
- `updated_at`이 UPDATE 시 실제로 갱신되는지
- `jobs.progress`에 0~100 check constraint가 있는지
- `project_id + original_id` 중복 제약이 있는지
- `metadata`, `result`, `error`가 JSON 문자열인데 text로 저장되는지
- `order` 컬럼명이 혼동을 유발하는지
- timestamp 대신 timestamptz가 필요한지

기존 데이터가 있는 상태를 고려해 파괴적인 스키마 변경을 피하십시오.

마이그레이션이 필요한 경우:

1. nullable 필드 추가
2. 기존 데이터 backfill
3. 애플리케이션 코드 전환
4. 마지막에 constraint 강화

순서로 진행하십시오.

# **P14: document_chunks 생성 흐름 확인**

유사 RFP 검색 API는 `document_chunks`를 검색하지만, 실제 업로드 및 분석 과정에서 document_chunks가 생성되지 않을 가능성이 있습니다.

다음을 확인하십시오.

- 업로드한 PDF가 파싱된 뒤 document_chunks에 저장되는지
- 페이지 번호가 저장되는지
- 같은 문서를 재분석할 때 chunk가 중복 생성되는지
- 시드 데이터에만 chunk가 존재하는지
- `similar` API가 실제 업로드 문서를 검색할 수 있는지
- PostgreSQL FTS 인덱스가 있는지
- 현재 pgvector embedding 컬럼이 실제로 사용되는지

분석 파이프라인과 검색 파이프라인을 연결하십시오.

권장 순서:

```text
문서 파싱
→ 페이지 또는 섹션 단위 데이터 생성
→ document_chunks 저장
→ 요구사항 후보 추출
→ LLM 보강
→ 필요 시 embedding 생성
```

임베딩 API가 준비되지 않았다면 embedding 컬럼을 억지로 채우지 마십시오. 우선 lexical search가 정상 동작하도록 하십시오.

# **P15: 사업기간 추출 개선**

사업기간은 LLM만 사용하지 말고 정규식 또는 키워드 기반 추출을 먼저 시도하십시오.

검색 키워드 예시:

```text
사업기간
계약기간
수행기간
과업기간
용역기간
구축기간
```

후보 패턴 예시:

```text
계약 체결일로부터 150일
착수일로부터 6개월
2026년 1월부터 2026년 12월까지
계약일로부터 12개월
```

권장 순서:

```text
문서 전체 키워드 탐색
→ 주변 문장 추출
→ 정규식 후보 생성
→ 후보가 명확하면 그대로 저장
→ 복수 후보 또는 불명확할 때만 LLM 사용
```

문서 앞 2,000자에만 있다고 가정하지 마십시오.

# **P16: 테스트 데이터셋과 평가 자동화**

현재 테스트 PDF의 정답 요구사항 ID를 golden dataset으로 만드십시오.

예:

```json
{
  "document": "공고_제안요청서.pdf",
  "expectedRequirementIds": [
    "ECR-001",
    "ECR-002",
    "ECR-003",
    "SFR-001"
  ]
}
```

최소 평가 지표:

```text
true positives
false positives
false negatives
precision
recall
F1
prefix별 recall
최초 누락 ID
마지막 누락 ID
중복 ID 수
LLM 보강 성공률
전체 분석 시간
LLM 호출 횟수
```

가장 중요한 지표는 ID recall입니다.

목표:

```text
요구사항 ID recall >= 99%
중복 저장 = 0
silent zero-result success = 0
원문 출처 보존율 = 100%
```

유형과 중요도 분류는 ID 및 원문 추출보다 낮은 우선순위입니다.

다음 문서들로 회귀 테스트하십시오.

- 한국기술대 전자결재 시스템 고도화 PDF
- 한국폴리텍 전자결재 시스템 고도화 PDF
- 공고 제안요청서 PDF
- 가능하면 DOCX 샘플

실제 LLM 호출 테스트와 LLM 없이 수행 가능한 parser 테스트를 분리하십시오.

# **기존 기능 보존 원칙**

다음 기능을 깨뜨리지 마십시오.

- PDF 업로드
- 프로젝트 자동 생성
- Job 등록
- Worker polling
- 진행률 API
- 프로젝트 상세 조회
- 대시보드 목록
- 프로젝트 삭제
- 분석 완료 후 `router.refresh()`
- 분석 중 페이지 재진입 시 polling 재개
- 유사 RFP 검색
- 기존 시드 스크립트
- `pnpm dev`
- `pnpm worker`
- `scripts/start.sh`

기존 API 응답 형식을 바꿔야 한다면 기존 필드는 유지하고 새 필드를 추가하십시오.

프론트엔드를 즉시 대규모 수정하지 마십시오. 백엔드 개선 후 필요한 최소 UI 변경만 수행하십시오.

# **피해야 할 작업**

다음 행동을 하지 마십시오.

1. 실제 코드를 확인하지 않고 문서만 보고 파일을 생성하지 않는다.
2. 전체 프로젝트를 새 아키텍처로 한 번에 다시 작성하지 않는다.
3. 현재 deepseek-v4-flash를 근거 없이 다른 모델로 교체하지 않는다.
4. 단순히 `max_tokens`만 높여 문제를 해결했다고 판단하지 않는다.
5. 단순히 청크 크기만 줄여 커버리지 문제가 해결되었다고 판단하지 않는다.
6. 20,000자 제한을 유지한 채 모델만 비교하지 않는다.
7. LLM이 반환한 원문을 신뢰하여 실제 raw source를 덮어쓰지 않는다.
8. 청크 실패를 로그만 남기고 정상 완료하지 않는다.
9. 재시도 시 기존 requirements 위에 중복 INSERT하지 않는다.
10. 모든 processing Job을 무조건 pending으로 초기화하지 않는다.
11. API 키나 DATABASE_URL을 코드, 로그, 보고서에 출력하지 않는다.
12. 기존 DB 데이터를 무단으로 TRUNCATE하지 않는다.
13. 마이그레이션 없이 운영 데이터를 파괴할 수 있는 컬럼 변경을 하지 않는다.
14. 테스트를 통과시키기 위해 golden expected 결과를 실제 출력에 맞춰 낮추지 않는다.
15. TypeScript 오류를 `any` 추가만으로 숨기지 않는다.
16. 원인을 확인하지 않고 pdf-parse를 즉시 다른 파서로 교체하지 않는다.
17. 모든 문제를 LLM 품질 문제로 결론 내리지 않는다.
18. 요청하지 않은 UI 재디자인을 하지 않는다.
19. 실제 존재하지 않는 파일이나 구현을 완료했다고 보고하지 않는다.
20. 테스트하지 않은 성능 수치를 사실처럼 기록하지 않는다.

# **권장 구현 순서**

다음 순서를 지키십시오.

## **단계 1: 진단과 계측**

- 현재 전체 텍스트 길이 확인
- 전체 ID 검출 수 확인
- 20,000자 슬라이스 여부 확인
- 청크별 입력 ID 수와 출력 ID 수 기록
- 누락 ID가 모델 입력에 있었는지 확인
- document_chunks 생성 여부 확인
- 현재 DB unique constraint 확인

이 단계에서는 큰 리팩터링을 하지 마십시오.

## **단계 2: 전체 문서 ID 추출**

- ID 정규화 함수 구현
- 전체 ID 후보 추출
- prefix별 통계
- 중복 후보 수집
- 관련 unit test 작성

## **단계 3: 요구사항 경계 분할**

- ID 사이의 원문 블록 생성
- 너무 짧은 후보 판별
- 총괄표/상세표 후보 품질 점수
- 동일 ID의 대표 블록 선택
- unit test 작성

## **단계 4: LLM 보강 방식 변경**

- 후보 블록을 입력으로 사용
- 모든 입력 ID가 출력에 있는지 검증
- 실패 후보만 재시도
- 실패 시 raw_only 보존
- deepseek-v4-flash로 회귀 테스트

## **단계 5: 안전한 DB 저장**

- unique constraint 또는 upsert
- transaction
- 중간 실패 rollback
- job 결과 메트릭 저장
- 부분 성공 상태 기록

## **단계 6: Worker 복구 안정성**

- stale processing Job만 복구
- retry attempt 기록
- 중복 실행 테스트

## **단계 7: DOCX 및 출처 강화**

- parser 인터페이스
- mammoth 연동
- page 또는 paragraph source 위치
- requirement source 저장

## **단계 8: 검색 연결 확인**

- document_chunks 생성
- 중복 방지
- FTS 검색 확인
- 추후 hybrid search가 가능하도록 경계 정리

# **각 단계의 완료 조건**

각 단계가 끝날 때 다음 내용을 보고하십시오.

```text
1. 확인한 실제 원인
2. 수정한 파일
3. 변경한 동작
4. 기존 동작에 미치는 영향
5. 실행한 명령
6. 테스트 결과
7. 남아 있는 위험
8. 다음 우선순위
```

가능하면 커밋도 작은 단위로 나누십시오.

예시:

```text
chore: add RFP extraction diagnostics
feat: detect requirement IDs across full document
feat: split requirement candidates by ID boundary
fix: preserve raw requirements when LLM enrichment fails
fix: make analysis result persistence idempotent
fix: recover only stale processing jobs
```

# **필수 테스트 명령**

프로젝트의 실제 package.json script를 먼저 확인한 뒤 가능한 명령을 실행하십시오.

예상 명령:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

해당 script가 없으면 존재하지 않는 명령을 실행했다고 보고하지 마십시오.

필요하면 특정 테스트 스크립트를 추가하되, 테스트를 위해 운영 코드를 복제하지 마십시오.

DB 마이그레이션 또는 push 전에는 변경 내용을 먼저 확인하십시오.

# **최소 회귀 테스트 시나리오**

다음을 반드시 확인하십시오.

## **시나리오 1: 59개 요구사항 PDF**

- 전체 ID 검출 수
- 최종 저장 수
- 누락 ID 목록
- 중복 ID 목록
- raw_only 개수
- 처리 시간

## **시나리오 2: Worker 중간 종료 후 재시작**

- processing Job 복구
- 동일 요구사항 중복 여부
- 기존 partial 데이터 정리 여부
- 최종 상태 일관성

## **시나리오 3: LLM 호출 일부 실패**

- 성공 후보는 저장
- 실패 후보는 raw_only 저장
- job은 부분 성공으로 표시
- 0건 정상 완료가 발생하지 않음

## **시나리오 4: 프로젝트 삭제**

- 새 테이블 또는 새 FK 때문에 삭제가 실패하지 않음
- 삭제되어야 할 소유 데이터가 남지 않음
- 감사 목적으로 유지할 데이터가 있다면 명시

## **시나리오 5: 기존 UI**

- 분석 진행률 표시
- 분석 완료 후 데이터 새로고침
- 프로젝트 재진입 시 polling 재개
- 요구사항 매트릭스 표시

# **성공 기준**

이번 개선의 성공 여부를 단순히 “에러 없이 실행됨”으로 판단하지 마십시오.

최소 성공 기준:

```text
전체 문서에서 요구사항 ID를 탐색한다.
20,000자 제한 때문에 뒤쪽 요구사항이 제외되지 않는다.
요구사항 경계를 기준으로 원문 블록을 생성한다.
LLM 실패 시에도 발견한 요구사항 원문을 보존한다.
최종 ID recall이 기존보다 명확하게 개선된다.
동일 프로젝트 재분석 시 중복 requirements가 발생하지 않는다.
모든 LLM 호출 실패 시 0건 정상 완료로 처리하지 않는다.
기존 업로드와 진행률 UI가 정상 동작한다.
```

최종 목표 기준:

```text
공고_제안요청서.pdf의 알려진 59개 요구사항 ID 기준 recall 99% 이상
false positive 최소화
중복 ID 저장 0건
모든 요구사항에 raw source 보존
재시도 후 데이터 일관성 유지
```

# **최종 결과 보고 형식**

모든 작업이 끝난 뒤 다음 형식으로 보고하십시오.

## **1. 발견한 핵심 원인**

실제 코드와 로그를 근거로 작성하십시오.

## **2. 구현한 개선**

파일별로 설명하십시오.

## **3. 기존 구조를 유지한 부분**

전면 리팩터링하지 않은 이유를 포함하십시오.

## **4. 테스트 결과**

문서별로 다음 표를 작성하십시오.

```text
문서
예상 ID 수
검출 ID 수
최종 저장 수
누락 수
오탐 수
중복 수
raw_only 수
분석 시간
```

## **5. DB 변경**

추가된 컬럼, 인덱스, 제약조건, 마이그레이션 내용을 작성하십시오.

## **6. 남은 위험**

확인되지 않은 사항을 완료한 것처럼 말하지 마십시오.

## **7. 다음 권장 작업**

현재 개선 이후에 필요한 항목만 우선순위대로 작성하십시오.

# **가장 중요한 지시**

먼저 모델을 교체하지 마십시오.

우선 전체 RFP 문서에서 요구사항 ID를 결정론적으로 탐색하고, ID 경계에 따라 요구사항 원문을 분리하십시오.

현재 28.8% 커버리지의 원인이 deepseek-v4-flash 또는 다른 모델의 성능 문제라고 단정하지 마십시오. 실제로 모델 입력 범위 밖에 요구사항이 있었는지, 문자 청킹 때문에 요구사항이 잘렸는지, 총괄표와 상세표 중 잘못된 후보가 선택되었는지를 먼저 증명하십시오.

기존 프로젝트를 존중하고, 작은 변경 단위로 구현하고, 각 변경을 실제 테스트 결과로 검증하십시오.

첫 실행에서는 위 프롬프트 전체를 전달하고, 이후에는 에이전트가 보고한 변경 사항을 기준으로 단계별 검토 프롬프트를 이어가는 방식이 안전합니다.