import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  id?: string;
  number?: string;
  title: string;
  description?: string;
  trailing?: ReactNode;
  className?: string;
};

export function SectionHeading({
  id,
  number,
  title,
  description,
  trailing,
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-wrap items-end justify-between gap-4",
        className,
      )}
    >
      <div>
        <div className="flex items-center gap-3">
          {number && (
            <span
              aria-hidden="true"
              className="type-meta font-medium tabular-nums text-muted-foreground"
            >
              {number}
            </span>
          )}
          <h2 id={id} className="type-section">
            {title}
          </h2>
        </div>
        {description && (
          <p className="type-small mt-2 max-w-xl text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {trailing}
    </div>
  );
}
