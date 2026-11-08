import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Auth callbacks carry one-time tokens; Server Action arguments can contain credentials.
  logging: {
    serverFunctions: false,
    incomingRequests: { ignore: [/\/auth\/(?:callback|confirm)(?:\?|$)/, /\/share\//] },
  },
  async headers() {
    return [
      { source: "/:path*", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
      ] },
      { source: "/share/:path*", headers: [
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
      ] },
    ];
  },
};

export default nextConfig;
