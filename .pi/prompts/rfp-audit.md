---
description: RFP Demo 저장소를 수정하지 않고 진단하고 개선 계획을 작성
---

`AGENTS.md`와 다음 문서를 먼저 읽으십시오.

- `docs/agent/rfp-pipeline-spec.md`
- `docs/agent/STATUS.md`
- `docs/project-summary.md`가 존재하면 해당 문서

이번 세션의 범위는 **M0 읽기 전용 진단**입니다.

코드, 설정, 스키마, 마이그레이션, 문서 또는 Git 상태를 수정하지 마십시오.

다음 행위를 하지 마십시오.

- 파일 생성, 수정 또는 삭제
- 패키지 설치
- 마이그레이션 생성 또는 적용
- 데이터베이스 데이터 변경
- `git commit`, `git push`, `git reset`, `git clean`, `git rebase`
- 실제 API 키, 토큰, 비밀번호, DATABASE_URL 출력
- 테스트하지 않은 사항을 완료로 보고
- 존재하지 않는 파일이나 구현을 존재한다고 가정

## 진단 목표

현재 요구사항 추출 누락의 원인이 다음 중 무엇인지 실제 코드를 근거로 확인하십시오.

1. 전체 문서가 LLM 입력에 전달되지 않음
2. 약 20,000자 슬라이스로 뒤쪽 요구사항이 제외됨
3. 고정 문자 수 청킹으로 요구사항 경계가 잘림
4. 동일 ID의 총괄표와 상세표 중 잘못된 후보가 선택됨
5. LLM 응답에서 일부 ID가 누락됨
6. LLM 실패 시 이미 찾은 요구사항 원문도 폐기됨
7. 재시도 시 requirements가 중복 저장됨
8. Worker 복구 로직이 정상 processing job까지 되돌림
9. 업로드 지원 형식과 Worker 파서 지원 형식이 다름
10. document_chunks가 실제 업로드·분석 흐름에서 생성되지 않음

## 조사 순서

### 1. 저장소 상태 확인

다음을 확인하십시오.

- 현재 브랜치
- working tree의 변경 파일
- 추적되지 않은 파일
- 최근 변경과 현재 작업 범위의 충돌 가능성

사용자가 작성한 변경을 되돌리거나 수정하지 마십시오.

### 2. 실제 파일 구조 확인

명세에 적힌 다음 파일들이 실제로 존재하는지 확인하십시오.

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

파일이 없으면 대체 구현이 어디에 있는지 검색하십시오.

### 3. package.json 확인

다음을 확인하십시오.

- 실제 scripts
- Next.js, TypeScript, Drizzle 버전
- PDF 및 DOCX 파서 의존성
- 테스트 도구
- runtime validator
- LLM 클라이언트
- Worker 실행 명령

존재하지 않는 script를 실행하거나 존재한다고 보고하지 마십시오.

### 4. Worker 처리 흐름 추적

업로드부터 분석 완료까지 호출 흐름을 실제 파일 경로와 함수 이름으로 정리하십시오.

예상 흐름을 그대로 믿지 말고 실제 구현을 기준으로 작성하십시오.

다음을 추적하십시오.

```text
업로드
→ document/project 생성
→ job 생성
→ Worker claim
→ 파일 로드
→ 문서 파싱
→ 청킹 또는 후보 추출
→ LLM 호출
→ 응답 검증
→ requirements/responses 저장
→ 상태 및 progress 갱신
````

각 단계에 대해 다음을 기록하십시오.

- 구현 파일
- 함수명
- 입력과 출력
- 실패 처리
- 트랜잭션 여부

### **5. 문서 입력 범위 확인**

다음과 유사한 코드가 있는지 전체 저장소에서 검색하십시오.

```ts
text.slice(...)
substring(...)
substr(...)
20000
20_000
3500
3_500
```

특히 다음 항목을 확인하십시오.

- 전체 파싱 텍스트 길이를 어디서 알 수 있는지
- 분석 시작 offset
- 분석 종료 offset
- LLM에 실제 전달되는 텍스트 길이
- 전체 문서가 아닌 일부 excerpt만 전달되는지
- 문서 뒤쪽 요구사항이 입력에서 제외될 가능성

약 20,000자 제한이 존재한다면 정확한 파일, 함수, 코드 위치를 보고하십시오.

### **6. 요구사항 발견과 청킹 방식 확인**

다음을 확인하십시오.

- ID를 정규식으로 먼저 찾는지
- LLM에 ID 발견 자체를 맡기는지
- 청크 크기와 overlap
- 서로 다른 요구사항이 하나의 청크에 섞이는지
- 하나의 요구사항이 여러 청크로 분리되는지
- ID 정규화가 있는지
- 알려진 prefix만 허용하는지
- 중복 ID 후보를 어떻게 처리하는지
- `deduplicateById()` 또는 유사 로직이 첫 번째 결과만 남기는지

### **7. LLM 호출과 응답 검증 확인**

다음을 확인하십시오.

- 호출당 후보 수
- 입력 ID와 출력 ID를 비교하는지
- JSON 파싱 실패 처리
- runtime schema validator 사용 여부
- 누락 ID만 재시도하는지
- 알 수 없는 ID 생성 여부를 검사하는지
- timeout과 provider error를 구분하는지
- 입력 길이, 출력 길이, latency를 기록하는지
- 응답이 잘렸을 때 전체 문서를 재호출하는지

### **8. 원문 보존 확인**

LLM 호출 실패 또는 응답 검증 실패 시 다음 데이터가 보존되는지 확인하십시오.

- original ID
- raw source text
- start/end offset
- page 또는 paragraph 위치
- extraction status
- needs review 상태

LLM이 반환한 텍스트가 실제 파서 원문을 덮어쓰는지도 확인하십시오.

### **9. DB 스키마와 저장 안정성 확인**

실제 schema와 migration을 기준으로 다음을 확인하십시오.

- `project_id + original_id` unique constraint
- upsert 또는 replace 전략
- requirements와 responses의 transaction 여부
- 중간 실패 시 rollback 여부
- 재분석 시 기존 결과 처리 방식
- project 삭제 시 FK 및 cascade 동작
- `jobs.progress` 범위 제약
- JSON 값이 json/jsonb인지 text인지
- `updated_at` 자동 갱신 여부
- timestamp와 timestamptz 사용
- 존재하지 않는 users 테이블을 참조하는 FK 여부

DB에 연결할 수 없으면 schema와 migration 정적 분석 결과만 보고하고, 실행 검증은 `검증 불가`로 표시하십시오.

### **10. Worker Job 복구 확인**

다음을 확인하십시오.

- Worker 시작 시 모든 `processing` job을 `pending`으로 변경하는지
- stale 여부를 판단하는지
- `updated_at`, `locked_at`, `lease_expires_at`, `heartbeat_at` 사용 여부
- 여러 Worker가 같은 job을 처리할 가능성
- attempt count 또는 retry 제한
- `FOR UPDATE SKIP LOCKED`의 실제 사용 위치와 transaction 범위

### **11. 파서 지원 형식 확인**

업로드 API와 Worker를 비교하십시오.

- 업로드가 허용하는 MIME type과 확장자
- Worker가 실제 파싱할 수 있는 형식
- PDF parser
- DOCX parser
- 페이지 정보 보존 여부
- 파서 오류 처리

업로드는 DOCX를 허용하지만 Worker는 PDF만 지원하는지 명확히 판단하십시오.

### **12. document_chunks 및 검색 흐름 확인**

다음을 확인하십시오.

- document_chunks 생성 코드
- 업로드 또는 분석 시 실제 호출 여부
- 같은 문서 재분석 시 중복 생성 여부
- 페이지 또는 section 정보 저장 여부
- FTS 인덱스
- pgvector 컬럼
- embedding 생성 코드
- similar API가 실제 업로드 문서를 검색할 수 있는지

### **13. 비밀정보 위험 확인**

다음을 검사하십시오.

- `.env`가 Git에서 제외되는지
- `.env.example`에 실제 값이 없는지
- 소스 및 문서의 API 키 하드코딩
- 로그의 Authorization header 또는 API 키 출력
- Git 추적 파일의 DATABASE_URL
- 샘플 문서에 실제 키가 포함되어 있는지

실제 비밀 값은 절대 출력하지 마십시오.

다음 형태로만 보고하십시오.

```text
파일: 경로
위치: 줄 번호 또는 섹션
종류: API key / database credential / token 등
값: [REDACTED]
조치: 권장 대응
```

Git 히스토리를 변경하거나 비밀정보를 직접 제거하지 마십시오.

## **실행 명령 제한**

읽기 전용 명령만 사용하십시오.

허용 예시:

```bash
git status
git branch --show-current
git diff
git log
find
rg
grep
cat
sed
git check-ignore
```

이번 세션에서는 build, lint, test, dev server, Worker 또는 DB migration을 실행하지 마십시오.

## **최종 보고 형식**

### **1. 저장소 상태**

### **2. 실제 아키텍처와 호출 흐름**

### **3. 확인된 핵심 원인**

각 원인에 다음을 포함하십시오.

- 증거
- 파일 경로
- 함수 또는 코드 위치
- 영향
- 신뢰도: 확인 / 가능성 높음 / 추가 검증 필요

### **4. 명세와 실제 구현의 차이**

### **5. 보안 위험**

실제 비밀 값은 모두 `[REDACTED]` 처리하십시오.

### **6. DB 및 재시도 위험**

### **7. 기존 기능에 대한 위험**

### **8. 검증 가능한 항목**

### **9. 현재 검증 불가 항목**

부족한 테스트 문서, DB, 환경 또는 설정을 명시하십시오.

### **10. 권장 최소 변경 순서**

각 변경에 다음을 표시하십시오.

- 우선순위
- 예상 수정 파일
- 선행조건
- 위험도
- 완료 조건

### **11. 첫 번째 구현 단계 제안**

다음 세션에서 수행할 하나의 작은 단계만 제안하십시오.

이번 세션에서는 어떤 파일도 수정하지 말고 진단 보고 후 중단하십시오.

````
실행:
/rfp-audit
````