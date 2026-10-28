import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUpRight, Compass } from "lucide-react";
import { NomviraLogo } from "@/components/nomvira/nomvira-logo";
import { PageContainer } from "@/components/nomvira/page-container";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { Badge } from "@/components/ui/badge";
import { FoundationPreview } from "./preview";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

export default function DesignSystemPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <>
      <a
        href="#main-content"
        className="sr-only fixed top-4 left-4 z-50 rounded-md bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>
      <header className="border-b bg-background">
        <PageContainer className="flex min-h-24 flex-wrap items-center justify-between gap-x-6 gap-y-3 py-5">
          <a
            href="#overview"
            aria-label="NomviraAI design system overview"
            className="rounded-sm"
          >
            <NomviraLogo />
          </a>
          <nav
            aria-label="Design system"
            className="order-3 flex w-full gap-6 md:order-none md:w-auto md:gap-8"
          >
            <a
              href="#foundations"
              className="type-small ui-transition inline-flex min-h-11 items-center text-muted-foreground transition-colors hover:text-foreground"
            >
              Foundations
            </a>
            <a
              href="#components"
              className="type-small ui-transition inline-flex min-h-11 items-center text-muted-foreground transition-colors hover:text-foreground"
            >
              Components
            </a>
            <a
              href="#principles"
              className="type-small ui-transition inline-flex min-h-11 items-center text-muted-foreground transition-colors hover:text-foreground"
            >
              Principles
            </a>
          </nav>
          <Badge variant="outline" className="gap-2 bg-transparent font-normal">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-nomvira-orange"
            />
            Foundation v0.1
          </Badge>
        </PageContainer>
      </header>

      <main id="main-content">
        <PageContainer>
          <section
            id="overview"
            aria-labelledby="preview-title"
            className="grid gap-8 pt-12 pb-12 md:pt-16 md:pb-16 lg:grid-cols-[1.6fr_1fr] lg:items-end lg:gap-16"
          >
            <div>
              <p className="type-meta mb-5 flex items-center gap-2 font-medium tracking-[0.12em] uppercase">
                <span
                  aria-hidden="true"
                  className="h-px w-6 bg-nomvira-orange"
                />
                NomviraAI / Design system
              </p>
              <h1 id="preview-title" className="type-display max-w-3xl">
                A considered start.
                <br />
                <span className="text-muted-foreground">A world ahead.</span>
              </h1>
              <p className="type-body mt-6 max-w-md text-muted-foreground">
                The visual foundation for a calmer kind of travel. Thoughtful
                details, warm neutrals, and room to breathe.
              </p>
              <a
                href="#foundations"
                className="type-small mt-6 inline-flex min-h-11 items-center gap-2 font-medium"
              >
                Explore the foundation{" "}
                <ArrowDown className="size-4" aria-hidden="true" />
              </a>
            </div>
            <SurfaceCard size="panel" className="p-6 md:p-8">
              <div className="mb-6 flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-lg bg-accent">
                  <Compass
                    className="size-5 text-accent-foreground"
                    aria-hidden="true"
                  />
                </span>
                <span className="type-meta text-muted-foreground">
                  01 / THE FOUNDATION
                </span>
              </div>
              <h2 className="type-card">
                Intelligent travel. Human by design.
              </h2>
              <p className="type-small mt-2 text-muted-foreground">
                A shared language for every journey to come. Built to feel
                clear, quiet, and unmistakably Nomvira.
              </p>
              <div className="mt-6 flex items-center justify-between border-t pt-4">
                <span className="type-meta text-muted-foreground">
                  Light, by intention
                </span>
                <div
                  className="flex gap-1.5"
                  role="img"
                  aria-label="Warm neutral palette with orange accent"
                >
                  {[
                    "bg-background",
                    "bg-secondary",
                    "bg-border-strong",
                    "bg-foreground",
                    "bg-nomvira-orange",
                  ].map((color) => (
                    <span
                      key={color}
                      className={`size-4 rounded-full border border-foreground/5 ${color}`}
                    />
                  ))}
                </div>
              </div>
            </SurfaceCard>
          </section>

          <FoundationPreview />

          <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t py-8">
            <div className="flex flex-wrap items-center gap-4">
              <NomviraLogo className="text-base" />
              <span className="type-meta text-muted-foreground">
                Made for the journey ahead.
              </span>
            </div>
            <a
              href="#overview"
              className="type-meta inline-flex min-h-11 items-center gap-2 text-muted-foreground"
            >
              Back to the beginning{" "}
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
          </footer>
        </PageContainer>
      </main>
    </>
  );
}
