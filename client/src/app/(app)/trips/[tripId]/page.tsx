import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Luggage } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/nomvira/empty-state";
import { PageHeader } from "@/components/nomvira/layout/page-header";
import { mockTripDestinations } from "@/lib/mock/dashboard";

type TripPageProps = { params: Promise<{ tripId: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return mockTripDestinations.map(({ id }) => ({ tripId: id }));
}

export async function generateMetadata({
  params,
}: TripPageProps): Promise<Metadata> {
  const { tripId } = await params;
  const trip = mockTripDestinations.find(({ id }) => id === tripId);
  return { title: trip ? `${trip.destination} trip` : "Trip not found" };
}

export default async function TripPlaceholderPage({ params }: TripPageProps) {
  const { tripId } = await params;
  const trip = mockTripDestinations.find(({ id }) => id === tripId);
  if (!trip) notFound();
  return (
    <>
      <PageHeader
        title={`${trip.destination}, ${trip.country}`}
        description="A little space for your journey to take shape."
      />
      <EmptyState
        icon={Luggage}
        title="Your journey, all in one place."
        description="This is a sample trip. Your planning workspace is coming soon."
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
