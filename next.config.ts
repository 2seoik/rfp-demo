import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow larger uploads (PDF files up to 50MB)
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
