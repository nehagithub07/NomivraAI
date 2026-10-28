import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/nomvira/empty-state";
import { PageHeader } from "@/components/nomvira/layout/page-header";

export const metadata: Metadata = { title: "AI Companion" };

export default function CompanionPage() {
  return (
    <>
      <PageHeader
        title="AI Companion"
        description="A thoughtful travel companion, wherever you’re headed."
      />
      <EmptyState
        icon={Sparkles}
        title="A little guidance for the journey."
        description="Your AI travel companion is coming soon. This space will bring your travel questions and ideas together."
      />
    </>
  );
}
