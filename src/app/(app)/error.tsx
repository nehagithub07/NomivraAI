"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/nomvira/surface-card";
export default function AppError({ reset }: { reset: () => void }) {
  return <SurfaceCard size="panel" className="space-y-5 p-6 sm:p-8"><h1 className="type-page">Your workspace couldn’t load</h1><p className="text-sm text-muted-foreground">Your saved travel plans are safe. Try again, or return to your trips.</p><div className="flex flex-wrap gap-3"><Button onClick={reset}>Try again</Button><Button asChild variant="secondary"><Link href="/trips">My trips</Link></Button></div></SurfaceCard>;
}
