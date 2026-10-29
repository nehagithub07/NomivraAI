"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";
import {
  forgotPasswordSchema,
  loginSchema,
  signupSchema,
  resetPasswordSchema,
  maskEmail,
  type AuthState,
} from "./validation";
import { safeNextPath } from "./redirect";
import { recoveryResult } from "./recovery-result";

const unavailable: AuthState = {
  status: "error",
  message: "Sign-in is temporarily unavailable. Please try again later.",
};
const unexpected: AuthState = {
  status: "error",
  message: "Something went wrong. Please try again.",
};

function authFailure(
  error: { code?: string; status?: number; name?: string },
  login = false,
): AuthState {
  if (error.name === "AuthRetryableFetchError" || error.status === 0)
    return {
      status: "error",
      message: "We couldn't connect to sign-in. Check your connection and try again.",
    };
  if (
    error.status === 429 ||
    ["over_request_rate_limit", "over_email_send_rate_limit"].includes(
      error.code ?? "",
    )
  )
    return {
      status: "error",
      message: "Too many attempts. Please wait a few minutes and try again.",
    };
  if (error.code === "email_not_confirmed")
    return {
      status: "error",
      message:
        "Please confirm your email before signing in. Check your inbox for the verification link.",
    };
  if (error.code === "weak_password")
    return {
      status: "error",
      message:
        "This password doesn’t meet the account’s password policy. Try a longer password.",
    };
  if (error.code === "same_password")
    return {
      status: "error",
      message: "Choose a different password from your current one.",
    };
  if (
    login &&
    ["invalid_credentials", "user_not_found", "invalid_grant"].includes(
      error.code ?? "",
    )
  )
    return { status: "error", message: "Email or password is incorrect." };
  return unexpected;
}

function finishSignIn(next: string): never {
  revalidatePath("/", "layout");
  redirect(next);
}

export async function signIn(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
      message: "Check the highlighted fields.",
    };
  if (!getSupabaseConfig()) return unavailable;
  try {
    const supabase = await createClient({ writable: true });
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return authFailure(error, true);
  } catch {
    return {
      status: "error",
      message: "We couldn’t connect. Please try again.",
    };
  }
  finishSignIn(safeNextPath(formData.get("next")));
}

export async function signUp(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
      message: "Check the highlighted fields.",
    };
  const origin = getSiteOrigin();
  if (!getSupabaseConfig() || !origin) return unavailable;
  const next = safeNextPath(formData.get("next"));
  let hasSession = false;
  try {
    const supabase = await createClient({ writable: true });
    const { firstName, lastName, email, password } = parsed.data;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName },
        emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });
    if (
      error &&
      !["user_already_exists", "email_exists"].includes(error.code ?? "")
    )
      return authFailure(error);
    hasSession = !!data.session;
    if (!hasSession)
      (await cookies()).set("nomvira-verification-email", maskEmail(email), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/verify-email",
        maxAge: 600,
      });
  } catch {
    return {
      status: "error",
      message: "We couldn’t connect. Please try again.",
    };
  }
  if (hasSession) finishSignIn(next);
  redirect("/verify-email");
}

export async function requestPasswordReset(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
      message: "Enter a valid email address.",
    };
  const origin = getSiteOrigin();
  if (!getSupabaseConfig() || !origin) return unavailable;
  try {
    const supabase = await createClient({ writable: true });
    const { error } = await supabase.auth.resetPasswordForEmail(
      parsed.data.email,
      { redirectTo: `${origin}/auth/callback?flow=recovery` },
    );
    return recoveryResult(error);
  } catch {
    return {
      status: "error",
      message: "We couldn’t request a reset link right now. Please try again.",
    };
  }
}

export async function updatePassword(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      status: "error",
      fieldErrors: parsed.error.flatten().fieldErrors,
      message: "Check the highlighted fields.",
    };
  if (!getSupabaseConfig()) return unavailable;
  try {
    const supabase = await createClient({ writable: true });
    const { data, error: sessionError } = await supabase.auth.getUser();
    if (sessionError || !data.user)
      return {
        status: "error",
        message: "Your reset link has expired. Request a new link to continue.",
      };
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (error) return authFailure(error);
  } catch {
    return unexpected;
  }
  revalidatePath("/", "layout");
  return { status: "success", message: "Password updated successfully." };
}

export async function startGoogleSignIn(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const origin = getSiteOrigin();
  if (!getSupabaseConfig() || !origin) return unavailable;
  let providerUrl: string;
  try {
    const supabase = await createClient({ writable: true });
    const next = safeNextPath(formData.get("next"));
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url)
      return {
        status: "error",
        message:
          "Google sign-in is unavailable. Please try email and password.",
      };
    // The destination is produced by the configured Supabase client, never by a submitted URL.
    providerUrl = data.url;
  } catch {
    return unexpected;
  }
  redirect(providerUrl);
}

export async function signOut(): Promise<AuthState> {
  if (!getSupabaseConfig()) return unavailable;
  try {
    const supabase = await createClient({ writable: true });
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error)
      return {
        status: "error",
        message: "We couldn’t sign you out. Please try again.",
      };
  } catch {
    return {
      status: "error",
      message: "We couldn’t sign you out. Please try again.",
    };
  }
  revalidatePath("/", "layout");
  redirect("/login?notice=signed-out");
}
