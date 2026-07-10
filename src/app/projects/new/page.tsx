"use client";

import { useState, useCallback } from "react";

export default function NewProjectPage() {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "parsing" | "complete" | "error">("idle");

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.type === "application/pdf" || droppedFile.name.endsWith(".docx"))) {
      setFile(droppedFile);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name) return;

    setIsUploading(true);
    setStatus("uploading");

    // TODO: 실제 API 연동
    // const formData = new FormData();
    // formData.append("file", file);
    // formData.append("name", name);
    // const res = await fetch("/api/projects", { method: "POST", body: formData });

    setTimeout(() => {
      setStatus("complete");
      setIsUploading(false);
    }, 2000);
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">새 RFP 분석</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 프로젝트 이름 */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            프로젝트 이름
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 2026년 공공기관 정보시스템 구축"
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
            required
          />
        </div>

        {/* 파일 업로드 */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            RFP 파일 (PDF 또는 DOCX)
          </label>
          <div
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            className={`mt-1 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition ${
              isDragging
                ? "border-blue-400 bg-blue-50"
                : "border-gray-300 bg-gray-50"
            }`}
          >
            {file ? (
              <div className="text-center">
                <p className="font-medium text-gray-900">{file.name}</p>
                <p className="mt-1 text-sm text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="mt-2 text-sm text-red-500 hover:text-red-700"
                >
                  파일 변경
                </button>
              </div>
            ) : (
              <>
                <svg
                  className="mb-3 h-10 w-10 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-blue-600 hover:text-blue-500">
                    클릭하여 파일 선택
                  </span>{" "}
                  또는 여기로 드래그
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  PDF, DOCX (최대 50MB)
                </p>
                <input
                  type="file"
                  accept=".pdf,.docx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
              </>
            )}
          </div>
        </div>

        {/* 상태 표시 */}
        {status === "uploading" && (
          <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-700">
            📄 파일 업로드 중...
          </div>
        )}
        {status === "parsing" && (
          <div className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-700">
            🔍 AI가 RFP 문서를 분석 중입니다 (30초~2분 소요)...
          </div>
        )}
        {status === "complete" && (
          <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700">
            ✅ 분석이 완료되었습니다! 요구사항 매트릭스를 확인해보세요.
          </div>
        )}

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={!file || !name || isUploading}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 transition disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isUploading ? "업로드 중..." : "분석 시작"}
        </button>
      </form>
    </div>
  );
}
