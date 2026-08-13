import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ep/ui"],
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "*.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "*.s3.*.amazonaws.com",
      },
    ],
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://localhost:5000/api/:path*" }];
  },
};

export default nextConfig;
