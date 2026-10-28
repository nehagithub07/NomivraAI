import type { Metadata } from "next";
import Link from "next/link";
import { Luggage, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/nomvira/empty-state";
import { PageHeader } from "@/components/nomvira/layout/page-header";

export const metadata: Metadata = { title: "My Trips" };

export default function TripsPage() {
  return (
    <>
      <PageHeader
        title="My Trips"
        description="A place to plan, manage, and revisit your journeys."
      />
      <EmptyState
        icon={Luggage}
        title="Your next chapter is unwritten."
        description="Your planned and completed trips will appear here. Every journey starts with a little curiosity."
        action={
          <Button asChild>
            <Link href="/trips/new">
              <Plus aria-hidden="true" />
              New Trip
            </Link>
          </Button>
        }
      />
    </>
  );
}
