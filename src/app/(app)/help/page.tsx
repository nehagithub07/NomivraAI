import type { Metadata } from "next";
import { CircleHelp } from "lucide-react";
import { EmptyState } from "@/components/nomvira/empty-state";
import { PageHeader } from "@/components/nomvira/layout/page-header";

export const metadata: Metadata = { title: "Help" };

export default function HelpPage() {
  return (
    <>
      <PageHeader
        title="Help"
        description="A little direction when you need it."
      />
      <EmptyState
        icon={CircleHelp}
        title="A helping hand is on its way."
        description="Guides and answers to your questions are coming soon. This will be your place for a little extra support."
      />
    </>
  );
}
