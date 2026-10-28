import type { Metadata } from "next";
import {
  AuthPage,
  type AuthSearchParams,
} from "@/components/nomvira/auth/auth-page";

export const metadata: Metadata = { title: "Create account" };
export default function SignupPage({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}) {
  return <AuthPage mode="signup" searchParams={searchParams} />;
}
