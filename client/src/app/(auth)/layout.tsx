import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/nomvira/auth/auth-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
