import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // Static export only for production build
  ...(isDev ? {} : { output: "export", distDir: "out" }),

  // Fix WebSocket HMR when accessing via external IP
  allowedDevOrigins: ["45.136.254.176"],

  // Dev mode: proxy /api/* → Go backend
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://localhost:${process.env.BACKEND_PORT || 3001}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
