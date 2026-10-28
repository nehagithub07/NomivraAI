import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/nomvira/empty-state";
import { PageHeader } from "@/components/nomvira/layout/page-header";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  return (
    <>
      <PageHeader
        title="Explore"
        description="Find a little inspiration for wherever comes next."
      />
      <EmptyState
        icon={Compass}
        title="There’s more out there."
        description="Destination inspiration and places worth a detour are coming soon. Leave a little room for discovery."
      />
    </>
  );
}
