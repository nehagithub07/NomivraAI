import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { safeNextPath } from "@/lib/auth/redirect";
import { authRedirect } from "@/lib/auth/route-response";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  if (
    tokenHash &&
    (type === "email" || type === "signup" || type === "recovery") &&
    getSupabaseConfig()
  ) {
    try {
      const supabase = await createClient({ writable: true });
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      if (!error)
        return authRedirect(
          type === "recovery"
            ? "/reset-password"
            : safeNextPath(searchParams.get("next")),
          request,
        );
    } catch {
      /* Token hashes and raw verification errors never enter application logs. */
    }
  }
  return authRedirect(
    type === "recovery"
      ? "/forgot-password?notice=expired"
      : "/login?error=confirmation",
    request,
  );
}
