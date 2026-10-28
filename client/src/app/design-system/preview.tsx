"use client";

import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CloudSun,
  Compass,
  Heart,
  Hotel,
  Map,
  MapPin,
  Plane,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import { AccentBadge } from "@/components/nomvira/accent-badge";
import { IconButton } from "@/components/nomvira/icon-button";
import { SectionHeading } from "@/components/nomvira/section-heading";
import { SurfaceCard } from "@/components/nomvira/surface-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const palette = [
  {
    label: "Background",
    value: "#F5F5F3",
    token: "--background",
    color: "bg-background",
  },
  { label: "Surface", value: "#FFFFFF", token: "--card", color: "bg-card" },
  {
    label: "Secondary",
    value: "#FAFAF8",
    token: "--surface-secondary",
    color: "bg-surface-secondary",
  },
  { label: "Muted", value: "#F1F1EE", token: "--muted", color: "bg-muted" },
  {
    label: "Ink",
    value: "#111111",
    token: "--foreground",
    color: "bg-foreground",
  },
  {
    label: "Secondary text",
    value: "#6F6F6B",
    token: "--muted-foreground",
    color: "bg-muted-foreground",
  },
  { label: "Border", value: "#E7E7E2", token: "--border", color: "bg-border" },
  {
    label: "Nomvira orange",
    value: "#FF9A62",
    token: "--nomvira-orange",
    color: "bg-nomvira-orange",
  },
];

const icons = [
  { icon: Plane, label: "Plane" },
  { icon: Map, label: "Map" },
  { icon: MapPin, label: "Location" },
  { icon: Hotel, label: "Hotel" },
  { icon: Utensils, label: "Dining" },
  { icon: CalendarDays, label: "Calendar" },
  { icon: Wallet, label: "Wallet" },
  { icon: CloudSun, label: "Weather" },
  { icon: Sparkles, label: "Insights" },
  { icon: Compass, label: "Compass" },
  { icon: Search, label: "Search" },
  { icon: Bell, label: "Notifications" },
  { icon: Settings, label: "Settings" },
  { icon: Heart, label: "Saved" },
  { icon: ArrowRight, label: "Forward" },
  { icon: SlidersHorizontal, label: "Filters" },
];

function SpecLabel({ children }: { children: React.ReactNode }) {
  return <p className="type-meta mt-3 text-muted-foreground">{children}</p>;
}

export function FoundationPreview() {
  const [status, setStatus] = useState(
    "Try a control to preview its interaction.",
  );
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState(false);
  const [travelStyle, setTravelStyle] = useState("");

  return (
    <div className="space-y-12 md:space-y-16">
      <section
        id="foundations"
        aria-labelledby="colors-title"
        className="border-t pt-10 md:pt-12"
      >
        <SectionHeading
          id="colors-title"
          number="01"
          title="A warmer shade of simple."
          description="Quiet neutrals set the scene. A little orange points the way."
          trailing={
            <span className="type-meta text-muted-foreground">
              The color palette
            </span>
          }
        />
        <SurfaceCard size="panel" className="p-4 md:p-6">
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 min-[480px]:grid-cols-4 lg:grid-cols-8">
            {palette.map(({ label, value, token, color }) => (
              <div key={token}>
                <div
                  aria-hidden="true"
                  className={cn(
                    "mb-3 h-20 rounded-md border border-foreground/5 md:h-24",
                    color,
                  )}
                />
                <p className="type-small font-medium">{label}</p>
                <p className="type-meta mt-0.5 text-muted-foreground">
                  {value}
                </p>
                <span className="sr-only">CSS token {token}</span>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>

      <section aria-labelledby="type-title">
        <SectionHeading
          id="type-title"
          number="02"
          title="Clarity in every character."
          description="Geist Sans. An understated voice with a clear sense of direction."
          trailing={
            <span className="type-meta text-muted-foreground">Typography</span>
          }
        />
        <SurfaceCard
          size="panel"
          className="grid overflow-hidden lg:grid-cols-[0.8fr_1.7fr]"
        >
          <div className="flex flex-col justify-between gap-8 border-b bg-surface-secondary p-6 md:p-8 lg:border-r lg:border-b-0">
            <div>
              <p className="type-meta text-muted-foreground">OUR TYPEFACE</p>
              <p
                aria-hidden="true"
                className="mt-4 text-[6rem] leading-none font-medium tracking-[-0.075em] md:text-[8rem]"
              >
                Aa<span className="text-nomvira-orange">.</span>
              </p>
            </div>
            <div>
              <p className="type-card">Geist Sans</p>
              <p className="type-small mt-1 text-muted-foreground">
                Regular · Medium · Semibold
              </p>
              <p className="type-meta mt-4 max-w-56 text-muted-foreground">
                Comfortable to read. Confident without raising its voice.
              </p>
            </div>
          </div>
          <div className="divide-y px-6 md:px-8">
            <div className="py-6">
              <p className="type-meta mb-3 text-muted-foreground">
                Display / 36–60
              </p>
              <p className="type-display">Go a little further.</p>
            </div>
            <div className="grid gap-2 py-5 sm:grid-cols-[8rem_1fr] sm:items-baseline">
              <p className="type-meta text-muted-foreground">Page / 32–40</p>
              <p className="type-page">Your next chapter</p>
            </div>
            <div className="grid gap-2 py-5 sm:grid-cols-[8rem_1fr] sm:items-baseline">
              <p className="type-meta text-muted-foreground">Section / 22–24</p>
              <p className="type-section">Worth the detour</p>
            </div>
            <div className="grid gap-2 py-5 sm:grid-cols-[8rem_1fr] sm:items-baseline">
              <p className="type-meta text-muted-foreground">Card / 18</p>
              <p className="type-card">Somewhere you&apos;ll love</p>
            </div>
            <div className="grid gap-2 py-5 sm:grid-cols-[8rem_1fr] sm:items-baseline">
              <p className="type-meta text-muted-foreground">Body / 14–15</p>
              <p className="type-body">
                Good journeys leave room for the unexpected.
              </p>
            </div>
            <div className="grid gap-2 py-5 sm:grid-cols-[8rem_1fr] sm:items-baseline">
              <p className="type-meta text-muted-foreground">Supporting / 13</p>
              <p className="type-small text-muted-foreground">
                A few thoughtful details make all the difference.
              </p>
            </div>
            <div className="grid gap-2 py-5 sm:grid-cols-[8rem_1fr] sm:items-baseline">
              <p className="type-meta text-muted-foreground">Metadata / 12</p>
              <p className="type-meta text-muted-foreground">
                Kyoto, Japan · 6 days · A slower pace
              </p>
            </div>
          </div>
        </SurfaceCard>
      </section>

      <section id="components" aria-labelledby="controls-title">
        <SectionHeading
          id="controls-title"
          number="03"
          title="Small details. Effortless interactions."
          description="Familiar controls, considered proportions, and a clear next step."
          trailing={
            <span className="type-meta text-muted-foreground">
              Buttons & inputs
            </span>
          }
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <SurfaceCard size="panel">
            <CardHeader>
              <CardTitle>Actions, with intention</CardTitle>
              <CardDescription>
                One primary action. Everything else in balance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-x-5 gap-y-6 min-[400px]:grid-cols-2">
                <div>
                  <Button
                    onClick={() =>
                      setStatus(
                        "Primary button pressed. This is a visual preview.",
                      )
                    }
                  >
                    Plan my trip <ArrowRight aria-hidden="true" />
                  </Button>
                  <SpecLabel>Primary</SpecLabel>
                </div>
                <div>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setStatus(
                        "Secondary button pressed. This is a visual preview.",
                      )
                    }
                  >
                    View details <ArrowUpRight aria-hidden="true" />
                  </Button>
                  <SpecLabel>Secondary</SpecLabel>
                </div>
                <div>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setStatus(
                        "Ghost button pressed. This is a visual preview.",
                      )
                    }
                  >
                    Explore more <ChevronRight aria-hidden="true" />
                  </Button>
                  <SpecLabel>Ghost</SpecLabel>
                </div>
                <div>
                  <Button
                    variant="destructive"
                    onClick={() =>
                      setStatus(
                        "Destructive style previewed. No data has been removed.",
                      )
                    }
                  >
                    <X aria-hidden="true" />
                    Remove example
                  </Button>
                  <SpecLabel>Destructive</SpecLabel>
                </div>
                <div>
                  <Button disabled>Not available</Button>
                  <SpecLabel>Disabled</SpecLabel>
                </div>
                <div>
                  <Button loading>Loading example</Button>
                  <SpecLabel>Loading</SpecLabel>
                </div>
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
                <div>
                  <p className="type-small font-medium">A quiet accent</p>
                  <p className="type-meta mt-1 text-muted-foreground">
                    Reserved for a helpful recommendation.
                  </p>
                </div>
                <Button
                  variant="accent"
                  size="sm"
                  onClick={() =>
                    setStatus(
                      "Accent button pressed. This is a visual preview.",
                    )
                  }
                >
                  <Sparkles aria-hidden="true" />
                  Nomvira Pick
                </Button>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-6">
                <IconButton
                  aria-label={saved ? "Unsave example" : "Save example"}
                  aria-pressed={saved}
                  onClick={() => {
                    setSaved(!saved);
                    setStatus(
                      saved
                        ? "Example unsaved."
                        : "Example saved. Preview only.",
                    );
                  }}
                  className={
                    saved
                      ? "border-nomvira-orange bg-accent text-accent-foreground"
                      : undefined
                  }
                >
                  <Heart
                    aria-hidden="true"
                    className={saved ? "fill-current" : undefined}
                  />
                </IconButton>
                <IconButton
                  aria-label="Preview notification button"
                  onClick={() =>
                    setStatus(
                      "Notification button pressed. No notifications in this preview.",
                    )
                  }
                >
                  <Bell aria-hidden="true" />
                </IconButton>
                <IconButton
                  aria-label="Preview settings button"
                  variant="ghost"
                  onClick={() =>
                    setStatus(
                      "Settings button pressed. No settings in this preview.",
                    )
                  }
                >
                  <Settings aria-hidden="true" />
                </IconButton>
                <span className="type-meta text-muted-foreground">
                  Circular, when it makes sense.
                </span>
              </div>
              <p
                role="status"
                aria-live="polite"
                className="type-meta mt-5 min-h-10 text-muted-foreground"
              >
                {status}
              </p>
            </CardContent>
          </SurfaceCard>

          <SurfaceCard size="panel">
            <CardHeader>
              <CardTitle>A place for every detail</CardTitle>
              <CardDescription>
                Light surfaces, helpful labels, and room to type.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <Label htmlFor="trip-name">Trip name</Label>
                <Input
                  id="trip-name"
                  placeholder="A week of little discoveries"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="destination-search">Search</Label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute top-4 left-4 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="destination-search"
                    type="search"
                    placeholder="Somewhere you’ve always wanted to go"
                    className="pl-11"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="travel-style">Travel style</Label>
                <Select value={travelStyle} onValueChange={setTravelStyle}>
                  <SelectTrigger id="travel-style">
                    <SelectValue placeholder="Find your pace" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="slow">Slow & unhurried</SelectItem>
                    <SelectItem value="balanced">
                      A little of everything
                    </SelectItem>
                    <SelectItem value="adventure">
                      Room for adventure
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="travel-notes">
                  A little more about your journey
                </Label>
                <Textarea
                  id="travel-notes"
                  placeholder="Early morning walks, small cafés, a day with no plans…"
                  aria-describedby="notes-hint"
                />
                <p
                  id="notes-hint"
                  className="type-meta mt-2 text-muted-foreground"
                >
                  Just an example. Nothing here is submitted or stored.
                </p>
              </div>
            </CardContent>
          </SurfaceCard>
        </div>
      </section>

      <section aria-labelledby="details-title">
        <SectionHeading
          id="details-title"
          number="04"
          title="Helpful signals. Nothing extra."
          description="Small cues that add meaning without adding noise."
          trailing={
            <span className="type-meta text-muted-foreground">
              Badges & iconography
            </span>
          }
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <SurfaceCard size="panel" className="p-6">
            <h3 className="type-card">A little context at a glance</h3>
            <div className="mt-6 flex flex-wrap gap-3">
              <AccentBadge>
                <Sparkles aria-hidden="true" />
                AI Pick
              </AccentBadge>
              <Badge>Best Value</Badge>
              <Badge variant="outline">Budget Friendly</Badge>
              <Badge variant="default">Premium</Badge>
              <Badge variant="outline">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-foreground"
                />
                Open Now
              </Badge>
            </div>
            <p className="type-small mt-6 text-muted-foreground">
              A shared neutral palette. Warm emphasis for the occasional Nomvira
              recommendation.
            </p>
          </SurfaceCard>
          <SurfaceCard size="panel" className="p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="type-card">Simple lines. A shared language.</h3>
              <span className="type-meta text-muted-foreground">
                Lucide / 1.65 stroke
              </span>
            </div>
            <div className="mt-6 grid grid-cols-8 gap-x-2 gap-y-5">
              {icons.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  role="img"
                  aria-label={label}
                  title={label}
                  className="flex min-h-6 items-center justify-center text-muted-foreground"
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
              ))}
            </div>
          </SurfaceCard>
        </div>
      </section>

      <section id="cards" aria-labelledby="cards-title">
        <SectionHeading
          id="cards-title"
          number="05"
          title="Space for what matters."
          description="One flexible surface system. Four ways to give content a home."
          trailing={
            <span className="type-meta text-muted-foreground">
              Cards & surfaces
            </span>
          }
        />
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <div className="flex flex-col">
            <SurfaceCard className="flex-1 p-6">
              <div className="mb-8 flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-lg bg-muted">
                  <Plane className="size-5" aria-hidden="true" />
                </span>
                <span className="type-meta text-muted-foreground">JAPAN</span>
              </div>
              <h3 className="type-card">Tokyo Adventure</h3>
              <p className="type-small mt-2 text-muted-foreground">
                New streets. Familiar wonder.
              </p>
              <div className="type-meta mt-6 flex flex-wrap items-center gap-2 border-t pt-4 text-muted-foreground">
                <CalendarDays className="size-3.5" aria-hidden="true" />
                <span>Apr 12 – Apr 18</span>
                <span aria-hidden="true">·</span>
                <span>6 days</span>
              </div>
            </SurfaceCard>
            <SpecLabel>Standard / white surface</SpecLabel>
          </div>
          <div className="flex flex-col">
            <SurfaceCard
              variant="interactive"
              className={cn("flex flex-1", selected && "border-nomvira-orange")}
            >
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => setSelected(!selected)}
                className="flex w-full flex-col rounded-xl p-6 text-left focus-visible:outline-offset-4"
              >
                <div className="mb-8 flex w-full items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-lg bg-muted">
                    <MapPin className="size-5" aria-hidden="true" />
                  </span>
                  {selected ? (
                    <Check
                      className="size-4 text-accent-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <ArrowUpRight
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <span className="type-card">A quieter side of Kyoto</span>
                <p className="type-small mt-2 text-muted-foreground">
                  Little lanes and unhurried afternoons.
                </p>
                <span className="type-meta mt-6 flex w-full items-center gap-2 border-t pt-4 font-medium">
                  {selected ? "Example selected" : "Select this example"}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </span>
              </button>
            </SurfaceCard>
            <SpecLabel>Interactive / hover or focus</SpecLabel>
          </div>
          <div className="flex flex-col">
            <SurfaceCard variant="muted" className="flex-1 p-6">
              <div className="mb-8 flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-lg border bg-card">
                  <CloudSun className="size-5" aria-hidden="true" />
                </span>
                <span className="type-meta text-muted-foreground">
                  TAKE IT SLOW
                </span>
              </div>
              <h3 className="type-card">Room to wander</h3>
              <p className="type-small mt-2 text-muted-foreground">
                The best part of a journey can be the space between plans.
              </p>
              <p className="type-meta mt-6 border-t pt-4 text-muted-foreground">
                A softer surface for supporting details.
              </p>
            </SurfaceCard>
            <SpecLabel>Muted / secondary surface</SpecLabel>
          </div>
          <div className="flex flex-col">
            <SurfaceCard variant="accent" className="flex-1 p-6">
              <div className="mb-8 flex min-h-11 items-center">
                <AccentBadge>
                  <Sparkles aria-hidden="true" />
                  Nomvira Pick
                </AccentBadge>
              </div>
              <h3 className="type-card">A little closer to it all.</h3>
              <p className="type-small mt-2 text-muted-foreground">
                This hotel is close to 4 activities already included in your
                itinerary.
              </p>
              <p className="type-meta mt-6 border-t border-nomvira-orange/20 pt-4 text-accent-foreground">
                A thoughtful suggestion, just for you.
              </p>
            </SurfaceCard>
            <SpecLabel>AI insight / soft accent surface</SpecLabel>
          </div>
        </div>
        <p id="card-notes" className="type-meta mt-5 text-muted-foreground">
          Illustrative content only. These are reusable visual examples, with no
          travel features connected.
        </p>
      </section>

      <section id="principles" aria-labelledby="principles-title">
        <SectionHeading
          id="principles-title"
          number="06"
          title="Considered, down to the details."
          description="A few simple rules keep the experience feeling like one place."
          trailing={
            <span className="type-meta text-muted-foreground">
              System principles
            </span>
          }
        />
        <SurfaceCard
          size="panel"
          className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0"
        >
          <div className="min-w-0 p-6">
            <p className="type-meta mb-4 text-muted-foreground">01 / SPACE</p>
            <h3 className="type-card">Let it breathe.</h3>
            <p className="type-small mt-2 text-muted-foreground">
              A 4px rhythm, generous gutters, and space for each element to do
              its job.
            </p>
            <div className="mt-6 flex h-8 items-end gap-2" aria-hidden="true">
              {[
                "w-1 h-2",
                "w-2 h-3",
                "w-3 h-4",
                "w-4 h-5",
                "w-6 h-6",
                "w-8 h-8",
              ].map((size) => (
                <span
                  key={size}
                  className={cn("rounded-sm bg-border-strong", size)}
                />
              ))}
            </div>
            <p className="type-meta mt-3 text-muted-foreground">
              4 · 8 · 12 · 16 · 20 · 24 · 32 · 40
              <br />
              48 · 64 · 80 · 96
            </p>
          </div>
          <div className="min-w-0 p-6">
            <p className="type-meta mb-4 text-muted-foreground">02 / SHAPE</p>
            <h3 className="type-card">Soft, with purpose.</h3>
            <p className="type-small mt-2 text-muted-foreground">
              Gentle corners create warmth. Larger surfaces earn a little more
              curve.
            </p>
            <div
              className="mt-6 flex h-8 items-center gap-3"
              aria-hidden="true"
            >
              <span className="size-8 rounded-md border border-border-strong" />
              <span className="h-8 w-12 rounded-xl border border-border-strong" />
              <span className="h-8 w-16 rounded-2xl border border-border-strong" />
            </div>
            <p className="type-meta mt-3 text-muted-foreground">
              Controls 12–14 · Cards 18 · Panels 24–28
            </p>
          </div>
          <div className="min-w-0 p-6">
            <p className="type-meta mb-4 text-muted-foreground">03 / FEEL</p>
            <h3 className="type-card">Quietly responsive.</h3>
            <p className="type-small mt-2 text-muted-foreground">
              Subtle transitions, clear keyboard focus, and motion that respects
              your preferences.
            </p>
            <div
              className="mt-6 flex h-8 items-center gap-3"
              aria-hidden="true"
            >
              <span className="h-px w-16 bg-border-strong" />
              <span className="size-2 rounded-full bg-nomvira-orange" />
              <span className="h-px w-8 bg-border-strong" />
            </div>
            <p className="type-meta mt-3 text-muted-foreground">
              180ms ease-out · Maximum lift 2px
            </p>
          </div>
        </SurfaceCard>
      </section>
    </div>
  );
}
