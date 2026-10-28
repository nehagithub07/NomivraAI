import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { NomviraLogo } from "@/components/nomvira/nomvira-logo";
import { SurfaceCard } from "@/components/nomvira/surface-card";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[0.95fr_1.05fr]">
      <aside className="hidden flex-col border-r bg-surface-secondary px-8 py-10 lg:flex xl:px-12">
        <Link
          href="/login"
          aria-label="NomviraAI sign in"
          className="w-fit rounded-sm"
        >
          <NomviraLogo />
        </Link>
        <div className="my-auto py-12">
          <p className="type-meta mb-5 flex items-center gap-2 tracking-[0.12em] text-muted-foreground uppercase">
            <span className="h-px w-6 bg-nomvira-orange" aria-hidden="true" />
            Made for the journey ahead
          </p>
          <h2 className="type-display text-[2.5rem] xl:text-5xl">
            Travel intelligently.
            <br />
            <span className="text-muted-foreground">Adapt as you explore.</span>
          </h2>
          <div className="relative mt-10 aspect-[4/3] max-w-lg overflow-hidden rounded-3xl border">
            <Image
              src="/destinations/kyoto.svg"
              alt=""
              fill
              sizes="(min-width: 1024px) 45vw, 1px"
              className="object-cover"
              preload
            />
          </div>
          <p className="type-body mt-6 max-w-sm text-muted-foreground">
            A thoughtful plan. A little room to wander. A travel companion for
            wherever comes next.
          </p>
        </div>
        <p className="type-meta text-muted-foreground">
          Less noise. More of the world.
        </p>
      </aside>
      <main
        id="main-content"
        className="flex min-w-0 items-center justify-center px-4 py-8 sm:px-6 lg:px-10 lg:py-12"
      >
        <div className="w-full max-w-[440px]">
          <Link
            href="/login"
            aria-label="NomviraAI sign in"
            className="mb-8 inline-flex rounded-sm lg:hidden"
          >
            <NomviraLogo />
          </Link>
          <SurfaceCard size="panel" className="p-6 sm:p-8">
            {children}
          </SurfaceCard>
          <p className="type-meta mt-6 text-center text-muted-foreground">
            Your next chapter starts here.
          </p>
        </div>
      </main>
    </div>
  );
}
