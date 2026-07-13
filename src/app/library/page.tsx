import { db } from "@/db";
import { documents, documentChunks } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

type DocRow = {
  id: string;
  name: string;
  type: string;
  parsed_status: string;
  created_at: string;
  chunk_count: number;
  project_name: string | null;
};

async function getDocuments(): Promise<DocRow[]> {
  try {
    const rows = (await db.execute(sql`
      SELECT
        d.id,
        d.name,
        d.type,
        d.parsed_status,
        d.created_at,
        COUNT(dc.id)::int AS chunk_count,
        p.name AS project_name
      FROM documents d
      LEFT JOIN document_chunks dc ON dc.document_id = d.id
      LEFT JOIN projects p ON p.id = d.project_id
      GROUP BY d.id, p.name
      ORDER BY d.created_at DESC
    `)).rows ?? [];
    return rows as DocRow[];
  } catch {
    return [];
  }
}

const TYPE_LABELS: Record<string, string> = {
  rfp: "RFP",
  knowledge: "지식문서",
};

export default async function LibraryPage() {
  const docs = await getDocuments();

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">문서 라이브러리</h1>
          <p className="mt-1 text-sm text-gray-500">
            업로드된 RFP 및 참고 문서 목록
          </p>
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">아직 업로드된 문서가 없습니다.</p>
          <p className="mt-2 text-sm text-gray-400">
            RFP 분석 페이지에서 문서를 업로드할 수 있습니다.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-600">파일명</th>
                <th className="px-4 py-3 font-medium text-gray-600">프로젝트</th>
                <th className="px-4 py-3 font-medium text-gray-600">유형</th>
                <th className="px-4 py-3 font-medium text-gray-600">상태</th>
                <th className="px-4 py-3 font-medium text-gray-600">업로드일</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {docs.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {doc.name}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {doc.project_name || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {TYPE_LABELS[doc.type] ?? doc.type}
                  </td>
                  <td className="px-4 py-3">
                    {doc.parsed_status === "ready" ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        분석 완료
                      </span>
                    ) : doc.parsed_status === "parsing" ? (
                      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                        ⏳ 분석 중
                      </span>
                    ) : doc.parsed_status === "error" ? (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        오류
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        대기
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {doc.created_at
                      ? new Date(doc.created_at).toLocaleDateString("ko-KR")
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
