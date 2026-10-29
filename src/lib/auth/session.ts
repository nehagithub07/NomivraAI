import "server-only";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { safeNextPath } from "./redirect";
import { AuthVerificationUnavailableError } from "./errors";

export async function getCurrentUser(writable = false, { failOnUnavailable = false }: { failOnUnavailable?: boolean } = {}) {
  const config = getSupabaseConfig();

  if (!config) {
    console.warn("[auth] user_verification_unavailable", { reason: "configuration_missing" });
    if (failOnUnavailable) throw new AuthVerificationUnavailableError();
    return null;
  }

  try {
    const supabase = await createClient({ writable });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      const unavailable = error.name === "AuthRetryableFetchError" || error.status === 0 || error.status === 429 || (error.status !== undefined && error.status >= 500);
      // A missing session is normal on public sign-in pages. Transient service
      // failures are handled errors, not uncaught exceptions for the dev overlay.
      if (error.name !== "AuthSessionMissingError") console.warn("[auth] user_verification_unavailable", {
        reason: unavailable ? "connection_failed" : "verification_failed",
        status: error.status,
      });
      if (failOnUnavailable && unavailable) throw new AuthVerificationUnavailableError();
      return null;
    }

    return user;
  } catch (error) {
    if (error instanceof AuthVerificationUnavailableError) throw error;
    // Do not log raw exceptions, URLs or authentication material.
    console.warn("[auth] user_verification_unavailable", { reason: "unexpected_error" });
    if (failOnUnavailable) throw new AuthVerificationUnavailableError();
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
