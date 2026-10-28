"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  signIn,
  signUp,
  requestPasswordReset,
  updatePassword,
} from "@/lib/auth/actions";
import {
  initialAuthState,
  type AuthMode,
  type AuthField,
} from "@/lib/auth/validation";
import { AuthMessage } from "./auth-message";
import { PasswordField } from "./password-field";
import { OAuthButton } from "./oauth-button";

const actions = {
  login: signIn,
  signup: signUp,
  forgot: requestPasswordReset,
  reset: updatePassword,
};
const labels = {
  login: ["Sign in", "Signing in…"],
  signup: ["Create account", "Creating account…"],
  forgot: ["Send reset link", "Sending reset link…"],
  reset: ["Update password", "Updating password…"],
};

export function AuthForm({
  mode,
  next = "/",
  configured,
  oauthConfigured,
}: {
  mode: AuthMode;
  next?: string;
  configured: boolean;
  oauthConfigured: boolean;
}) {
  const [state, action, pending] = useActionState(
    actions[mode],
    initialAuthState,
  );
  const [values, setValues] = useState<Partial<Record<AuthField, string>>>({});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.fieldErrors)
      form.current
        ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
        ?.focus();
  }, [state]);
  const inputProps = (name: AuthField) => ({
    name,
    value: values[name] ?? "",
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((previous) => ({ ...previous, [name]: event.target.value })),
    required: true,
    disabled: pending || !configured,
  });

  function field(
    name: "firstName" | "lastName" | "email",
    label: string,
    autoComplete: string,
  ) {
    const id = `auth-${name}`;
    const error = state.fieldErrors?.[name]?.[0];
    return (
      <div>
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          {...inputProps(name)}
          type={name === "email" ? "email" : "text"}
          autoComplete={autoComplete}
          autoCapitalize={name === "email" ? "none" : "words"}
          spellCheck={name !== "email"}
          maxLength={name === "email" ? 254 : 80}
          placeholder={name === "email" ? "you@example.com" : undefined}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {error && (
          <p id={`${id}-error`} className="type-meta mt-2 text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (state.status === "success")
    return (
      <div className="space-y-6">
        <AuthMessage message={state.message} tone="success" />
        {mode === "reset" ? (
          <Button asChild className="w-full">
            <Link href="/">
              Continue to NomviraAI
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <p className="type-small text-muted-foreground">
            Check your inbox and spam folder. If nothing arrives after a few
            minutes, you can try again.
          </p>
        )}
        <Link
          href="/login"
          className="type-small inline-flex min-h-11 items-center font-medium"
        >
          Back to sign in
        </Link>
      </div>
    );

  const withOAuth = mode === "login" || mode === "signup";
  const authLink = (path: string) =>
    `${path}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <div>
      <form
        ref={form}
        action={action}
        noValidate
        aria-busy={pending}
        className="space-y-5"
      >
        <input type="hidden" name="next" value={next} />
        {mode === "signup" && (
          <div className="grid gap-5 min-[430px]:grid-cols-2">
            {field("firstName", "First name", "given-name")}
            {field("lastName", "Last name", "family-name")}
          </div>
        )}
        {mode !== "reset" && field("email", "Email", "email")}
        {mode !== "forgot" && (
          <PasswordField
            id="auth-password"
            label={mode === "reset" ? "New password" : "Password"}
            {...inputProps("password")}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            errors={state.fieldErrors?.password}
            hint={mode === "login" ? undefined : "Use at least 8 characters."}
          />
        )}
        {(mode === "signup" || mode === "reset") && (
          <PasswordField
            id="auth-confirm-password"
            label={
              mode === "reset" ? "Confirm new password" : "Confirm password"
            }
            {...inputProps("confirmPassword")}
            autoComplete="new-password"
            errors={state.fieldErrors?.confirmPassword}
          />
        )}
        {mode === "login" && (
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="type-small inline-flex min-h-11 items-center font-medium"
            >
              Forgot password?
            </Link>
          </div>
        )}
        <AuthMessage message={state.message} tone="error" />
        <Button
          type="submit"
          size="lg"
          loading={pending}
          disabled={!configured}
          className="w-full"
        >
          {labels[mode][pending ? 1 : 0]}
        </Button>
        <span className="sr-only" role="status">
          {pending ? labels[mode][1] : ""}
        </span>
      </form>
      {withOAuth && (
        <>
          <div className="my-6 flex items-center gap-4">
            <span className="h-px flex-1 bg-border" />
            <span className="type-meta text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <OAuthButton next={next} disabled={pending || !oauthConfigured} />
        </>
      )}
      <p className="type-small mt-6 text-center text-muted-foreground">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link
              href={authLink("/signup")}
              className="inline-flex min-h-11 items-center font-medium text-foreground"
            >
              Create account
            </Link>
          </>
        ) : mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link
              href={authLink("/login")}
              className="inline-flex min-h-11 items-center font-medium text-foreground"
            >
              Sign in
            </Link>
          </>
        ) : (
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center font-medium text-foreground"
          >
            Back to sign in
          </Link>
        )}
      </p>
    </div>
  );
}
