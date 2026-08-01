import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ep/ui"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://localhost:5000/api/:path*" }];
  },
};

export default nextConfig;
