export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">RFP Copilot</h1>
      <p className="text-lg text-gray-600 mb-8">
        AI 기반 RFP 요구사항 분석 및 답변 추천 플랫폼
      </p>
      <div className="flex gap-3 mb-8 text-sm text-gray-500">
        <span className="rounded-lg bg-blue-50 px-3 py-1.5">PDF·DOCX 업로드</span>
        <span className="rounded-lg bg-blue-50 px-3 py-1.5">AI 요구사항 추출</span>
        <span className="rounded-lg bg-blue-50 px-3 py-1.5">유사 RFP 검색</span>
      </div>
      <a
        href="/dashboard"
        className="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 transition"
      >
        대시보드 시작하기
      </a>
    </main>
  );
}
