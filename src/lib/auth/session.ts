import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { safeNextPath } from "./redirect";

export const getCurrentUser = cache(async (writable = false) => {
  if (!getSupabaseConfig()) return null;
  try {
    const supabase = await createClient({ writable });
    const { data, error } = await supabase.auth.getUser();
    return error ? null : data.user;
  } catch {
    return null;
  }
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    const next = safeNextPath((await headers()).get("x-nomvira-next"));
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return user;
}
