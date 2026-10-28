import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/nomvira/empty-state";
import { PageHeader } from "@/components/nomvira/layout/page-header";

export const metadata: Metadata = { title: "Create Trip" };

export default function CreateTripPage() {
  return (
    <>
      <PageHeader
        title="Create Trip"
        description="The beginning of somewhere new."
      />
      <EmptyState
        icon={Plane}
        title="Good journeys take a little preparation."
        description="Trip creation is coming soon. This will be the place to turn your travel ideas into a journey."
        action={
          <Button asChild variant="secondary">
            <Link href="/trips">
              <ArrowLeft aria-hidden="true" />
              Back to My Trips
            </Link>
          </Button>
        }
      />
    </>
  );
}
