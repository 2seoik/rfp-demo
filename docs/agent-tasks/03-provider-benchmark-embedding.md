이전 단계에서 다음 작업이 완료된 상태입니다.

- sourceText는 ID 경계 블록 원문을 직접 저장
- LLM은 name, type, priority만 반환
- 요구사항을 토큰 또는 문자 기준으로 배치 처리
- 제한된 동시성 적용
- 입력 ID와 출력 ID 검증
- 누락·오류 ID만 재시도
- 부분 성공 및 PARTIAL 상태 처리

이제 LLM provider 구조를 안정화하고 모델별 성능 벤치마크를 추가해 주세요.

## **현재 환경**

- Node.js 24
- TypeScript
- Next.js 16
- PostgreSQL 16
- Worker는 tsx로 별도 실행
- OpenAI SDK v6
- OpenCode 게이트웨이 사용
- 현재 동작 모델은 kimi-k2.6
- minimax-m2.7은 응답이 0건으로 처리되는 문제가 있었음
- glm-5.2는 timeout
- deepseek-v4-flash는 reasoning 출력이 과도했음
- bge-m3 임베딩 서버는 준비되어 있고 연결 코드 일부가 존재함

## **목표**

1. 모델별 API 응답 차이를 흡수하는 provider adapter 구현
2. 빈 응답과 파싱 문제를 정확히 로깅
3. 주 모델 실패 시 fallback 모델 사용
4. 실제 RFP PDF 기준 벤치마크 도구 추가
5. 임베딩을 요구사항 추출 완료 이후의 별도 후처리 단계로 분리

## **필수 변경사항**

### **1. 현재 LLM 호출 구조 조사**

먼저 다음을 확인하세요.

- OpenAI SDK client 생성 위치
- baseURL 설정 위치
- model 환경변수
- chat.completions 호출 위치
- responses API 사용 여부
- 응답 content 추출 방식
- JSON 파싱 방식
- reasoning_content 또는 별도 reasoning 필드 처리 여부
- timeout 및 retry 설정
- OpenCode Go 또는 Zen endpoint 사용 여부

실제 코드와 환경변수 예제를 분석한 뒤 변경하세요.

비밀 키 값은 출력하거나 로그에 남기지 마세요.

### **2. provider adapter 인터페이스**

모델별 호출 방식을 하나의 인터페이스로 추상화하세요.

예:

```ts
type RequirementBatchInput = {
  requirements: Array<{
    id: string;
    text: string;
  }>;
};

type RequirementBatchOutput = {
  requirements: Array<{
    id: string;
    name: string;
    type: string | null;
    priority: string | null;
  }>;
};

interface RequirementLlmProvider {
  name: string;

  enrichBatch(
    input: RequirementBatchInput,
    options?: {
      timeoutMs?: number;
      signal?: AbortSignal;
    }
  ): Promise<RequirementBatchOutput>;
}
```

현재 OpenAI-compatible 호출은 하나의 adapter로 구현하세요.

필요한 경우 Anthropic-style messages 호출용 adapter를 별도로 만들 수 있지만, 실제 현재 endpoint가 해당 형식을 지원하는지 코드나 설정에서 확인한 후 구현하세요.

확인되지 않은 API 형식을 임의로 추가하지 마세요.

### **3. 응답 정규화**

모델 응답이 다음 형태 중 하나일 수 있으므로 현재 실제 응답을 기준으로 안전하게 정규화하세요.

- 일반 문자열 content
- content 배열
- JSON 객체
- markdown code fence 안의 JSON
- reasoning_content와 final content 분리
- 빈 문자열
- null content

응답 파서는 다음 순서로 처리하세요.

```text
1. 최종 답변 content 탐색
2. 문자열 또는 텍스트 파트 결합
3. JSON code fence 제거
4. JSON parse
5. schema validation
6. requirements 배열 확인
7. ID reconciliation
```

reasoning 텍스트를 최종 JSON으로 잘못 파싱하지 않도록 하세요.

빈 응답인 경우 `EMPTY_RESPONSE` 오류로 명확하게 분류하세요.

### **4. 원본 응답 진단 로그**

운영 로그에 전체 원문을 무조건 남기지 말고 다음 진단 메타데이터를 남기세요.

```ts
{
  provider: string;
  model: string;
  endpointType: string;
  httpStatus?: number;
  contentType?: string;
  finishReason?: string;
  responseContentLength: number;
  reasoningContentLength?: number;
  inputTokens?: number;
  outputTokens?: number;
  elapsedMs: number;
  errorType?: string;
}
```

개발 환경에서만 제한적으로 원본 응답을 볼 수 있는 debug 옵션을 제공해도 됩니다.

예:

```env
RFP_LLM_DEBUG_RESPONSE=false
```

debug가 true여도 API 키나 Authorization 헤더는 출력하지 마세요.

### **5. 모델 설정과 fallback**

환경변수로 주 모델과 fallback 모델을 설정하세요.

예:

```env
RFP_LLM_PRIMARY_MODEL=kimi-k2.6
RFP_LLM_FALLBACK_MODELS=kimi-k2.7-code,mimo-v2.5
```

실제 사용 가능한 모델명은 현재 프로젝트의 OpenCode 설정이나 모델 조회 결과를 기준으로 사용하세요.

fallback 흐름:

```text
주 모델 호출
→ timeout, 429, 5xx, empty response 또는 반복된 schema 오류
→ fallback 모델 호출
→ 성공하면 정상 저장
→ 모두 실패하면 요구사항 상태 FAILED
```

ID 일부만 실패한 경우 전체 배치를 fallback으로 보내지 말고 실패한 ID만 fallback 모델에 보내세요.

모델별로 endpoint 형식이 다른 경우 adapter를 선택하도록 구성하세요.

모델명을 기준으로 코드에 복잡한 if 문을 여러 곳에 만들지 마세요.

### **6. 모델별 옵션 분리**

모델마다 가능한 옵션이 다를 수 있으므로 설정 객체를 사용하세요.

예:

```ts
const MODEL_CONFIG = {
  "kimi-k2.6": {
    provider: "openai-compatible",
    temperature: 0,
  },
  "mimo-v2.5": {
    provider: "openai-compatible",
    temperature: 0,
  },
};
```

구조화 추출 작업이므로 기본 temperature는 0 또는 가능한 가장 낮은 값으로 설정하세요.

지원 여부가 불명확한 옵션은 보내지 마세요.

reasoning effort 옵션도 endpoint가 지원하는 경우에만 사용하세요.

### **7. 벤치마크 스크립트 작성**

실제 Worker와 독립적으로 실행할 수 있는 벤치마크 스크립트를 추가하세요.

권장 실행 예:

```bash
pnpm benchmark:rfp
```

또는 프로젝트 구조에 맞는 명령을 추가하세요.

벤치마크 입력은 다음 중 기존 프로젝트에 가장 적합한 방법을 사용하세요.

- 기존에 파싱된 요구사항 블록 JSON
- 테스트 PDF를 직접 파싱
- DB에 저장된 특정 documentId
- fixture 파일

API 키가 없을 때는 친절한 오류를 출력하고 종료하세요.

### **8. 벤치마크 대상**

환경변수 또는 CLI 인수로 모델과 설정을 선택할 수 있게 하세요.

예:

```bash
pnpm benchmark:rfp --models=kimi-k2.6,mimo-v2.5 --batch-sizes=5,10 --concurrency=1,2
```

CLI 파서 라이브러리가 없다면 간단한 인수 파싱으로 구현하세요.

불필요하게 큰 의존성을 추가하지 마세요.

### **9. 벤치마크 지표**

각 모델·배치 크기·동시성 조합에 대해 다음을 기록하세요.

```text
model
batchSize
concurrency
totalRequirements
totalRequests
successfulRequests
failedRequests
retryCount
fallbackCount
totalElapsedMs
averageRequestMs
p50RequestMs
p95RequestMs
jsonParseSuccessRate
idCoverage
missingIdCount
duplicateIdCount
invalidFieldCount
emptyResponseCount
timeoutCount
rateLimitCount
inputTokens
outputTokens
```

토큰 정보가 API 응답에 없으면 null로 저장하세요.

결과를 콘솔 표로 출력하고 JSON 파일로도 저장하세요.

예:

```text
benchmarks/rfp-benchmark-YYYYMMDD-HHmmss.json
```

민감한 원문과 API 키는 결과 파일에 저장하지 마세요.

### **10. 정답 데이터가 있을 경우 정확도 비교**

현재 테스트 PDF에 사람이 검토한 정답 데이터가 있다면 다음 정확도를 계산하세요.

- name 일치 또는 유사도
- type 정확도
- priority 정확도
- ID coverage

정답 데이터가 없다면 임의의 정확도를 만들지 말고 다음 지표만 사용하세요.

- ID coverage
- 필드 누락률
- 파싱 성공률
- 처리 시간
- 실패율

### **11. 임베딩 단계 분리**

bge-m3 임베딩은 요구사항 추출의 필수 성공 조건으로 만들지 마세요.

권장 상태 흐름:

```text
EXTRACTION_PENDING
EXTRACTION_PROCESSING
EXTRACTION_COMPLETED
EMBEDDING_PENDING
EMBEDDING_PROCESSING
COMPLETED
```

추출은 성공했지만 임베딩이 실패한 경우에도 요구사항 테이블은 사용자에게 표시되어야 합니다.

임베딩 실패 때문에 문서 전체 상태를 FAILED로 변경하지 마세요.

가능하다면 다음 별도 상태를 사용하세요.

```ts
{
  extractionStatus: "COMPLETED",
  embeddingStatus: "FAILED"
}
```

기존 DB 구조가 이를 지원하지 않으면 최소 변경으로 분리 가능한 방식을 선택하세요.

### **12. 임베딩 실행 조건**

임베딩은 다음 조건에서만 시작하세요.

- 요구사항 기본 행 생성 완료
- sourceText 저장 완료
- 추출 상태 COMPLETED 또는 PARTIAL
- sourceText가 비어 있지 않음
- 아직 embedding이 존재하지 않음

LLM의 name, type, priority가 일부 실패해도 sourceText가 있으면 임베딩할 수 있도록 하세요.

다만 현재 핵심 병목은 LLM 속도이므로 임베딩 요청이 LLM 배치 처리와 리소스를 경쟁하지 않게 하세요.

권장 방식:

```text
LLM 추출 완료
→ 사용자에게 요구사항 결과 제공
→ 별도 후처리 작업으로 임베딩 생성
```

### **13. 테스트 요구사항**

다음 테스트를 추가하세요.

1. 문자열 content 응답 파싱
2. content 배열 응답 파싱
3. JSON code fence 응답 파싱
4. 빈 응답 오류 분류
5. reasoning과 final content가 분리된 응답 처리
6. 주 모델 실패 후 fallback 모델 성공
7. 일부 ID만 fallback으로 전달
8. 모든 모델 실패 시 FAILED 처리
9. API 키가 로그에 출력되지 않는지 확인
10. 벤치마크 지표 계산 테스트
11. 추출 완료 후 임베딩 작업 생성
12. 임베딩 실패 시 추출 결과가 유지되는 테스트
13. 기존 테스트 전체 통과

외부 API는 mock으로 테스트하세요.

## **권장 실행 순서**

실제 코드는 다음 우선순위로 적용하세요.

```text
1. 현재 응답 파싱과 endpoint 진단
2. provider adapter
3. 빈 응답 오류 처리
4. fallback 모델
5. 벤치마크 스크립트
6. 임베딩 후처리 분리
```

## **작업 방식**

- 먼저 실제 코드와 환경변수를 확인하세요.
- 확인되지 않은 OpenCode endpoint나 모델 ID를 추측하지 마세요.
- 기존 OpenAI SDK 구조를 최대한 재사용하세요.
- API 키와 민감한 정보를 보호하세요.
- 타입 검사를 통과시키세요.
- lint, typecheck, vitest를 실행하세요.
- 벤치마크는 API 키가 없더라도 코드 자체가 빌드되고 도움말을 출력해야 합니다.
- 질문하지 말고 프로젝트 코드에서 확인 가능한 내용을 기준으로 최선의 구현을 진행하세요.

## **완료 보고 형식**

1. 확인한 현재 provider와 endpoint 구조
2. MiniMax 빈 응답의 코드상 가능한 원인
3. 추가한 provider adapter 구조
4. 응답 정규화 방식
5. primary 및 fallback 모델 설정 방법
6. 벤치마크 실행 명령과 출력 파일
7. 임베딩 단계 분리 방식
8. 수정한 파일 목록
9. 테스트 및 타입 검사 결과
10. 운영 적용 전 확인할 환경변수 목록

## 완료 조건

- 요구된 코드가 실제로 수정되어야 한다.
- 기존 테스트와 신규 테스트가 모두 통과해야 한다.
- TypeScript 오류가 없어야 한다.
- 수정 파일 목록을 보고해야 한다.
- 미완료 항목이 있으면 완료라고 표시하지 않아야 한다.
- 작업 결과를 progress.md에 기록해야 한다.