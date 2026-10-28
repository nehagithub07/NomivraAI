import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { EmptyState } from "@/components/nomvira/empty-state";
import { PageHeader } from "@/components/nomvira/layout/page-header";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Make a little space for your preferences."
      />
      <EmptyState
        icon={Settings}
        title="Travel, on your terms."
        description="Your account and travel preferences will live here. Settings are coming soon."
      />
    </>
  );
}
