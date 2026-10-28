"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";

export function createClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase Auth is not configured.");
  // The SSR package supplies the browser singleton and cookie persistence.
  return createBrowserClient<Database>(config.url, config.key);
}
