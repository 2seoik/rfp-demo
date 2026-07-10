"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

type Tab = "matrix" | "export";

// Mock data for UI development
const MOCK_REQUIREMENTS = [
  {
    id: "REQ-001",
    sourceText: "제안사는 최근 3년 이내 유사 사업(공공기관 대상 업무시스템 구축) 수행 실적을 2건 이상 보유해야 한다",
    type: "qualification",
    priority: "essential",
    status: "answered",
    confidence: "sufficient",
    draftText:
      "당사는 최근 3년 이내 3건의 공공기관 업무시스템 구축 실적을 보유하고 있습니다.\n[출처: 실적증명서_2025.pdf, 2페이지]\n[출처: A기관_구축완료보고서.docx, 1페이지]",
  },
  {
    id: "REQ-002",
    sourceText: "개인정보 암호화 저장 방식에 대해 기술할 것",
    type: "security",
    priority: "essential",
    status: "partial",
    confidence: "partial",
    draftText:
      "저장 데이터는 AES-256, 전송 구간은 TLS 1.2 이상을 적용합니다.\n[출처: 2023_A사_제안서.docx, 12페이지]",
  },
  {
    id: "REQ-003",
    sourceText: "장애 발생 시 4시간 내 복구 SLA를 제시해야 한다",
    type: "operation",
    priority: "recommended",
    status: "pending",
    confidence: "insufficient",
    draftText: "",
  },
  {
    id: "REQ-004",
    sourceText: "제안서 분량은 40페이지 이내로 작성할 것",
    type: "format",
    priority: "essential",
    status: "confirmed",
    confidence: "sufficient",
    draftText: "제안서 분량 기준을 준수하여 작성하겠습니다.",
  },
];

const TYPE_LABELS: Record<string, string> = {
  qualification: "자격요건",
  security: "보안",
  operation: "운영",
  technical: "기술",
  format: "제출형식",
  general: "일반",
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

export default function ProjectDetailPage() {
  const params = useParams();
  const [activeTab, setActiveTab] = useState<Tab>("matrix");
  const [selectedReq, setSelectedReq] = useState<string | null>(null);

  const projectId = params.id as string;
  const selectedRequirement = MOCK_REQUIREMENTS.find((r) => r.id === selectedReq);

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">프로젝트: 2026년 공공기관 정보시스템 구축</h1>
        <p className="mt-1 text-sm text-gray-500">
          RFP 분석 결과 · 요구사항 {MOCK_REQUIREMENTS.length}개 추출
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          <button
            onClick={() => setActiveTab("matrix")}
            className={`pb-3 text-sm font-medium transition ${
              activeTab === "matrix"
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            요구사항 매트릭스
          </button>
          <button
            onClick={() => setActiveTab("export")}
            className={`pb-3 text-sm font-medium transition ${
              activeTab === "export"
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            내보내기
          </button>
        </nav>
      </div>

      {activeTab === "matrix" && (
        <div className="flex gap-6">
          {/* Requirement List */}
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
                  {MOCK_REQUIREMENTS.map((req) => (
                    <tr
                      key={req.id}
                      onClick={() => setSelectedReq(req.id)}
                      className={`cursor-pointer transition hover:bg-blue-50 ${
                        selectedReq === req.id ? "bg-blue-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {req.id}
                      </td>
                      <td className="max-w-md px-4 py-3">
                        <p className="line-clamp-2 text-gray-900">
                          {req.sourceText}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-gray-600">
                          {TYPE_LABELS[req.type] ?? req.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            PRIORITY_BADGES[req.priority]?.class
                          }`}
                        >
                          {PRIORITY_BADGES[req.priority]?.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            CONFIDENCE_BADGES[req.confidence]?.class
                          }`}
                        >
                          {CONFIDENCE_BADGES[req.confidence]?.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Panel - Answer Detail */}
          {selectedRequirement && (
            <div className="w-96 shrink-0">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="font-semibold text-gray-900">
                  {selectedRequirement.id}
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  {selectedRequirement.sourceText}
                </p>

                <div className="mt-4 flex gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      PRIORITY_BADGES[selectedRequirement.priority]?.class
                    }`}
                  >
                    {PRIORITY_BADGES[selectedRequirement.priority]?.label}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      CONFIDENCE_BADGES[selectedRequirement.confidence]?.class
                    }`}
                  >
                    {CONFIDENCE_BADGES[selectedRequirement.confidence]?.label}
                  </span>
                </div>

                <div className="mt-4 border-t pt-4">
                  <h4 className="mb-2 text-sm font-medium text-gray-700">
                    추천 답변
                  </h4>
                  {selectedRequirement.draftText ? (
                    <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-line">
                      {selectedRequirement.draftText}
                    </div>
                  ) : (
                    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                      ⚠️ 관련 문서에서 근거를 찾을 수 없습니다. 직접 확인이 필요합니다.
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition">
                      이 답변 사용
                    </button>
                    <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition">
                      직접 작성
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "export" && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 font-semibold">내보내기</h2>
          <p className="mb-4 text-sm text-gray-600">
            요구사항 매트릭스와 답변을 엑셀 또는 워드 파일로 내보냅니다.
          </p>
          <div className="flex gap-3">
            <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition">
              📊 엑셀로 내보내기 (XLSX)
            </button>
            <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
              📄 워드로 내보내기 (DOCX)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
