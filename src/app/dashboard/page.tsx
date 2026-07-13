import { db } from "@/db";
import { sql } from "drizzle-orm";
import Link from "next/link";
import DeleteButton from "./DeleteButton";

type Project = {
  id: string;
  name: string;
  status: string;
  requirement_count: number;
  document_count: number;
  updated_at: string;
  biz_name: string | null;
  period: string | null;
};

async function getProjects(): Promise<Project[]> {
  try {
    const rows = (await db.execute(sql`
      SELECT
        p.id, p.name, p.status, p.period, p.updated_at,
        COUNT(DISTINCT r.id)::int AS requirement_count,
        COUNT(DISTINCT d.id)::int AS document_count,
        (SELECT d2.header_text FROM documents d2
         WHERE d2.project_id = p.id AND d2.type = 'rfp' LIMIT 1) AS header_text
      FROM projects p
      LEFT JOIN requirements r ON r.project_id = p.id
      LEFT JOIN documents d ON d.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `)).rows ?? [];

    return (rows as any[]).map((r) => {
      const ht = r.header_text || "";
      let bizName: string | null = null;
      const m = /(?:사\s*업\s*명|사업명)\s*[:：]?\s*(.+?)(?:\n|$)/gi.exec(ht);
      if (m) {
        const c = m[1].trim();
        if (c.length >= 5 && !/^[·.\s\d]+$/.test(c)) {
          bizName = c.replace(/\t/g, "").replace(/\s{2,}/g, " ");
        }
      }
      return { ...r, biz_name: bizName };
    }) as Project[];
  } catch {
    return [];
  }
}

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  draft: { label: "초안", class: "bg-gray-100 text-gray-700" },
  analyzing: { label: "분석 중", class: "bg-yellow-100 text-yellow-700" },
  review: { label: "검토 중", class: "bg-blue-100 text-blue-700" },
  final: { label: "분석 완료", class: "bg-green-100 text-green-700" },
};

export default async function DashboardPage() {
  const projects = await getProjects();

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">RFP 프로젝트</h1>
          <p className="mt-1 text-gray-500">AI 기반 RFP 분석 및 답변 추천 대시보드</p>
        </div>
        <Link href="/projects/new" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition">
          + 새 RFP 분석
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">아직 프로젝트가 없습니다.</p>
          <Link href="/projects/new" className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition">
            첫 RFP 분석 시작하기
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const statusInfo = STATUS_LABELS[project.status] ?? { label: project.status, class: "bg-gray-100 text-gray-700" };
            return (
              <div key={project.id} className="group relative rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md hover:border-blue-300">
                <Link href={`/projects/${project.id}`} className="block p-5">
                  <h3 className="font-semibold text-gray-900 group-hover:text-blue-600">{project.name}</h3>
                  {project.biz_name && (
                    <p className="mt-0.5 text-xs text-gray-400 truncate">{project.biz_name}</p>
                  )}
                  {project.period && (
                    <p className="mt-0.5 text-xs text-gray-400">{project.period}</p>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-sm text-gray-500">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.class}`}>
                      {statusInfo.label}
                    </span>
                    {project.requirement_count > 0 && <span>요구사항 {project.requirement_count}개</span>}
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    문서 {project.document_count}개 · {project.updated_at ? new Date(project.updated_at).toLocaleDateString("ko-KR") : ""}
                  </p>
                </Link>
                <div className="absolute right-3 top-3">
                  <DeleteButton projectId={project.id} projectName={project.name} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
