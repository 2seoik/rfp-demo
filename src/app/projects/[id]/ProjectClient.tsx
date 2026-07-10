"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

type Requirement = {
  id: string;
  original_id: string | null;
  source_text: string;
  type: string;
  priority: string;
  status: string;
  order: number;
  draft_text: string | null;
  final_text: string | null;
  confidence_label: string | null;
  citations: any[];
};

type SimilarDoc = {
  docId: string;
  docName: string;
  avgScore: number;
  matchCount: number;
  chunks: { content: string; page: number | null; score: number }[];
};

type Props = {
  data: {
    project: any;
    requirements: Requirement[];
    documents: any[];
  };
  autoAnalyze?: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  qualification: "자격요건", security: "보안", operation: "운영",
  technical: "기술", format: "제출형식", general: "일반",
};

const PRIORITY_BADGES: Record<string, { label: string; class: string }> = {
  essential: { label: "필수", class: "bg-red-100 text-red-700" },
  recommended: { label: "권고", class: "bg-yellow-100 text-yellow-700" },
  optional: { label: "선택", class: "bg-gray-100 text-gray-600" },
};

const CONFIDENCE_BADGES: Record<string, { label: string; class: string }> = {
  sufficient: { label: "✅ 근거충분", class: "bg-green-100 text-green-700" },
  partial: { label: "⚠️ 부분근거", class: "bg-yellow-100 text-yellow-700" },
  needs_review: { label: "🔍 확인필요", class: "bg-orange-100 text-orange-700" },
  insufficient: { label: "❌ 근거없음", class: "bg-red-100 text-red-700" },
};

export default function ProjectClient({ data, autoAnalyze }: Props) {
  const router = useRouter();
  const { project, requirements } = data;
  const [activeTab, setActiveTab] = useState<"matrix" | "similar">("matrix");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedReq, setSelectedReq] = useState<string | null>(
    requirements.length > 0 ? requirements[0].id : null
  );

  // Analysis progress state
  const [analyzing, setAnalyzing] = useState(autoAnalyze && project.status === "analyzing");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [analyzeError, setAnalyzeError] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

  // Similar RFP state
  const [similarDocs, setSimilarDocs] = useState<SimilarDoc[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarSearched, setSimilarSearched] = useState(false);
  const [similarError, setSimilarError] = useState("");

  const selected = requirements.find((r) => r.id === selectedReq);

  // ── SSE 분석 스트리밍 ─────────────────────────────────
  useEffect(() => {
    if (!analyzing) return;

    const es = new EventSource(`/api/projects/${project.id}/analyze`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.progress != null) setProgress(data.progress);
        if (data.message) setProgressMessage(data.message);

        if (data.step === "done") {
          setProgressMessage(data.message || "✅ 분석 완료!");
          setAnalyzing(false);
          es.close();
          // 잠시 후 페이지 새로고침하여 결과 표시
          setTimeout(() => router.refresh(), 1500);
        }

        if (data.step === "error") {
          setAnalyzeError(data.message);
          setAnalyzing(false);
          es.close();
        }
      } catch {}
    };

    es.onerror = () => {
      setAnalyzeError("분석 연결이 끊어졌습니다. 페이지를 새로고침 해보세요.");
      setAnalyzing(false);
      es.close();
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [analyzing, project.id, router]);

  // Load similar RFPs once when tab is activated
  useEffect(() => {
    if (activeTab === "similar" && !similarSearched && !similarLoading) {
      setSimilarLoading(true);
      setSimilarError("");

      fetch(`/api/projects/${project.id}/similar`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          setSimilarDocs(data.similar ?? []);
          setSimilarSearched(true);
        })
        .catch((err) => {
          setSimilarError(err.message);
          setSimilarSearched(true);
        })
        .finally(() => setSimilarLoading(false));
    }
  }, [activeTab, project.id, similarSearched, similarLoading]);

  const handleRetry = () => {
    setSimilarSearched(false);
    setSimilarError("");
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (res.ok) router.push("/dashboard");
    } catch {}
  };

  const handleCancelAnalysis = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setAnalyzing(false);
    // 대시보드로 이동
    router.push("/dashboard");
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {analyzing
              ? "RFP 분석 중..."
              : `RFP 분석 결과 · 요구사항 ${requirements.length}개 추출`}
          </p>
        </div>
        {!analyzing && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition"
          >
            🗑️ 삭제
          </button>
        )}
      </div>

      {/* ── 분석 진행 오버레이 ─────────────────────────── */}
      {analyzing && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <h3 className="font-semibold text-blue-800">AI 분석 진행 중</h3>
            </div>
            <button
              onClick={handleCancelAnalysis}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              취소하고 대시보드로
            </button>
          </div>

          {/* 프로그레스 바 */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-700">{progressMessage}</span>
              <span className="font-mono text-blue-600">{progress}%</span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-blue-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* 단계별 상태 */}
          <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
            {[
              { step: "start", label: "준비", icon: "📋" },
              { step: "parsing", label: "PDF 파싱", icon: "📄" },
              { step: "extracting", label: "요구사항 추출", icon: "🤖" },
              { step: "done", label: "완료", icon: "✅" },
            ].map((s, i) => {
              const stepOrder = ["start", "parsing", "extracting", "done"];
              const currentIdx = stepOrder.indexOf(s.step);
              const progressIdx = progress >= 100 ? 3 : progress >= 45 ? 2 : progress >= 10 ? 1 : 0;
              const active = currentIdx <= progressIdx;
              return (
                <div
                  key={s.step}
                  className={`rounded-lg p-2 ${
                    active ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-400"
                  }`}
                >
                  <div className="text-lg">{s.icon}</div>
                  <div className="mt-0.5 font-medium">{s.label}</div>
                </div>
              );
            })}
          </div>

          {/* 추가 정보 */}
          <p className="mt-3 text-xs text-blue-500">
            분석 중에도 다른 페이지를 자유롭게 이동할 수 있습니다.
          </p>
        </div>
      )}

      {/* ── 분석 에러 ──────────────────────────────────── */}
      {analyzeError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">❌ {analyzeError}</p>
          <button
            onClick={() => router.push("/projects/new")}
            className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="rounded-xl bg-white p-6 shadow-xl max-w-sm">
            <h3 className="text-lg font-semibold text-gray-900">프로젝트 삭제</h3>
            <p className="mt-2 text-sm text-gray-600">
              &ldquo;{project.name}&rdquo; 프로젝트를 삭제하시겠습니까? 관련된 모든 요구사항과 문서가 함께 삭제됩니다.
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs (분석 중에는 숨김) */}
      {!analyzing && (
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex gap-6">
            <button onClick={() => setActiveTab("matrix")}
              className={`pb-3 text-sm font-medium transition ${activeTab === "matrix" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}>
              요구사항 매트릭스
            </button>
            <button onClick={() => { setActiveTab("similar"); }}
              className={`pb-3 text-sm font-medium transition ${activeTab === "similar" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}>
              🔍 유사 RFP 검색
            </button>
          </nav>
        </div>
      )}

      {/* Matrix Tab */}
      {!analyzing && activeTab === "matrix" && (
        <div className="flex gap-6">
          <div className="flex-1">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-gray-600">ID</th>
                    <th className="px-4 py-3 font-medium text-gray-600">요구사항</th>
                    <th className="px-4 py-3 font-medium text-gray-600">유형</th>
                    <th className="px-4 py-3 font-medium text-gray-600">중요도</th>
                    <th className="px-4 py-3 font-medium text-gray-600">신뢰도</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {requirements.map((req) => (
                    <tr key={req.id} onClick={() => setSelectedReq(req.id)}
                      className={`cursor-pointer transition hover:bg-blue-50 ${selectedReq === req.id ? "bg-blue-50" : ""}`}>
                      <td className="px-4 py-3">
                        <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono font-semibold text-gray-700">
                          {req.original_id || `#${req.order}`}
                        </span>
                      </td>
                      <td className="max-w-md px-4 py-3"><p className="line-clamp-2 text-gray-900">{req.source_text}</p></td>
                      <td className="px-4 py-3"><span className="text-gray-600">{TYPE_LABELS[req.type] ?? req.type}</span></td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGES[req.priority]?.class ?? ""}`}>
                          {PRIORITY_BADGES[req.priority]?.label ?? req.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_BADGES[req.confidence_label ?? ""]?.class ?? "bg-gray-100 text-gray-600"}`}>
                          {CONFIDENCE_BADGES[req.confidence_label ?? ""]?.label ?? "분석 전"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selected && (
            <div className="w-96 shrink-0">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="font-semibold text-gray-900">
                  {selected.original_id ? (
                    <>
                      <span className="text-blue-600">{selected.original_id}</span>
                      <span className="ml-2 text-sm font-normal text-gray-500">#순서 {selected.order}</span>
                    </>
                  ) : `요구사항 #${selected.order}`}
                </h3>
                <p className="mt-2 text-sm text-gray-600 line-clamp-4">{selected.source_text}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGES[selected.priority]?.class ?? ""}`}>
                    {PRIORITY_BADGES[selected.priority]?.label ?? selected.priority}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_BADGES[selected.confidence_label ?? ""]?.class ?? "bg-gray-100 text-gray-600"}`}>
                    {CONFIDENCE_BADGES[selected.confidence_label ?? ""]?.label ?? "분석 전"}
                  </span>
                </div>
                <div className="mt-4 border-t pt-4">
                  <h4 className="mb-2 text-sm font-medium text-gray-700">추천 답변</h4>
                  {selected.draft_text ? (
                    <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-line">{selected.draft_text}</div>
                  ) : (
                    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">⚠️ 아직 분석되지 않았습니다.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Similar RFP Tab */}
      {!analyzing && activeTab === "similar" && (
        <div>
          {similarLoading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">🔍 유사 RFP 검색 중...</p>
            </div>
          ) : similarError ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <p className="text-red-500">❌ 오류: {similarError}</p>
              <button onClick={handleRetry} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                다시 시도
              </button>
            </div>
          ) : similarDocs.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">📭 유사한 RFP를 찾을 수 없습니다.</p>
              <p className="mt-2 text-sm text-gray-400">
                문서 라이브러리에 더 많은 RFP를 추가하면 검색 결과가 표시됩니다.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">요구사항을 기준으로 유사한 RFP 문서를 검색한 결과입니다.</p>
              {similarDocs.map((doc) => (
                <div key={doc.docId} className="rounded-xl border border-gray-200 bg-white p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">📄 {doc.docName}</h3>
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                      유사도 {doc.avgScore}% · {doc.matchCount}개 매칭
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {doc.chunks.slice(0, 3).map((chunk, i) => (
                      <div key={i} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                        <p className="line-clamp-2">{chunk.content}</p>
                        <div className="mt-1 flex gap-2 text-xs text-gray-400">
                          {chunk.page && <span>페이지 {chunk.page}</span>}
                          <span>매칭 {chunk.score}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
