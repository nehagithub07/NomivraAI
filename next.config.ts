import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Auth callbacks carry one-time tokens; Server Action arguments can contain credentials.
  logging: {
    serverFunctions: false,
    incomingRequests: { ignore: [/\/auth\/(?:callback|confirm)(?:\?|$)/] },
  },
};

export default nextConfig;
