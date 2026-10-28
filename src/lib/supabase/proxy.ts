import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./config";
import { isProtectedPath, safeNextPath } from "@/lib/auth/redirect";

const privateHeaders = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export async function updateSession(request: NextRequest) {
  const next = safeNextPath(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  // Always overwrite the incoming value; this is context, never an authorization claim.
  request.headers.set("x-nomvira-next", next);
  let response = NextResponse.next({ request });
  const config = getSupabaseConfig();
  let authenticated = false;
  if (config) {
    const supabase = createServerClient(config.url, config.key, {
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, cacheHeaders) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          const prior = response;
          response = NextResponse.next({ request });
          prior.cookies
            .getAll()
            .forEach((cookie) => response.cookies.set(cookie));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(cacheHeaders).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    });
    try {
      // Fetch a verified, current user record. Never authorize from getSession().
      const { data, error } = await supabase.auth.getUser();
      authenticated = !error && !!data.user;
    } catch {
      authenticated = false;
    }
  }

  let target: URL | null = null;
  // Return an action error without navigating away and losing the trip form.
  // GETs remain protected; the action itself verifies the current user.
  const tripAction = request.nextUrl.pathname === "/trips/new" &&
    request.method === "POST" && request.headers.has("next-action");
  if (!authenticated && isProtectedPath(request.nextUrl.pathname) && !tripAction) {
    target = new URL("/login", request.url);
    target.searchParams.set("next", next);
  } else if (
    authenticated &&
    ["/login", "/signup"].includes(request.nextUrl.pathname)
  ) {
    target = new URL(
      safeNextPath(request.nextUrl.searchParams.get("next")),
      request.url,
    );
  }
  if (target) {
    const redirected = NextResponse.redirect(target);
    response.cookies
      .getAll()
      .forEach((cookie) => redirected.cookies.set(cookie));
    response = redirected;
  }
  Object.entries(privateHeaders).forEach(([key, value]) =>
    response.headers.set(key, value),
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
