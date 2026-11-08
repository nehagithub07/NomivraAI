import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/share/")) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    return response;
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/",
    "/trips/:path*",
    "/explore/:path*",
    "/companion/:path*",
    "/saved/:path*",
    "/settings/:path*",
    "/help/:path*",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/share/:path*",
  ],
};
