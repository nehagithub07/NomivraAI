"use client";
import { Button } from "@/components/ui/button";
export default function SharedTripError({ reset }: { reset: () => void }) {
  return <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-6 py-12"><h1 className="type-page">The shared trip couldn’t load</h1><p className="text-sm text-muted-foreground">The service is temporarily unavailable. Try again in a moment.</p><div><Button onClick={reset}>Try again</Button></div></main>;
}
