import Link from "next/link";
import { Luggage } from "lucide-react";
import { EmptyState } from "@/components/nomvira/empty-state";
import { Button } from "@/components/ui/button";

export default function TripNotFound() {
  return <EmptyState icon={Luggage} title="Trip not found." description="This trip isn't available. You can find your journeys in My Trips."
    action={<Button asChild variant="secondary"><Link href="/trips">Back to My Trips</Link></Button>} />;
}
