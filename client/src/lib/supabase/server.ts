import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";

export async function createClient({
  writable = false,
}: { writable?: boolean } = {}) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase Auth is not configured.");
  const cookieStore = await cookies();
  return createServerClient<Database>(config.url, config.key, {
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        // Actions and route handlers write cookies. Proxy owns refresh during RSC rendering.
        if (writable)
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
      },
    },
  });
}
