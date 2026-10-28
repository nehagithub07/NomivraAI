import type { Metadata } from "next";
import {
  AuthPage,
  type AuthSearchParams,
} from "@/components/nomvira/auth/auth-page";

export const metadata: Metadata = { title: "Reset password" };
export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}) {
  return <AuthPage mode="reset" searchParams={searchParams} />;
}
