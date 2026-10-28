"use client";

import { RefreshCw, Luggage } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/nomvira/empty-state";

export default function TripsError({ reset }: { reset: () => void }) {
  return <EmptyState icon={Luggage} title="Your trips couldn't be loaded." description="Please try again in a moment."
    action={<Button onClick={reset}><RefreshCw aria-hidden="true" />Try again</Button>} />;
}
