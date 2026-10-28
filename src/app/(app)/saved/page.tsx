import type { Metadata } from "next";
import { Heart } from "lucide-react";
import { EmptyState } from "@/components/nomvira/empty-state";
import { PageHeader } from "@/components/nomvira/layout/page-header";

export const metadata: Metadata = { title: "Saved" };

export default function SavedPage() {
  return (
    <>
      <PageHeader
        title="Saved"
        description="Keep the places you love a little closer."
      />
      <EmptyState
        icon={Heart}
        title="For your someday list."
        description="Your saved places and travel ideas will appear here. A small collection of possibilities, ready when you are."
      />
    </>
  );
}
