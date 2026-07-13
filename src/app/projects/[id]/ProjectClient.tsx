"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type Requirement = {
  id: string;
  original_id: string | null;
  name: string | null;
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

type MatchedPair = {
  sourceId: string;
  sourceOriginalId: string | null;
  sourceName: string | null;
  targetId: string;
  targetOriginalId: string | null;
  targetName: string | null;
  targetText: string;
  targetHeadline: string;
  matchType: "id" | "content";
  score: number;
};

type SimilarDoc = {
  projectId: string;
  projectName: string;
  overallSimilarity: number;
  headerSimilarity: number;
  headerMatchText: string;
  bizName: string;
  period: string;
  docName: string;
  reqCount: number;
  matchedPairs: MatchedPair[];
  idMatchCount: number;
  contentMatchCount: number;
  breakdown: { headerSimilarity: number; idOverlap: number; contentSimilarity: number };
  explanation: string;
};

type SourceProjectInfo = {
  name: string;
  bizName: string;
  period: string;
  docName: string;
  reqCount: number;
  topType: string;
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
  sufficient: { label: "근거충분", class: "bg-green-100 text-green-700" },
  partial: { label: "부분근거", class: "bg-yellow-100 text-yellow-700" },
  needs_review: { label: "확인필요", class: "bg-orange-100 text-orange-700" },
  insufficient: { label: "근거없음", class: "bg-red-100 text-red-700" },
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
  // autoAnalyze: 업로드 직후 진입 시 true (폴링 즉시 시작)
  // project.status === 'analyzing': 대시보드에서 다시 돌아와도 진행바 표시
  const [analyzing, setAnalyzing] = useState(
    autoAnalyze || project.status === "analyzing"
  );
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [analyzeError, setAnalyzeError] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Similar RFP state
  const [similarDocs, setSimilarDocs] = useState<SimilarDoc[]>([]);
  const [sourceProject, setSourceProject] = useState<SourceProjectInfo | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarSearched, setSimilarSearched] = useState(false);
  const [similarError, setSimilarError] = useState("");
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  const toggleCard = (projectId: string) => {
    setExpandedCards((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  };

  const selected = requirements.find((r) => r.id === selectedReq);

  // ── Polling: Worker 진행상황 조회 ────────────────────
  useEffect(() => {
    if (!analyzing) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/analyze-status`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.progress != null) setProgress(data.progress);
        if (data.message) setProgressMessage(data.message);

        if (data.status === "completed") {
          setProgressMessage(data.message || "분석 완료!");
          setAnalyzing(false);
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setTimeout(() => router.refresh(), 1500);
        }

        if (data.status === "failed") {
          setAnalyzeError(data.error || "분석에 실패했습니다.");
          setAnalyzing(false);
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
        }
      } catch {}
    };

    // 즉시 한 번 실행 후 2초 간격 polling
    poll();
    pollingRef.current = setInterval(poll, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
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
          setSourceProject(data.sourceProject ?? null);
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
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setAnalyzing(false);
    router.push("/dashboard");
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          {(project as any).biz_name && (
            <p className="mt-0.5 text-sm text-gray-500">{ (project as any).biz_name}</p>
          )}
          {data.documents.length > 0 && (
            <p className="mt-1 text-sm text-gray-500 flex items-center gap-1">
              <span>{data.documents[0].name}</span>
            </p>
          )}
          {project.period && (
            <p className="mt-0.5 text-sm text-gray-500 flex items-center gap-1">
              <span>사업기간: {project.period}</span>
            </p>
          )}
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
            삭제
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
          <div className="mt-4 grid grid-cols-5 gap-2 text-center text-xs">
            {[
              { step: "start", label: "준비", icon: "1", threshold: 0 },
              { step: "parsing", label: "PDF 파싱", icon: "2", threshold: 5 },
              { step: "analyzing", label: "AI 분석", icon: "3", threshold: 20 },
              { step: "saving", label: "저장", icon: "💾", threshold: 70 },
              { step: "done", label: "완료", icon: "✓", threshold: 100 },
            ].map((s) => {
              const active = progress >= s.threshold;
              return (
                <div
                  key={s.step}
                  className={`rounded-lg p-2 transition-colors duration-500 ${
                    active
                      ? "bg-blue-100 text-blue-800 ring-1 ring-blue-300"
                      : "bg-gray-100 text-gray-400"
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
          <p className="text-sm text-red-700">{analyzeError}</p>
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
              유사 RFP 검색
            </button>
          </nav>
        </div>
      )}

      {/* Matrix Tab */}
      {!analyzing && activeTab === "matrix" && (
        <div className="flex gap-6">
          <div className="flex-1">
            {/* 요약 바 */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-gray-500">총 {requirements.length}건</span>
              {(() => {
                const dist: Record<string, number> = {};
                requirements.forEach((r) => { dist[r.type] = (dist[r.type] || 0) + 1; });
                return Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([t, c]) => (
                  <span key={t} className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                    {TYPE_LABELS[t] ?? t} {c}
                  </span>
                ));
              })()}
              {(() => {
                const pri: Record<string, number> = {};
                requirements.forEach((r) => { pri[r.priority] = (pri[r.priority] || 0) + 1; });
                return Object.entries(pri).sort((a, b) => b[1] - a[1]).map(([p, c]) => (
                  <span key={p} className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGES[p]?.class ?? ""}`}>
                    {PRIORITY_BADGES[p]?.label ?? p} {c}
                  </span>
                ));
              })()}
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-gray-600 w-24">ID</th>
                    <th className="px-4 py-3 font-medium text-gray-600">요구사항</th>
                    <th className="px-4 py-3 font-medium text-gray-600 w-20">유형</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {requirements.map((req) => (
                    <tr key={req.id} onClick={() => setSelectedReq(req.id)}
                      className={`cursor-pointer transition hover:bg-blue-50 ${selectedReq === req.id ? "bg-blue-50" : ""}`}>
                      <td className="px-4 py-3 align-top">
                        <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono font-semibold text-gray-700 whitespace-nowrap">
                          {req.original_id || `#${req.order}`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">
                          {req.name || req.original_id || `요구사항 #${req.order}`}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{req.source_text}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="text-xs text-gray-500">{TYPE_LABELS[req.type] ?? req.type}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selected && (
            <div className="w-96 shrink-0">
              <div className="sticky top-6 rounded-xl border border-gray-200 bg-white p-5 max-h-[calc(100vh-8rem)] overflow-y-auto">
                <h3 className="font-semibold text-gray-900">
                  {selected.name || selected.original_id || `요구사항 #${selected.order}`}
                </h3>
                {selected.original_id && (
                  <p className="mt-0.5 text-xs text-blue-600 font-mono">{selected.original_id} · 순서 #{selected.order}</p>
                )}
                <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-line max-h-48 overflow-y-auto">
                  {selected.source_text}
                </div>
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
                    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">아직 분석되지 않았습니다.</div>
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
              <p className="text-gray-500">유사 RFP 검색 중...</p>
            </div>
          ) : similarError ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <p className="text-red-500">오류: {similarError}</p>
              <button onClick={handleRetry} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                다시 시도
              </button>
            </div>
          ) : similarDocs.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">유사한 RFP를 찾을 수 없습니다.</p>
              <p className="mt-2 text-sm text-gray-400">
                문서 라이브러리에 더 많은 RFP를 추가하면 검색 결과가 표시됩니다.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* 현재 프로젝트 + 비교 테이블 */}
              {sourceProject && (
                <div className="rounded-xl border border-blue-200 bg-white p-5">
                  <p className="text-sm font-semibold text-blue-700 mb-3">현재 프로젝트 · 유사 RFP 비교</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-gray-400">
                          <th className="pb-2 pr-4">구분</th>
                          <th className="pb-2 pr-4">사업명</th>
                          <th className="pb-2 pr-4">사업기간</th>
                          <th className="pb-2 pr-4">요구사항</th>
                          <th className="pb-2">유사도</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-blue-100 bg-blue-50/30">
                          <td className="py-2 pr-4 font-medium text-blue-700">현재</td>
                          <td className="py-2 pr-4 text-gray-800 truncate max-w-[200px]">
                            {sourceProject.bizName || sourceProject.name}
                          </td>
                          <td className="py-2 pr-4 text-gray-600">{sourceProject.period || "-"}</td>
                          <td className="py-2 pr-4 text-gray-600">{sourceProject.reqCount}건</td>
                          <td className="py-2 text-gray-400">-</td>
                        </tr>
                        {similarDocs.map((doc) => (
                          <tr key={doc.projectId} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                            onClick={() => toggleCard(doc.projectId)}>
                            <td className="py-2 pr-4 font-medium text-gray-700">{doc.projectName}</td>
                            <td className="py-2 pr-4 text-gray-600 truncate max-w-[200px]">
                              {doc.bizName || doc.projectName}
                            </td>
                            <td className="py-2 pr-4 text-gray-500 text-xs">{doc.period || "-"}</td>
                            <td className="py-2 pr-4 text-gray-500 text-xs">{doc.reqCount}건</td>
                            <td className="py-2">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      doc.overallSimilarity >= 20
                                        ? "bg-gradient-to-r from-blue-400 to-green-400"
                                        : doc.overallSimilarity >= 12
                                          ? "bg-gradient-to-r from-gray-300 to-blue-400"
                                          : "bg-gray-300"
                                    }`}
                                    style={{ width: `${Math.min(doc.overallSimilarity * 4, 100)}%` }}
                                  />
                                </div>
                                <span className={`text-xs font-bold ${
                                  doc.overallSimilarity >= 20 ? "text-green-600" :
                                  doc.overallSimilarity >= 12 ? "text-blue-600" : "text-gray-500"
                                }`}>
                                  {doc.overallSimilarity}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 유사 프로젝트 카드 */}
              {similarDocs.map((doc) => {
                const isExpanded = expandedCards[doc.projectId] || false;
                return (
                <div key={doc.projectId} className="rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-sm">
                  {/* 헤더: 프로젝트명 + 점수 바 */}
                  <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleCard(doc.projectId)}>
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{isExpanded ? "▾" : "▸"}</span>
                      <div>
                        <h3 className="font-bold text-gray-900">{doc.projectName}</h3>
                        <p className="text-xs text-gray-400">{doc.bizName || doc.docName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* 점수 바 */}
                      <div className="hidden sm:flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              doc.overallSimilarity >= 20
                                ? "bg-gradient-to-r from-blue-400 to-green-400"
                                : doc.overallSimilarity >= 12
                                  ? "bg-gradient-to-r from-gray-300 to-blue-400"
                                  : "bg-gray-300"
                            }`}
                            style={{ width: `${Math.min(doc.overallSimilarity * 4, 100)}%` }}
                          />
                        </div>
                        <span className={`text-sm font-bold ${
                          doc.overallSimilarity >= 20 ? "text-green-600" :
                          doc.overallSimilarity >= 12 ? "text-blue-600" : "text-gray-500"
                        }`}>
                          {doc.overallSimilarity}%
                        </span>
                      </div>
                      {/* 모바일 점수 */}
                      <span className={`sm:hidden rounded-full px-2.5 py-1 text-xs font-bold ${
                        doc.overallSimilarity >= 20 ? "bg-green-100 text-green-700" :
                        doc.overallSimilarity >= 12 ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {doc.overallSimilarity}%
                      </span>
                    </div>
                  </div>

                  {/* 설명 (항상 표시) */}
                  <p className="mt-2 text-sm text-gray-500">{doc.explanation}</p>

                  {/* 요약 배지 (항상 표시) */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                      문서 {doc.breakdown.headerSimilarity}%
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                      요구사항 {doc.contentMatchCount}건
                    </span>
                    {doc.breakdown.idOverlap > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500">
                        ID {doc.breakdown.idOverlap}%
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      클릭하여 상세 보기
                    </span>
                  </div>

                  {/* 확장: 상세 내용 */}
                  {isExpanded && (
                    <div className="mt-4 border-t pt-4 space-y-4">
                      {/* 프로젝트 요약 */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="rounded-lg bg-gray-50 p-2">
                          <span className="text-gray-400">사업명</span>
                          <p className="mt-0.5 text-gray-800 truncate">{doc.bizName || "-"}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-2">
                          <span className="text-gray-400">사업기간</span>
                          <p className="mt-0.5 text-gray-800">{doc.period || "-"}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-2">
                          <span className="text-gray-400">요구사항</span>
                          <p className="mt-0.5 text-gray-800">{doc.reqCount}건</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-2">
                          <span className="text-gray-400">파일</span>
                          <p className="mt-0.5 text-gray-800 truncate">{doc.docName || "-"}</p>
                        </div>
                      </div>

                      {/* 헤더 매칭 스니펫 */}
                      {doc.headerMatchText && (
                        <div className="rounded-lg border border-purple-100 bg-purple-50/30 p-3">
                          <p className="text-xs text-purple-600 mb-1 font-medium">문서 개요 매칭</p>
                          <div
                            className="text-sm text-gray-700 leading-relaxed"
                            dangerouslySetInnerHTML={{
                              __html: doc.headerMatchText.replace(
                                /<(?!\/?mark\b)[^>]*>/g,
                                ""
                              ),
                            }}
                          />
                        </div>
                      )}

                      {/* 매칭 페어 리스트 */}
                      {doc.matchedPairs.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-2">
                            요구사항 매칭 ({doc.matchedPairs.length}건 중 20건 표시)
                          </p>
                          <div className="space-y-2 max-h-80 overflow-y-auto">
                            {doc.matchedPairs.slice(0, 20).map((pair, i) => (
                              <div key={`${pair.sourceId}-${pair.targetId}-${i}`} className="rounded-lg border border-gray-100 bg-gray-50/50 p-2.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 text-xs">
                                      <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 font-mono font-semibold text-blue-700">
                                        {pair.sourceOriginalId || `#${i}`}
                                      </span>
                                      <span className="text-gray-400">→</span>
                                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600">
                                        {pair.targetOriginalId || "?"}
                                      </span>
                                      <span className="truncate text-gray-500">
                                        {pair.targetName || pair.sourceName || ""}
                                      </span>
                                    </div>
                                    {pair.matchType === "content" && pair.targetHeadline ? (
                                      <div
                                        className="mt-1 text-xs text-gray-700 leading-relaxed"
                                        dangerouslySetInnerHTML={{
                                          __html: pair.targetHeadline.replace(/<[^>]*>/g, (tag) => {
                                            if (tag === "<mark>" || tag === "</mark>") return tag;
                                            return "";
                                          }),
                                        }}
                                      />
                                    ) : pair.matchType === "content" ? (
                                      <p className="mt-1 text-xs text-gray-600 line-clamp-2">{pair.targetText}</p>
                                    ) : (
                                      <p className="mt-1 text-xs text-gray-400 italic">
                                        동일 템플릿 ID, 내용 상이
                                      </p>
                                    )}
                                  </div>
                                  <div className="shrink-0">
                                    {pair.matchType === "content" ? (
                                      <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                                        {pair.score}
                                      </span>
                                    ) : (
                                      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400">참고</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
