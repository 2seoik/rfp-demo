"use client";

import { useRouter } from "next/navigation";
import { type SubmitEvent, useCallback, useState } from "react";

export default function NewProjectPage() {
	const router = useRouter();
	const [name, setName] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
	const [uploadStatus, setUploadStatus] = useState("");
	const [error, setError] = useState("");

	const handleDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		const droppedFile = e.dataTransfer.files[0];
		if (
			droppedFile &&
			(droppedFile.name.endsWith(".pdf") || droppedFile.name.endsWith(".docx"))
		) {
			setFile(droppedFile);
			setError("");
		} else {
			setError("PDF 또는 DOCX 파일만 업로드 가능합니다.");
		}
	}, []);

	const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!file || !name) return;

		setIsUploading(true);
		setError("");

		try {
			setUploadStatus("파일 업로드 중...");
			const formData = new FormData();
			formData.append("file", file);
			formData.append("name", name);

			const res = await fetch("/api/upload", {
				method: "POST",
				body: formData,
			});

			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || "업로드 실패");
			}

			const data = await res.json();

			setUploadStatus("업로드 완료! 분석 페이지로 이동합니다...");

			// 분석 페이지로 이동 (프로젝트 페이지에서 자동으로 SSE 분석 시작)
			setTimeout(() => {
				router.push(`/projects/${data.projectId}?analyzing=1`);
			}, 500);
		} catch (err: unknown) {
			setError((err as Error).message || String(err));
			setIsUploading(false);
		}
	};

	return (
		<div className="mx-auto max-w-3xl p-6">
			<h1 className="mb-6 text-2xl font-bold">새 RFP 분석</h1>

			<form onSubmit={handleSubmit} className="space-y-6">
				{/* 프로젝트 이름 */}
				<div>
					<label
						htmlFor="project-name"
						className="mb-1 block text-sm font-medium text-gray-700"
					>
						프로젝트 이름
					</label>
					<input
						id="project-name"
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
					<label
						htmlFor="file-input"
						className="mb-1 block text-sm font-medium text-gray-700"
					>
						RFP 파일 (PDF 또는 DOCX)
					</label>
					{/* biome-ignore lint/a11y/useSemanticElements: drag-drop zone requires div */}
					<div
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ")
								document.getElementById("file-input")?.click();
						}}
						onDrop={handleDrop}
						onDragOver={(e) => {
							e.preventDefault();
							setIsDragging(true);
						}}
						onDragLeave={() => setIsDragging(false)}
						className={`mt-1 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition cursor-pointer ${
							isDragging
								? "border-blue-400 bg-blue-50"
								: "border-gray-300 bg-gray-50 hover:bg-gray-100"
						}`}
						onClick={() => document.getElementById("file-input")?.click()}
					>
						{file ? (
							<div className="text-center">
								<p className="font-medium text-gray-900">{file.name}</p>
								<p className="mt-1 text-sm text-gray-500">
									{(file.size / 1024 / 1024).toFixed(1)} MB
								</p>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										setFile(null);
									}}
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
									role="img"
									aria-label="파일 업로드"
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
									<span className="font-medium text-blue-600">
										클릭하여 파일 선택
									</span>{" "}
									또는 여기로 드래그
								</p>
								<p className="mt-1 text-xs text-gray-400">
									PDF, DOCX (최대 50MB)
								</p>
							</>
						)}
						<input
							id="file-input"
							type="file"
							accept=".pdf,.docx"
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f) {
									setFile(f);
									setError("");
								}
							}}
							className="hidden"
						/>
					</div>
				</div>

				{/* 에러 메시지 */}
				{error && (
					<div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
						{error}
					</div>
				)}

				{/* 업로드 상태 */}
				{isUploading && (
					<div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-700">
						{uploadStatus}
						<div className="mt-2 h-1.5 w-full rounded-full bg-blue-200">
							<div
								className="h-1.5 animate-pulse rounded-full bg-blue-600"
								style={{ width: "80%" }}
							></div>
						</div>
						<p className="mt-1 text-xs text-blue-500">
							파일 업로드 중입니다...
						</p>
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
