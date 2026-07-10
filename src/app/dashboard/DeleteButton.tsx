"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } catch {}
    setDeleting(false);
    setShowConfirm(false);
  };

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); setShowConfirm(true); }}
        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
        title="삭제"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowConfirm(false)}>
          <div className="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">프로젝트 삭제</h3>
            <p className="mt-2 text-sm text-gray-600">
              &ldquo;{projectName}&rdquo; 프로젝트를 삭제하시겠습니까?
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setShowConfirm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                취소
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:bg-gray-300">
                {deleting ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
