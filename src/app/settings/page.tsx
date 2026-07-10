"use client";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">설정</h1>

      <div className="space-y-6">
        {/* API 설정 */}
        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 font-semibold">AI 모델 설정</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                API Base URL
              </label>
              <input
                type="text"
                defaultValue="https://api.opencode.ai/v1"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                API Key
              </label>
              <input
                type="password"
                defaultValue="sk-..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                모델
              </label>
              <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option>deepseek-chat</option>
                <option>glm-4</option>
                <option>gpt-4o</option>
                <option>claude-sonnet-4</option>
              </select>
            </div>
          </div>
        </section>

        {/* 조직 설정 */}
        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 font-semibold">조직 설정</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                조직 이름
              </label>
              <input
                type="text"
                defaultValue="HandySoft"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                팀 멤버
              </label>
              <p className="text-sm text-gray-500">
                현재 1명 (Owner). 멤버 초대는 2단계에서 지원 예정.
              </p>
            </div>
          </div>
        </section>

        {/* 사용량 */}
        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 font-semibold">사용량</h2>
          <div className="text-sm text-gray-600">
            <p>이번 달 API 호출: 0회</p>
            <p>저장된 문서: 0개</p>
            <p>생성된 요구사항: 0개</p>
          </div>
        </section>
      </div>
    </div>
  );
}
