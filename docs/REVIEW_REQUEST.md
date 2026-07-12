# RFP Demo — 외부 LLM 검토 요청서

> 이 문서 하나만으로 프로젝트 전체를 이해하고 검토할 수 있도록 작성되었습니다.

---

## 이 서비스가 하는 일

사용자가 **RFP(제안요청서) PDF 파일**을 업로드하면, AI가 문서를 분석해서 숨겨진 **요구사항들을 자동으로 추출**해 테이블로 보여줍니다.

```
[PDF 업로드] → [AI 분석] → [요구사항 59개 추출]
                              ├── ECR-001 시스템 공통 요구사항
                              ├── SFR-001 하이브리드 웹한글 기안기
                              └── ...
```

---

## 기술 구조

```
Next.js (프론트 + API)  ←→  PostgreSQL (Docker)
                              ↑
Worker (독립 프로세스)  ←─ DB polling ─┘
  ├── pdf-parse (PDF→텍스트)
  └── LLM 호출 (59회, OpenCode 게이트웨이 경유)
```

- **프론트**: Next.js 16 + React 19 + Tailwind CSS
- **DB**: PostgreSQL 16 + pgvector (Docker)
- **Worker**: `tsx`로 실행되는 별도 프로세스 (2초 polling)
- **PDF 파싱**: pdf-parse (JavaScript 라이브러리)
- **LLM**: OpenCode 게이트웨이 → 현재 `minimax-m2.7` 사용

---

## 분석 파이프라인 (상세 흐름)

```
Step 1: PDF → 텍스트
  pdf-parse로 76,705자 텍스트 추출 (2초)

Step 2: ID 검출
  정규식 /[A-Z]{2,4}-\d{3}/g 로 전체 문서 스캔
  → 59개 요구사항 ID 발견 (ECR-001, ECR-002, ... SER-008)

Step 3: ID 경계 블록 분할
  각 ID 위치를 기준으로 문서를 블록으로 나눔
  → 59개 블록 (각 300~2000자, 하나의 요구사항에 대응)

Step 4: LLM 호출 (병목)
  각 블록마다 LLM에 "이 ID의 name, sourceText, type, priority 추출해줘" 요청
  → 59회 네트워크 왕복
  → kimi-k2.6: 호출당 17초 → 총 17분

Step 5: 응답 검증 + 저장
  LLM 응답 ID 검증 → 불일치 시 1회 재시도 → DB 트랜잭션 저장
```

---

## 현재 문제

### 🔴 속도 (핵심 이슈)

**59회 LLM 호출 × 호출당 17초 = 총 17분** 소요됩니다.

| 원인 | 상세 |
|------|------|
| 호출 횟수 | 59개 ID 각각 1회씩 호출 (100% coverage 위해) |
| 모델 속도 | `kimi-k2.6`: 17초/호출 (`minimax-m2.7`: 사용 불가) |
| 네트워크 | OpenCode 게이트웨이의 처리 지연 |

`gpt-4o-mini` 키만 있으면 `.env` 한 줄 변경으로 2분으로 단축 가능하지만, **현재 OpenCode 구독만 보유**한 상태입니다.

### 🟡 모델 불안정

OpenCode의 `minimax-m2.7`이 2026-07-11 기준 **0건 추출**로 작동 중단되었습니다. 현재 유일하게 동작하는 모델은 `kimi-k2.6`입니다.

---

## 검토 요청: 속도 최적화 전략 평가

현재 4가지 전략을 검토 중입니다. 각 전략의 실현 가능성과 우선순위를 평가해주세요.

### 전략 A: 그룹 호출 (단순)

5개 ID씩 묶어서 한 번의 LLM 호출로 처리

```
변경:  59회 (ID당 1회)  →  12회 (5개씩 그룹)
효과:  17분 → 3.5분
손실:  coverage 100% → 80~90% (LLM이 일부 누락 가능)
```

### 전략 B: LLM + Regex 분리 (추천 검토 대상)

LLM은 짧은 필드(name, type, priority)만 추출하고, `sourceText`는 문서에서 직접 정규식 추출

```
변경:  59회 (전체 필드)  →  4~6회 (짧은 필드만) + Regex 59회 (순수 계산)
효과:  17분 → 1.5분
손실:  sourceText 추출 정확도 (RFP 형식 의존)
```

### 전략 C: 병렬 호출

블록 5개씩 `Promise.all()`로 동시에 LLM 호출

```
변경:  59회 순차  →  59회 (5개씩 병렬)
효과:  17분 → 3.5분
손실:  없음 (100% coverage 유지)
위험:  API rate limit
```

### 전략 D: B + C 결합

그룹 호출 + 병렬 처리

```
효과: ~1분
손실: 85~95% coverage
```

---

## 추가 검토 요청

1. **OpenCode 모델 중 kimi-k2.6 외에 시도해볼 만한 모델**이 있을까요? (glm-5.2는 timeout, deepseek-v4-flash는 reasoning 과다)

2. **LLM 호출 횟수를 줄이면서 coverage를 유지하는 방법**에 대한 의견이 있으신가요?

3. **벡터 임베딩(bge-m3)** 서버가 준비되었습니다. Worker 코드에 연결 코드도 작성해두었습니다. 임베딩을 지금 활성화하는 게 좋을까요, 아니면 LLM 속도 문제를 먼저 해결하는 게 좋을까요?

---

## 핵심 메트릭

| 지표 | 값 |
|------|---|
| 테스트 PDF | 공고_제안요청서.pdf (76,705자) |
| 전체 요구사항 ID | 59개 |
| 추출 coverage | 100% |
| 단위 테스트 | 22개 (vitest) |
| 총 코드베이스 | ~15개 파일, ~2500라인 |
| Worker 처리 시간 | ~17분 |
| 워크플로우 단계 | M0-M3 + P1-P3 완료 |

---

## 기술 스택 요약

```
런타임:   Node.js 24 + TypeScript 7
웹:       Next.js 16 + React 19
DB:       PostgreSQL 16 + pgvector
PDF:      pdf-parse (JS)
DOCX:     mammoth (JS)
LLM:      OpenAI SDK v6 → OpenCode 게이트웨이
Worker:   tsx (TypeScript 실행)
테스트:   vitest (22 tests)
패키지:   pnpm
```
