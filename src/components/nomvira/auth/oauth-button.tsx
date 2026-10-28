"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { startGoogleSignIn } from "@/lib/auth/actions";
import { initialAuthState } from "@/lib/auth/validation";
import { AuthMessage } from "./auth-message";

export function OAuthButton({
  next,
  disabled,
}: {
  next: string;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(
    startGoogleSignIn,
    initialAuthState,
  );
  return (
    <form action={action} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="next" value={next} />
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        loading={pending}
        disabled={disabled}
        className="w-full"
      >
        {pending ? "Connecting to Google…" : "Continue with Google"}
      </Button>
      <AuthMessage message={state.message} tone="error" />
    </form>
  );
}
