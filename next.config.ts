import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  outputFileTracingRoot: path.resolve(process.cwd()),
  allowedDevOrigins: ["192.168.1.204"],
};

export default nextConfig;
