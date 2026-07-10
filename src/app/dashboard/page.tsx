import Link from "next/link";

// Mock data for initial UI development
const MOCK_PROJECTS = [
  {
    id: "1",
    name: "2026년 공공기관 정보시스템 구축",
    status: "분석 완료",
    requirementCount: 47,
    updatedAt: "2026-07-08",
  },
  {
    id: "2",
    name: "금융보안 솔루션 도입 RFP",
    status: "분석 중",
    requirementCount: 0,
    updatedAt: "2026-07-10",
  },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">RFP 프로젝트</h1>
          <p className="mt-1 text-gray-500">
            AI 기반 RFP 분석 및 답변 추천 대시보드
          </p>
        </div>
        <Link
          href="/projects/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition"
        >
          + 새 RFP 분석
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MOCK_PROJECTS.map((project) => (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-blue-300"
          >
            <h3 className="font-semibold text-gray-900 group-hover:text-blue-600">
              {project.name}
            </h3>
            <div className="mt-3 flex items-center gap-3 text-sm text-gray-500">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  project.status === "분석 완료"
                    ? "bg-green-100 text-green-700"
                    : project.status === "분석 중"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-gray-100 text-gray-700"
                }`}
              >
                {project.status}
              </span>
              {project.requirementCount > 0 && (
                <span>요구사항 {project.requirementCount}개</span>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              업데이트: {project.updatedAt}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
