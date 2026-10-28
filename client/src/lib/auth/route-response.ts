import "server-only";
import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/supabase/config";

export function authRedirect(path: string, request: Request) {
  const response = NextResponse.redirect(
    new URL(path, getSiteOrigin() ?? new URL(request.url).origin),
    303,
  );
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
