import Form from "next/form";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SurfaceCard } from "@/components/nomvira/surface-card";

export function DestinationSearch() {
  return (
    <SurfaceCard className="p-2">
      <Form
        action="/trips/new"
        role="search"
        aria-label="Start a new trip"
        className="flex items-center gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <label htmlFor="dashboard-destination" className="sr-only">
            Where do you want to go?
          </label>
          <Search
            className="pointer-events-none absolute top-4 left-4 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="dashboard-destination"
            name="destination"
            type="search"
            placeholder="Where do you want to go?"
            autoComplete="off"
            maxLength={160}
            className="border-transparent bg-transparent pl-11 md:text-[0.9375rem]"
          />
        </div>
        <Button
          type="submit"
          aria-label="Plan a trip"
          className="h-12 w-12 px-0 sm:w-auto sm:px-5"
        >
          <span className="hidden sm:inline">Plan a trip</span>
          <ArrowRight aria-hidden="true" />
        </Button>
      </Form>
    </SurfaceCard>
  );
}
