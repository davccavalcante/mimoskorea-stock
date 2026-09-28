import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native image library and filesystem-heavy code stay out of the bundle.
  serverExternalPackages: ["sharp", "undici"],
  poweredByHeader: false,
  typedRoutes: true,
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
