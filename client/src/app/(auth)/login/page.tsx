import type { Metadata } from "next";
import {
  AuthPage,
  type AuthSearchParams,
} from "@/components/nomvira/auth/auth-page";

export const metadata: Metadata = { title: "Sign in" };
export default function LoginPage({
  searchParams,
}: {
  searchParams: AuthSearchParams;
}) {
  return <AuthPage mode="login" searchParams={searchParams} />;
}
