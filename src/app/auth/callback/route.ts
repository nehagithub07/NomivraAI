import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { safeNextPath } from "@/lib/auth/redirect";
import { authRedirect } from "@/lib/auth/route-response";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const flowId = searchParams.get("sb_flow_id");
  const recovery = searchParams.get("flow") === "recovery";
  if (code && !searchParams.has("error") && getSupabaseConfig()) {
    try {
      const supabase = await createClient({ writable: true });
      const { error } = await supabase.auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined,
      );
      if (!error)
        return authRedirect(
          recovery ? "/reset-password" : safeNextPath(searchParams.get("next")),
          request,
        );
    } catch {
      /* Never return or log authorization codes or provider error descriptions. */
    }
  }
  return authRedirect(
    recovery ? "/forgot-password?notice=expired" : "/login?error=callback",
    request,
  );
}
