import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Check your email" };

export default async function VerifyEmailPage() {
  const masked = (await cookies()).get("nomvira-verification-email")?.value;
  return (
    <>
      <span className="mb-6 flex size-12 items-center justify-center rounded-lg bg-accent">
        <Mail className="size-5 text-accent-foreground" aria-hidden="true" />
      </span>
      <h1 className="type-section text-[1.75rem]">Check your email</h1>
      <p className="type-body mt-4 text-muted-foreground">
        If verification is needed, a confirmation link will arrive{" "}
        {masked ? (
          <>
            at{" "}
            <span className="font-medium text-foreground">
              {masked.slice(0, 254)}
            </span>
          </>
        ) : (
          "in your inbox"
        )}
        . Confirm your email to continue to NomviraAI.
      </p>
      <p className="type-small mt-4 text-muted-foreground">
        Check your spam folder too. If you already have an account, you can sign
        in with your existing password.
      </p>
      <Button asChild className="mt-8 w-full">
        <Link href="/login">Return to sign in</Link>
      </Button>
    </>
  );
}
