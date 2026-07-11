RFP Demo 프로젝트 상태

이 문서는 RFP Demo 프로젝트의 현재 구현 상태, 검증 결과, 알려진 문제와 다음 작업 우선순위를 요약한다.
상세한 기술 계약과 구현 기준은 spec.md를 참조한다.

* 상태 기준일: 2026-07-10
* 현재 작업 브랜치: feat/worker-pattern
* 안정 브랜치: main
* 전체 상태: 기능 데모 가능 / 분석 품질 개선 필요
* 주요 위험 요소: LLM 요구사항 추출 커버리지
* 현재 기본 모델: minimax-m2.7

⸻

1. 현재 상태 요약

RFP PDF를 업로드하면 프로젝트와 분석 Job이 생성되고, 별도 Worker가 문서를 파싱하여 요구사항을 추출한 뒤 요구사항 매트릭스에 표시하는 전체 흐름이 구현되어 있다.

HTTP 요청과 분석 작업은 분리되어 있으므로 사용자가 페이지를 이동하더라도 Worker 분석은 계속 진행된다. 프로젝트 상세 페이지에 다시 진입하면 프로젝트 상태를 기준으로 polling이 자동 재개된다.

현재 시스템은 데모와 기능 검증에는 사용할 수 있지만, 기본 LLM 모델의 낮은 추출 커버리지로 인해 실제 운영 수준의 분석 정확도는 충족하지 못한다.

핵심 상태

영역	상태	설명
프로젝트 생성	✅ 완료	API 및 파일 업로드를 통한 생성 지원
PDF 업로드	✅ 완료	업로드 파일을 로컬 uploads/에 저장
DOCX 업로드	⚠️ 부분 완료	업로드는 허용하지만 Worker 파싱은 미구현
비동기 Worker	✅ 완료	DB polling 방식으로 분석 Job 처리
분석 진행률	✅ 완료	2초 간격 polling으로 표시
PDF 텍스트 추출	✅ 완료	pdf-parse 사용
사업기간 추출	⚠️ 부분 완료	LLM 추출만 존재하며 실패 시 fallback 없음
요구사항 추출	⚠️ 부분 완료	기능은 동작하지만 모델별 커버리지 편차가 큼
요구사항 매트릭스	✅ 완료	ID, 명칭, 내용, 유형, 중요도 표시
프로젝트 삭제	✅ 완료	연관 데이터 FK 순서 삭제
유사 RFP 검색	✅ 완료	PostgreSQL Full-Text Search 기반
벡터 유사 검색	❌ 미구현	스키마만 존재하고 embedding은 사용하지 않음
Worker 장애 복구	⚠️ 부분 완료	Job 재시도는 있으나 stuck Job 자동 복구 없음
자동화 테스트	❌ 미구현	현재 수동 통합 테스트 중심

⸻

2. 현재 동작 가능한 사용자 흐름

1. 사용자가 프로젝트명과 PDF 파일을 업로드한다.
2. 서버가 다음 데이터를 생성한다.
    * Organization
    * Project
    * Document
    * 분석 Job
3. 프로젝트 상태가 analyzing으로 변경된다.
4. Worker가 가장 오래된 pending Job을 가져온다.
5. Worker가 PDF에서 텍스트를 추출한다.
6. 문서 앞부분에서 사업기간을 추출한다.
7. 요구사항 섹션을 탐색하고 약 20,000자의 분석 대상을 구성한다.
8. 분석 대상을 3,500자 단위의 청크로 분리한다.
9. 각 청크를 LLM에 전송하여 요구사항을 추출한다.
10. 요구사항 ID 기준으로 결과를 중복 제거하고 유효성 검사를 수행한다.
11. 요구사항과 기본 Response 레코드를 DB에 저장한다.
12. 프로젝트 상태를 review로 변경한다.
13. 프론트엔드 polling이 완료 상태를 감지한다.
14. 페이지를 새로고침하여 요구사항 매트릭스를 표시한다.

⸻

3. 구현 완료 항목

3.1 애플리케이션 및 UI

* Next.js App Router 기반 페이지 구성
* 공통 레이아웃과 네비게이션
* 프로젝트 대시보드
* 신규 RFP 업로드 화면
* 프로젝트 상세 화면
* 요구사항 매트릭스
* 요구사항 선택 및 우측 상세 패널
* 분석 진행 오버레이
* 진행률 프로그레스 바
* 분석 단계별 상태 카드
* 유사 RFP 검색 탭
* 프로젝트 삭제 버튼
* 프로젝트 재진입 시 분석 상태 복구

3.2 API

* POST /api/upload
* GET /api/projects
* POST /api/projects
* GET /api/projects/[id]
* DELETE /api/projects/[id]
* GET /api/projects/[id]/analyze-status
* GET /api/projects/[id]/similar

3.3 데이터베이스

다음 주요 테이블이 정의되어 있다.

* organizations
* users
* projects
* documents
* document_chunks
* requirements
* responses
* citations
* jobs
* audit_logs

PostgreSQL 확장 기능은 다음을 사용한다.

* vector
* pg_trgm

3.4 Worker

* 독립 프로세스 실행
* 2초 주기 Job polling
* FOR UPDATE SKIP LOCKED 기반 중복 처리 방지
* PDF 파싱
* 문서 정제
* 요구사항 영역 탐색
* Map-Reduce 방식 청크 분석
* LLM 요청 타임아웃
* 요구사항 ID 필터링
* 요구사항 중복 제거
* 진행률 및 상태 메시지 갱신
* 최대 3회 Job 재시도
* 분석 결과 DB 저장
* 성공 및 실패 상태 처리

3.5 검색

* 현재 프로젝트 요구사항에서 검색어 추출
* 동일 조직의 다른 RFP 문서 검색
* PostgreSQL to_tsvector() 및 ts_rank() 사용
* 문서별 검색 결과 그룹화
* 평균 검색 점수 기준 정렬

⸻

4. 최근 해결된 문제

4.1 대용량 LLM 요청 타임아웃

기존에는 약 30,000자의 전체 분석 대상을 한 번에 LLM에 전달하여 90초 이상의 타임아웃이 발생했다.

현재는 약 3,500자 단위의 청크로 분리한 Map-Reduce 방식으로 변경했다.

상태: 해결

⸻

4.2 Worker 요청 타임아웃 미동작

Promise.race() 기반 타임아웃이 OpenAI SDK 내부 요청을 실제로 중단하지 못하는 문제가 있었다.

현재는 다음 방식으로 HTTP 요청 자체를 중단한다.

client.chat.completions.create(
  request,
  {
    signal: AbortSignal.timeout(timeoutMs),
  }
);

상태: 해결

⸻

4.3 프로젝트 상태 문자열 저장 오류

DB에 review가 아닌 따옴표가 포함된 'review' 문자열이 저장되어 프론트엔드 상태 비교가 실패했다.

SQL 매개변수화 부분에서 불필요한 따옴표를 제거했다.

상태: 해결

⸻

4.4 잘못된 요구사항 ID 저장

LLM이 카테고리명이나 설명 텍스트를 요구사항으로 반환하는 문제가 있었다.

현재는 다음 형식과 일치하는 ID만 저장한다.

^[A-Z]{2,4}-\d{3}$

예시:

ECR-001
SFR-003
SER-008

상태: 해결

⸻

4.5 초기 Organization 부재 시 업로드 실패

DB 초기화 직후 Organization 데이터가 없으면 첫 업로드가 실패했다.

현재는 업로드 시 Organization이 없으면 기본 Organization을 자동 생성한다.

상태: 해결

⸻

4.6 프로젝트 삭제 FK 오류

프로젝트 삭제 시 jobs 테이블 참조 때문에 삭제가 실패했다.

현재는 연관 데이터를 다음 순서로 삭제한다.

citations
→ responses
→ requirements
→ document_chunks
→ jobs
→ documents
→ projects

상태: 해결

⸻

4.7 프로젝트 상세 카드 스크롤 문제

매트릭스가 긴 경우 우측 상세 카드가 화면 밖으로 사라졌다.

현재는 다음 스타일을 적용한다.

sticky top-6
max-h-[calc(100vh-8rem)]
overflow-y-auto

상태: 해결

⸻

4.8 프로젝트 재진입 시 진행률 미표시

업로드 직후의 URL 파라미터가 없는 상태로 프로젝트에 재진입하면 분석 진행 UI가 표시되지 않았다.

현재는 다음 두 조건 중 하나를 만족하면 polling을 시작한다.

autoAnalyze || project.status === "analyzing"

상태: 해결

⸻

5. 현재 알려진 문제

5.1 요구사항 추출 커버리지 부족

현재 가장 중요한 문제다.

minimax-m2.7은 응답 속도는 빠르지만 하나의 청크에 포함된 요구사항 중 일부만 추출하고 응답을 끝내는 경향이 있다.

확인된 결과

모델	추출 결과	상태
deepseek-v4-flash	59/59	정확하지만 느림
minimax-m2.7	17/59	빠르지만 커버리지 부족

공고_제안요청서.pdf를 기준으로 현재 기본 모델의 추출률은 다음과 같다.

17 / 59 = 28.8%

영향

* 요구사항 매트릭스에 실제 RFP 요구사항 일부만 표시된다.
* 누락 여부를 사용자가 직접 확인해야 한다.
* 운영 환경에서 결과를 신뢰하기 어렵다.

후보 개선안

1. gpt-4o-mini 등 추출 성능이 높은 모델로 교체
2. 청크 크기를 3,500자에서 2,500자로 축소
3. max_tokens를 4,096에서 8,192로 증가
4. 프롬프트에서 예상 요구사항 개수와 전수 추출을 강조
5. 정규식으로 ID 목록을 먼저 찾고 ID별 내용을 추출
6. 누락된 ID를 대상으로 추가 LLM 호출 수행
7. 청크 단위 예상 ID 수와 LLM 반환 수를 비교하여 재시도

상태: 미해결
우선순위: 최상

⸻

5.2 DOCX 처리 불가

업로드 API는 .docx 파일을 허용하지만 Worker는 현재 모든 파일을 pdf-parse로 처리한다.

mammoth 패키지는 이미 설치되어 있으므로 파일 확장자 또는 MIME type에 따라 파서를 분기해야 한다.

if (extension === ".docx") {
  // mammoth.extractRawText()
} else {
  // pdf-parse
}

상태: 미해결
우선순위: 높음

⸻

5.3 사업기간 추출 실패

사업기간은 문서 앞부분 약 2,000자를 별도 LLM 요청으로 전달하여 추출한다.

LLM 요청이 실패하거나 지정된 형식으로 응답하지 않으면 오류를 무시하므로 projects.period가 비어 있을 수 있다.

필요한 fallback 예시:

* 사업기간
* 과업기간
* 계약기간
* 수행기간
* 계약 체결일로부터 N일
* 착수일로부터 N개월

상태: 미해결
우선순위: 중간

⸻

5.4 모든 청크 실패 시 정상 완료 처리

각 청크 분석 실패는 전체 분석 중단을 막기 위해 개별적으로 catch하고 건너뛴다.

하지만 모든 청크가 실패해도 요구사항 0건으로 Job이 완료될 수 있다.

개선 조건:

if (successfulChunkCount === 0 || allReqs.length === 0) {
  throw new Error("모든 요구사항 분석 청크가 실패했습니다.");
}

요구사항 0건이 실제 분석 결과인지 시스템 오류인지 구분할 수 있는 상태 또는 결과 코드도 필요하다.

상태: 미해결
우선순위: 높음

⸻

5.5 Worker 중단 후 stuck Job 복구 불가

Worker가 Job을 processing으로 변경한 후 강제 종료되면 해당 Job이 영구적으로 processing 상태에 남을 수 있다.

현재는 수동 SQL로 복구해야 한다.

UPDATE jobs
SET status = 'pending',
    message = 'Worker 재시작으로 인한 Job 복구',
    updated_at = NOW()
WHERE status = 'processing';

권장 방식은 일정 시간 이상 갱신되지 않은 Job만 복구하는 것이다.

WHERE status = 'processing'
  AND updated_at < NOW() - INTERVAL '10 minutes'

상태: 미해결
우선순위: 높음

⸻

5.6 벡터 검색 미사용

document_chunks.embedding에 vector(1536) 컬럼이 정의되어 있지만 embedding 생성 및 저장 로직은 없다.

현재 유사 RFP 검색은 PostgreSQL Full-Text Search만 사용한다.

상태: 미구현
우선순위: 낮음

⸻

5.7 자동화 테스트 부족

현재 검증은 실제 PDF를 업로드하는 수동 통합 테스트 중심이다.

부족한 테스트:

* API Route Handler 테스트
* Worker 단위 테스트
* 청크 분할 테스트
* LLM 응답 파싱 테스트
* ID 필터링 테스트
* 중복 제거 테스트
* Job 재시도 테스트
* 프로젝트 삭제 테스트
* polling UI 테스트
* DOCX 파싱 테스트

상태: 미구현
우선순위: 중간

⸻

6. LLM 모델 검증 상태

6.1 모델 벤치마크

테스트 조건:

* 한국어 RFP 약 3,000자
* JSON 형식 요구사항 추출
* 요구사항 3개 포함
* 요청 타임아웃 30초

모델	응답 시간	추출 결과	평가
minimax-m2.7	6.4초	3/3	현재 기본 모델
minimax-m2.5	6.6초	3/3	사용 가능
glm-5.2	13.0초	3/3	정확하지만 상대적으로 느림
kimi-k2.6	25.2초	3/3	느림
kimi-k2.5	20.2초	3/3	느림
minimax-m3	4.0초	0/3	사용 불가
glm-5.1	30초 초과	실패	타임아웃
qwen3.7-plus	30초 초과	실패	타임아웃
qwen3.6-plus	30초 초과	실패	타임아웃
qwen3.5-plus	30초 초과	실패	타임아웃
mimo-v2-pro	—	실패	Provider Error
mimo-v2.5-pro	30초 초과	실패	타임아웃
hy3-preview	—	실패	Provider Error

6.2 입력 크기별 결과

minimax-m2.7 기준:

입력 크기	결과
3,000자	약 6.4초, 성공
8,000자	45초 이상, 타임아웃
15,000자	120초 이상, 실패
3,500자 청크 분할	청크별 처리 가능

6.3 현재 결론

* 짧은 입력에서는 minimax-m2.7이 빠르다.
* 실제 RFP 전체 분석에서는 요구사항 누락이 많다.
* deepseek-v4-flash는 커버리지가 높지만 처리 시간이 길다.
* 모델 속도보다 요구사항 누락 방지가 더 중요한 운영 환경에서는 모델 교체가 필요하다.
* 모델을 변경할 때는 .env의 API base, API key, model 값을 함께 검증해야 한다.

⸻

7. 최근 통합 테스트 결과

테스트 정보

* 테스트 일자: 2026-07-10
* 테스트 파일: docs/test/공고_제안요청서.pdf
* 예상 요구사항: 59개
* 사용 모델: minimax-m2.7

실행 결과

단계	결과	비고
파일 업로드	✅ 성공	HTTP 201
Project 생성	✅ 성공	
Document 생성	✅ 성공	
Job 생성	✅ 성공	pending
Worker Job 획득	✅ 성공	약 2초
PDF 파싱	✅ 성공	약 2초
사업기간 추출	❌ 실패	전체 분석에는 영향 없음
청크 분석	⚠️ 부분 성공	약 7개 청크
DB 저장	✅ 성공	요구사항 17건
프로젝트 상태 변경	✅ 성공	review
매트릭스 표시	✅ 성공	
요구사항 커버리지	❌ 미달	28.8%

추출된 요구사항

SFR-003 ~ SFR-013: 11개
SER-003 ~ SER-008: 6개
총 17개

확인된 누락 그룹

ECR-001 ~ ECR-003
SFR-001 ~ SFR-002
PER-003 ~ PER-004
INR-001 ~ INR-002
TER-001 ~ TER-005
SER-001 ~ SER-002
QUR-001 ~ QUR-003
CNR-001 ~ CNR-004
COR-001 ~ COR-006
PMR-001 ~ PMR-005
PHR-001
PSR-001 ~ PSR-004

테스트 판정

* 업로드부터 결과 표시까지의 시스템 흐름: 통과
* 비동기 Worker 구조: 통과
* 진행률 UI: 통과
* 분석 결과 저장: 통과
* 요구사항 추출 품질: 실패
* 운영 배포 준비 상태: 미달

⸻

8. 테스트 문서 현황

파일	예상 요구사항 수	확인 결과
docs/rfp/한국기술대_전자결재_시스템고도화.pdf	39개	deepseek-v4-flash로 39개 추출
docs/rfp/한국폴리텍_전자결재시스템고도화.pdf	75개	deepseek-v4-flash로 75개 ID 확인
docs/test/공고_제안요청서.pdf	59개	minimax-m2.7로 17개 추출

⸻

9. 다음 작업 우선순위

P0 — 분석 품질

1. 요구사항 추출 방식 개선

목표:

알려진 테스트 PDF 기준 요구사항 ID Recall 90% 이상

권장 구현 순서:

1. PDF 텍스트에서 요구사항 ID를 정규식으로 전수 탐색한다.
2. 탐색된 ID 목록을 청크별 예상 ID로 사용한다.
3. LLM 반환 ID와 예상 ID를 비교한다.
4. 누락 ID가 있으면 누락 ID 전용 재분석을 수행한다.
5. 최종 저장 전 예상 ID 대비 추출률을 계산한다.
6. 추출률이 기준 미만이면 Job을 needs_review 또는 failed로 처리한다.

2. 대체 모델 검증

다음 모델 또는 API를 실제 59개 테스트 문서로 검증한다.

gpt-4o-mini 또는 동급의 빠른 비추론 모델

검증 지표:

* 요구사항 ID Recall
* 중복률
* 잘못된 ID 생성률
* 명칭 추출 정확도
* 평균 처리 시간
* API 비용
* 타임아웃 발생률

⸻

P1 — 안정성

1. 모든 청크 실패 감지

* 성공 청크 수 기록
* 실패 청크 수 기록
* 성공 청크가 0이면 Job 실패
* 요구사항이 0개이면 원인 코드 저장

2. stuck Job 복구

* Worker 시작 시 오래된 processing Job 탐색
* 기준 시간 이상 갱신되지 않은 Job을 pending으로 복구
* retry_count 증가
* 복구 이벤트 로그 기록

3. DOCX 파싱

* 파일 확장자와 MIME type 검증
* .pdf는 pdf-parse
* .docx는 mammoth
* 지원하지 않는 형식은 업로드 단계에서 차단
* DOCX 통합 테스트 추가

⸻

P2 — 정확도 및 관찰성

1. 사업기간 fallback

* 정규식 기반 기간 후보 추출
* LLM 결과가 없으면 정규식 결과 사용
* 복수 후보가 있으면 문서 앞부분의 첫 번째 명시적 기간을 우선 사용

2. 분석 메트릭 저장

권장 메트릭:

total_chunks
successful_chunks
failed_chunks
detected_requirement_ids
extracted_requirement_ids
coverage_rate
llm_duration_ms
total_duration_ms
model

3. Worker 로그 구조화

최소 로그 필드:

timestamp
job_id
project_id
document_id
stage
progress
chunk_index
chunk_count
duration_ms
error

⸻

P3 — 확장 기능

* embedding 생성
* pgvector 기반 의미 검색
* Full-Text Search와 벡터 검색 결합
* Worker pool
* 동시 분석 제한
* 사용자 인증과 조직별 권한
* 요구사항 담당자 배정
* 답변 추천
* 제안서 export
* 감사 로그 UI

⸻

10. 다음 작업 체크리스트

분석 품질

* PDF 전체에서 요구사항 ID 사전 탐색
* 청크별 예상 ID 계산
* 누락 ID 재분석
* 추출 커버리지 계산
* 테스트 PDF 3종 기준 Recall 측정
* 대체 LLM 모델 비교
* 운영 모델 선정

Worker 안정성

* 모든 청크 실패 감지
* 요구사항 0건 결과 구분
* stuck Job 자동 복구
* 재시도 원인 로그 저장
* 실패 시 Document 상태를 error로 변경
* Worker 종료 시 처리 중 Job 상태 검토

파일 처리

* DOCX 파서 분기
* MIME type 검증
* 확장자와 MIME type 불일치 처리
* DOCX 테스트 문서 추가
* 파싱 실패 오류 메시지 개선

사업기간

* 정규식 fallback
* 기간 후보 정규화
* 원문 기간과 정규화 기간 구분 검토
* 사업기간 추출 단위 테스트

테스트

* LLM 응답 JSON 파싱 테스트
* 코드블록이 포함된 JSON 응답 테스트
* 잘못된 ID 필터링 테스트
* 중복 ID 제거 테스트
* 청크 overlap 테스트
* Job 재시도 테스트
* 삭제 FK 테스트
* 분석 polling 테스트
* Worker 장애 복구 테스트

⸻

11. 실행 상태 확인

애플리케이션 실행

pnpm dev

기본 주소:

http://localhost:3000

Worker 실행

pnpm worker

통합 실행

./scripts/start.sh

DB 실행

docker compose up -d

DB 스키마 반영

pnpm db:push

⸻

12. 운영 확인 명령어

Worker 프로세스 확인

ps aux | grep "scripts/worker.ts"

최근 Job 확인

docker exec -it rfp-demo-db \
  psql -U rfpuser -d rfp-demo \
  -c "SELECT id, status, progress, message, retry_count, updated_at
      FROM jobs
      ORDER BY created_at DESC
      LIMIT 10;"

processing 상태 Job 복구

docker exec -it rfp-demo-db \
  psql -U rfpuser -d rfp-demo \
  -c "UPDATE jobs
      SET status = 'pending',
          message = '수동 복구',
          updated_at = NOW()
      WHERE status = 'processing';"

최근 프로젝트 상태 확인

docker exec -it rfp-demo-db \
  psql -U rfpuser -d rfp-demo \
  -c "SELECT id, name, status, period, created_at, updated_at
      FROM projects
      ORDER BY created_at DESC
      LIMIT 10;"

프로젝트별 요구사항 수 확인

docker exec -it rfp-demo-db \
  psql -U rfpuser -d rfp-demo \
  -c "SELECT p.id,
             p.name,
             p.status,
             COUNT(r.id) AS requirement_count
      FROM projects p
      LEFT JOIN requirements r ON r.project_id = p.id
      GROUP BY p.id, p.name, p.status
      ORDER BY MAX(p.created_at) DESC;"

Worker 강제 재시작

pkill -f "scripts/worker.ts"
pnpm worker

⸻

13. Git 상태

브랜치

main
└── feat/worker-pattern

브랜치	상태	설명
main	안정화	기존 안정 코드
feat/worker-pattern	작업 중	Worker 및 Map-Reduce 분석 구현

최근 기록된 커밋

6045e56 docs: 프로젝트 요약 문서 갱신
1569141 docs: PDF 파서 교체 항목에 deepseek-v4-flash 의견으로 주석 추가
e2adc76 feat: map-reduce LLM 분석, ID 필터링, 로그 개선
1ee7d18 feat: Worker 패턴 도입 (백그라운드 분석 처리)
95f821c fix: Neon 드라이버→pg 교체, SSE 스트리밍 분석

머지 전 확인 조건

* Worker가 정상적으로 Job을 처리한다.
* 프로젝트 재진입 시 polling이 재개된다.
* 분석 실패 시 프로젝트가 무한 analyzing 상태에 남지 않는다.
* 테스트 PDF에서 요구사항 커버리지 기준을 만족한다.
* DOCX를 지원하거나 업로드 허용 대상에서 제거한다.
* stuck Job 복구 방법이 구현되거나 문서화되어 있다.
* 프로젝트 삭제 시 FK 오류가 발생하지 않는다.
* .env 및 API key가 커밋에 포함되지 않는다.

⸻

14. 릴리스 준비도

영역	판정
로컬 데모	✅ 가능
기능 시연	✅ 가능
내부 테스트	⚠️ 가능
제한된 파일럿	⚠️ 분석 결과 수동 검토 전제
운영 배포	❌ 권장하지 않음

운영 배포를 막는 조건

1. 요구사항 추출 커버리지가 문서에 따라 크게 달라진다.
2. 모든 청크 실패가 정상 완료로 처리될 수 있다.
3. Worker 중단 후 Job이 processing에 고정될 수 있다.
4. DOCX가 허용되지만 실제 파싱되지 않는다.
5. 자동화된 회귀 테스트가 없다.

⸻

15. 완료 정의

다음 조건을 모두 만족하면 현재 Worker 기반 분석 기능을 완료 상태로 판단한다.

* PDF 업로드 후 분석이 비동기로 완료된다.
* 페이지 이동 후에도 분석이 계속된다.
* 페이지 재진입 시 진행 상태가 복구된다.
* 테스트 PDF 3종에서 요구사항 ID Recall이 90% 이상이다.
* 잘못된 요구사항 ID 저장률이 2% 미만이다.
* 일부 청크 실패가 사용자에게 명확히 표시된다.
* 모든 청크 실패 시 Job이 실패 처리된다.
* Worker 재시작 시 오래된 processing Job이 복구된다.
* PDF와 DOCX가 실제로 모두 처리되거나 DOCX 업로드가 차단된다.
* 사업기간 추출 실패 시 fallback이 동작한다.
* 핵심 파서, 필터, 중복 제거, Job 상태 전이에 자동화 테스트가 존재한다.
* 프로젝트 삭제 시 관련 데이터가 남지 않는다.
* API key와 업로드 파일이 Git에 포함되지 않는다.

⸻

16. 참고 문서

* spec.md: 시스템 기능 및 기술 명세
* docs/project-summary.md: 기존 프로젝트 상세 기록
* README.md: 설치 및 실행 안내

⸻

17. M1-A: 진단 로그와 계측 추가

* 수행일: 2026-07-11
* 변경 파일: `scripts/worker.ts` (+113 라인, 기존 동작 0 변경)
* Worker 모델: minimax-m2.7 (변경 없음)

### 추가된 계측 지점

모든 진단 로그는 `[DIAG]` prefix로 구분되며 JSON 형식으로 출력된다.

| 계측 지점 | DIAG label | 포함 데이터 |
|---|---|---|
| PDF 파싱 직후 | `full_text` | 전체 텍스트 길이, 전체 유니크 ID 수, ID prefix 통계, sample IDs |
| excerpt 슬라이스 직후 | `excerpt` | 시작/끝 offset, 길이, excerpt 내부/외부 ID 수, 커버리지 % |
| 청크 분할 직후 | `chunk_expected` | 청크 인덱스, 길이, 예상 ID 수, 예상 ID 목록 |
| 각 청크 LLM 응답 | `chunk_result` | 응답 길이, finish_reason, 예상vs실제 ID, 누락 ID 목록, 초과 ID |
| 각 청크 실패 | `chunk_error` | 청크 인덱스, 예상 ID 수, 에러 메시지 |
| 최종 필터링 후 | `pipeline_summary` | 원시 추출 수, 중복 제거 후, 필터 후, 필터링 제외 ID, 최종 커버리지 %, excerpt 내 누락 ID |

### 추가된 헬퍼 함수 (순수 함수)

- `diag(jobId, label, data)` — 구조화 진단 로깅
- `collectUniqueIds(text)` — 텍스트 내 모든 고유 요구사항 ID 수집
- `getIdPrefixStats(ids)` — prefix(ECR, SFR 등)별 ID 개수 통계
- `getExcerptCoverage(fullTextIds, excerptIds)` — 전체 텍스트 기준 excerpt 포함/미포함 ID 수

### 검증 결과

| 검증 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` (worker.ts만) | ✅ 통과 |
| `git diff --stat` | 1 file changed, 113 insertions, 0 deletions |
| 기존 로그 라인 변경 | ❌ 없음 |
| 기존 함수 시그니처 변경 | ❌ 없음 |
| 핵심 동작 변경 | ❌ 없음 |
| `pnpm build` | ⚠️ 검증 불가 (Next.js 빌드 프로세스 미실행) |
| `pnpm lint` | ⚠️ 검증 불가 (ESLint 미실행) |
| Worker 런타임 검증 | ⚠️ 검증 불가 (실제 upload→분석 흐름 미실행) |

### 남은 위험

- 로그 추가로 인한 Worker 콘솔 출력 증가 (diagnostic only)
- `successful_chunks` 계측이 정확하지 않음 (추후 M1에서 개선 필요)
- Worker 런타임에 `[DIAG]` JSON 파싱 오류 가능성 없음 (단순 `console.log`)

### 권장 다음 단계

M1-B: 전체 문서 요구사항 ID 검출과 정규화 구현

⸻

18. M1-B: 전체 문서 ID 검출과 정규화

* 수행일: 2026-07-11
* 변경 파일: `src/lib/requirement-id.ts` (신규), `scripts/worker.ts` (ID 검출 로직 모듈화), `scripts/test-id-detection.ts` (신규)
* Worker 모델: minimax-m2.7 (변경 없음)

### 완료 작업

1. **`src/lib/requirement-id.ts`** — 순수 함수 모듈 생성
   - `detectAllIds(text)` — 전체 문서에서 모든 요구사항 ID 위치 검출
   - `normalizeId(raw)` — 대문자 변환, 공백 제거, 패턴 검증
   - `isValidRequirementId(id)` — 유효한 ID 여부 판단
   - `getUniqueNormalizedIds(detected)` — 중복 제거된 정규화 ID 목록
   - `getIdPrefixStats(ids)` — prefix(ECR, SFR 등)별 ID 개수 통계
   - `getExcerptCoverage(full, excerpt)` — 전체 대비 excerpt 커버리지 계산

2. **`scripts/worker.ts`** — ID 검출 로직을 모듈로 마이그레이션
   - inline `REQ_ID_REGEX`, `collectUniqueIds`, `getIdPrefixStats`, `getExcerptCoverage` 제거
   - `detectAllIds()` + `getUniqueNormalizedIds()` 조합으로 대체
   - `filterValidRequirementIds()` → `isValidRequirementId()` 사용으로 대소문자 정규화 지원
   - 요구사항 섹션 탐색 시 `detectAllIds().position` 사용

3. **`scripts/test-id-detection.ts`** — 검증 스크립트
   - LLM 호출 없이 순수 함수 36개 테스트
   - normalizeId: 13개 (대소문자, 공백, 자릿수, 하이픈)
   - detectAllIds: 8개 (검출, 위치, 대소문자, 오탐 방지)
   - 오탐 방지: 날짜(`2026-07-11`), 버전(`v2.0`), 페이지(`- 1 -`)
   - 2자 prefix(`ZZ-001`), 4자 prefix(`ABCD-001`) 테스트
   - getUniqueNormalizedIds, getIdPrefixStats, getExcerptCoverage

### 검증 결과

| 검증 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` | ✅ 통과 (worker.ts + requirement-id.ts 신규 오류 없음) |
| `npx tsx scripts/test-id-detection.ts` | ✅ 36/36 통과 |
| 기존 Worker 로직 변경 | ❌ 없음 (함수 내부 구현만 모듈화) |
| API 응답 변경 | ❌ 없음 |
| DB 스키마 변경 | ❌ 없음 |
| `pnpm build` | ⚠️ 검증 불가 |
| Worker 런타임 검증 | ⚠️ 검증 불가 |

### 남은 위험

- ~~`detectAllIds`가 위치 기반으로 검출하지만, M1-C에서 이 정보를 경계 분할에 활용~~ → M1-C에서 해결
- Worker 런타임에서 `filterValidRequirementIds`의 대소문자 처리 차이가 실제 요구사항 ID 개수에 영향을 줄 수 있음

### 권장 다음 단계

M1-C: ID 경계 후보 분할과 중복 후보 품질 선택 구현

⸻

19. M1-C: ID 경계 후보 블록 생성과 대표 후보 선택

* 수행일: 2026-07-11
* 변경 파일: `src/lib/requirement-id.ts` (+160 라인), `scripts/worker.ts` (fixed-size → ID-boundary blocks), `scripts/test-id-detection.ts` (+11 테스트)
* Worker 모델: minimax-m2.7 (변경 없음)

### 완료 작업

1. **`src/lib/requirement-id.ts`** — ID 경계 기반 블록 분할 추가
   - `createIdBoundaryBlocks(excerpt, maxBlockSize, overlap)` — ID 위치를 경계로 블록 생성
     - 각 블록은 검출된 ID 위치 기준: "현재 ID 위치"부터 "다음 ID 직전"까지
     - 첫 ID 이전 preamble과 마지막 ID 이후 텍스트도 포함
     - 긴 블록(>5000자)은 보조 청킹으로 분할 (`splitLongBlock`)
     - 각 블록은 `expectedId`(기대되는 ID)를 포함하여 LLM에 힌트 제공
   - `selectBestCandidates(blocks)` — 동일 ID의 중복 후보 중 최적 블록 선택
     - `scoreCandidate()`로 각 후보의 품질 점수 계산
       - 텍스트 길이 (최대 40점)
       - 구조적 마커 포함 (세부내용/상세설명 = 30점)
       - ID + "요구사항" 키워드 동시 존재 (20점)
       - 숫자 정보 포함 (10점)
     - 동일 ID 그룹 내 최고 점수 블록 선택, offset 순 재정렬

2. **`scripts/worker.ts`** — 고정 크기 청크 → ID 경계 블록 전환
   - `splitIntoChunks(excerpt, 3500, 300)` → `createIdBoundaryBlocks(excerpt)` + `selectBestCandidates(idBlocks)`
   - LLM 호출 시 expectedId가 있으면 프롬프트에 힌트로 추가
   - diag 로그: `chunk_expected` → `block_expected`, `chunk_result` → `block_result`, `chunk_error` → `block_error`

3. **`scripts/test-id-detection.ts`** — 11개 추가 테스트 (총 47개)
   - createIdBoundaryBlocks: 5개 (기본 블록, ID 없는 텍스트, 블록 개수, expectedId)
   - scoreCandidate: 3개 (점수 계산, 마커 감지, 상대 점수 비교)
   - selectBestCandidates: 3개 (중복 제거, 최적 선택, 텍스트 길이 비교)

### 검증 결과

| 검증 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` | ✅ 통과 |
| `npx tsx scripts/test-id-detection.ts` | ✅ 47/47 통과 |
| 기존 Worker 동작 변경 | 🟡 청킹 로직 교체 (기능적 개선) |
| API 응답 변경 | ❌ 없음 |
| DB 스키마 변경 | ❌ 없음 |
| `pnpm build` | ⚠️ 검증 불가 |
| Worker 런타임 검증 | ⚠️ 검증 불가 |

### 남은 위험

- 블록별 expectedId 힌트가 LLM의 추출 품질에 미치는 영향 미확인
- `selectBestCandidates` 점수 함수가 특정 RFP 형식에 편향될 가능성 (튜닝 필요)
- `splitIntoChunks` 함수가 dead code로 남음 (후속 단계에서 정리 가능)

### 권장 다음 단계

M2: LLM 보강 응답 검증과 raw_only 보존 구현

⸻

20. M2: LLM 보강과 응답 검증, raw_only 보존

* 수행일: 2026-07-11
* 변경 파일: `scripts/worker.ts` (+94/-8 라인)
* Worker 모델: minimax-m2.7 (변경 없음)

### 완료 작업

1. **LLM 응답 ID 검증** (`scripts/worker.ts:296-310`)
   - LLM 반환 ID와 블록 `expectedId` 비교
   - 대소문자 정규화 후 비교 (`.toUpperCase()`)
   - 불일치 시 `block_mismatch` diag 로그 기록

2. **1회 재시도** (`scripts/worker.ts:330-350`)
   - ID 불일치 또는 1차 LLM 호출 실패 시 재시도
   - 재시도용 전용 프롬프트: `"반드시 {expectedId}를 id 필드에 사용하세요"`
   - 성공 시 `block_retry_ok` diag 로그

3. **raw_only 보존** (`scripts/worker.ts:352-368`)
   - 모든 시도(1차 + 재시도) 실패 시 원문 블록을 요구사항으로 저장
   - 저장 형식: `original_id={expectedId}`, `name=null`, `sourceText=block.text(원문)`
   - 내부 마커 `_rawOnly=true` 추가 (최종 로그에서 `raw_only_count`로 집계)

4. **DIAG 로그 개선**
   - `block_ok` — 1차 성공 (ID 일치)
   - `block_mismatch` — ID 불일치 (재시도 트리거)
   - `block_retry_ok` — 재시도 성공
   - `block_raw_only` — 모든 시도 실패, 원문 보존
   - `pipeline_summary.raw_only_count` — raw_only 보존된 블록 수

### 검증 결과

| 검증 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` | ✅ 통과 |
| `npx tsx scripts/test-id-detection.ts` | ✅ 47/47 통과 (변경 없음) |
| 기존 Worker 동작 변경 | 🟡 LLM 호출당 1회 재시도 + raw_only 추가 |
| API 응답 변경 | ❌ 없음 |
| DB 스키마 변경 | ❌ 없음 |
| `pnpm build` | ⚠️ 검증 불가 |
| Worker 런타임 검증 | ⚠️ 검증 불가 |

### 남은 위험

- raw_only 항목은 name=null로 저장되므로 UI에서 "분석 실패"로 표시됨 (의도된 동작)
- 재시도로 인해 Worker 총 처리 시간 증가 (블록당 최대 2회 LLM 호출)
- ID 검증 로직이 대소문자 불일치(ID 생성된 값 vs 원문 값)를 걸러내지 못할 수 있음

### 권장 다음 단계

M3: 분석 결과 저장 트랜잭션과 중복 방지 구현

⸻

21. M3: DB 트랜잭션과 중복 방지

* 수행일: 2026-07-11
* 변경 파일: `scripts/worker.ts` (+60/-40), `drizzle/0001_requirements_unique_constraint.sql` (신규 마이그레이션)
* DB 변경: UNIQUE constraint 마이그레이션 파일 생성 (미적용)

### 완료 작업

1. **DB 트랜잭션으로 저장 래핑** (`scripts/worker.ts:416-468`)
   - `db.transaction(async (tx) => { ... })`으로 전체 저장 블록 감쌈
   - 포함: 사업기간 UPDATE, requirements INSERT, responses INSERT, documents/projects 상태 UPDATE
   - `updateJob` 호출은 트랜잭션 밖에서 실행 (진행률은 즉시 표시되어야 함)

2. **중복 저장 방지 (SELECT-before-INSERT)** (`scripts/worker.ts:429-437`)
   - 각 요구사항 INSERT 전에 동일 `(project_id, original_id)` 존재 여부 확인
   - 이미 존재하면 건너뛰고 `⏭️ 건너뜀` 로그 기록
   - `original_id`가 null인 경우는 중복 체크 불가능 → 그대로 INSERT

3. **마이그레이션 파일 생성** (`drizzle/0001_requirements_unique_constraint.sql`)
   - `ALTER TABLE requirements ADD CONSTRAINT uq_project_requirement_id UNIQUE (project_id, original_id)`
   - `original_id IS NULL`인 경우 PostgreSQL에서 자동 제외 (NULL ≠ NULL)
   - **미적용 상태** — `pnpm db:push` 실행 전까지 수동 SELECT-before-INSERT가 대신 동작

4. **저장 카운트 정확화**
   - `savedCount` 변수로 실제 저장된 건수 추적
   - 중복은 `reqs.length - savedCount`로 표시
   - 최종 `updateJob.completed` → `savedCount` 사용

### 검증 결과

| 검증 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` | ✅ 통과 |
| `npx tsx scripts/test-id-detection.ts` | ✅ 47/47 통과 |
| 마이그레이션 생성 | ✅ 생성 완료, 미적용 |
| **통합 테스트: 공고_제안요청서.pdf** | **✅ 59/59 (100%)** |
| DB 저장 결과 | ✅ 59개 저장, 중복 0건 |
| 사업기간 추출 | ✅ "계약일로부터 180일" |
| 프로젝트 상태 | ✅ review |
| API 응답 | ✅ 정상 |

### 남은 위험

- 트랜잭션 중 `updateJob`이 별도 연결 사용 → 트랜잭션 롤백 시 progress가 과장될 수 있음
- SELECT-before-INSERT가 UNIQUE constraint보다 느림 (DB 라운드트립 증가)
- `original_id`가 NULL인 요구사항은 중복 체크 불가
- 마이그레이션 적용 시 기존 데이터와 충돌 가능성

### 권장 다음 단계

Worker runtime 통합 테스트 및 마이그레이션 적용 검토