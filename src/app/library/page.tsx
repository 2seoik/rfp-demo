"use client";

import { useState } from "react";

type KnowledgeDoc = {
  id: string;
  name: string;
  type: "proposal" | "report" | "manual" | "other";
  parsedStatus: "ready" | "processing" | "error";
  uploadDate: string;
};

const MOCK_DOCS: KnowledgeDoc[] = [
  {
    id: "1",
    name: "2023_A사_제안서.docx",
    type: "proposal",
    parsedStatus: "ready",
    uploadDate: "2026-07-01",
  },
  {
    id: "2",
    name: "실적증명서_2025.pdf",
    type: "proposal",
    parsedStatus: "ready",
    uploadDate: "2026-07-01",
  },
  {
    id: "3",
    name: "보안정책_내부기준.pdf",
    type: "manual",
    parsedStatus: "ready",
    uploadDate: "2026-07-03",
  },
  {
    id: "4",
    name: "기술아키텍쳐_설명서.docx",
    type: "report",
    parsedStatus: "processing",
    uploadDate: "2026-07-10",
  },
];

const TYPE_LABELS: Record<string, string> = {
  proposal: "제안서",
  report: "보고서",
  manual: "기술자료",
  other: "기타",
};

export default function LibraryPage() {
  const [isUploading, setIsUploading] = useState(false);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">문서 라이브러리</h1>
          <p className="mt-1 text-sm text-gray-500">
            과거 제안서, 기술자료를 업로드하면 AI가 검색하고 답변 근거로 활용합니다
          </p>
        </div>
        <label className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition">
          + 문서 업로드
          <input
            type="file"
            accept=".pdf,.docx"
            multiple
            className="hidden"
            onChange={() => setIsUploading(true)}
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-600">파일명</th>
              <th className="px-4 py-3 font-medium text-gray-600">유형</th>
              <th className="px-4 py-3 font-medium text-gray-600">상태</th>
              <th className="px-4 py-3 font-medium text-gray-600">업로드일</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {MOCK_DOCS.map((doc) => (
              <tr key={doc.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {doc.name}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {TYPE_LABELS[doc.type]}
                </td>
                <td className="px-4 py-3">
                  {doc.parsedStatus === "ready" ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      ✅ 임베딩 완료
                    </span>
                  ) : doc.parsedStatus === "processing" ? (
                    <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                      ⏳ 처리 중
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      ❌ 오류
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">{doc.uploadDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isUploading && (
        <div className="mt-4 rounded-lg bg-blue-50 p-4 text-sm text-blue-700">
          📄 파일 업로드 및 AI 분석 중... (문서 크기에 따라 수 초~수 분 소요)
        </div>
      )}
    </div>
  );
}
