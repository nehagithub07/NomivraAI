import type { Metadata } from "next";
import {
  AuthPage,
  type AuthSearchParams,
} from "@/components/nomvira/auth/auth-page";

export const metadata: Metadata = { title: "Forgot password" };
export default function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}) {
  return <AuthPage mode="forgot" searchParams={searchParams} />;
}
