import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/redirect";
import type { AuthMode } from "@/lib/auth/validation";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";
import { AuthForm } from "./auth-form";
import { AuthMessage } from "./auth-message";

export type AuthSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;
const copy = {
  login: {
    title: "Welcome back",
    description: "Sign in and pick up where your curiosity left off.",
  },
  signup: {
    title: "A world of possibility.",
    description:
      "Create your NomviraAI account. Your next chapter starts here.",
  },
  forgot: {
    title: "Forgot your password?",
    description:
      "Enter your email and we’ll send you a secure password reset link.",
  },
  reset: {
    title: "A fresh start",
    description: "Choose a new password for your NomviraAI account.",
  },
};

export async function AuthPage({
  mode,
  searchParams,
}: {
  mode: AuthMode;
  searchParams: AuthSearchParams;
}) {
  const query = await searchParams;
  const next = safeNextPath(query.next);
  const user = mode === "forgot" ? null : await getCurrentUser();
  if (user && (mode === "login" || mode === "signup")) redirect(next);
  const configured =
    !!getSupabaseConfig() &&
    (mode === "signup" || mode === "forgot" ? !!getSiteOrigin() : true);
  const messages: Record<string, string> = {
    callback: "We couldn’t complete sign-in. Please try again.",
    confirmation:
      "This verification link is invalid or has expired. Please try signing in or create your account again.",
  };
  const error =
    typeof query.error === "string" ? messages[query.error] : undefined;
  const notice =
    query.notice === "signed-out"
      ? "You’re signed out. See you on your next journey."
      : query.notice === "expired"
        ? "Your reset link is invalid or has expired. Request a new one below."
        : undefined;
  return (
    <>
      <div className="mb-8">
        <h1 className="type-section text-[1.75rem]">{copy[mode].title}</h1>
        <p className="type-small mt-3 text-muted-foreground">
          {copy[mode].description}
        </p>
      </div>
      <div className="mb-5 space-y-3">
        {!configured && (
          <AuthMessage message="Sign-in is temporarily unavailable. Please try again later." />
        )}
        <AuthMessage message={error} tone="error" />
        <AuthMessage
          message={notice}
          tone={query.notice === "signed-out" ? "success" : "info"}
        />
      </div>
      {mode === "reset" && !user ? (
        <div className="space-y-5">
          <AuthMessage
            tone="error"
            message="Open a valid password reset link from your email to continue."
          />
          <Link
            href="/forgot-password"
            className="type-small inline-flex min-h-11 items-center font-medium"
          >
            Request a new reset link
          </Link>
        </div>
      ) : (
        <AuthForm
          mode={mode}
          next={next}
          configured={configured}
          oauthConfigured={!!getSupabaseConfig() && !!getSiteOrigin()}
        />
      )}
    </>
  );
}
