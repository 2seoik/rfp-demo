import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "RFP Copilot",
  description: "AI 기반 RFP 요구사항 분석 및 답변 추천 플랫폼",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <nav className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-8">
              <Link href="/" className="text-lg font-bold text-blue-600">
                RFP Copilot
              </Link>
              <div className="flex gap-6 text-sm">
                <Link
                  href="/dashboard"
                  className="text-gray-600 hover:text-gray-900 transition"
                >
                  대시보드
                </Link>
                <Link
                  href="/library"
                  className="text-gray-600 hover:text-gray-900 transition"
                >
                  문서 라이브러리
                </Link>
              </div>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
