import type { ReactNode } from "react";
import type { Viewport } from "next";
import { AppShell } from "@/components/nomvira/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getUserIdentity } from "@/lib/auth/identity";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function ApplicationLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  return <AppShell identity={getUserIdentity(user)}>{children}</AppShell>;
}
