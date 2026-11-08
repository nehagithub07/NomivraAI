import Link from "next/link";
export default function SharedTripNotFound() {
  return <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-6 py-12"><h1 className="type-page">This shared trip is unavailable</h1><p className="text-sm text-muted-foreground">The link may have expired or been revoked. Ask the trip owner for a new link.</p><Link href="/login" className="inline-flex min-h-11 items-center font-medium underline">Sign in to NomviraAI</Link></main>;
}
