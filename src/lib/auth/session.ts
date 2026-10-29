import "server-only";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { safeNextPath } from "./redirect";

export async function getCurrentUser(writable = false) {
  const config = getSupabaseConfig();

  if (!config) {
    console.error("[auth] Supabase configuration is missing");
    return null;
  }

  try {
    const supabase = await createClient({ writable });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    console.log("[auth] getCurrentUser", {
      writable,
      hasUser: Boolean(user),
      userId: user?.id ?? null,
      error: error?.message ?? null,
    });

    if (error) {
      console.error("[auth] getUser failed:", error.message);
      return null;
    }

    return user;
  } catch (error) {
    console.error("[auth] createClient/getUser exception:", error);
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    const next = safeNextPath(
      (await headers()).get("x-nomvira-next"),
    );

    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  return user;
}