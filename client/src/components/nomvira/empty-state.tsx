import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { SurfaceCard } from "./surface-card";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <SurfaceCard
      size="panel"
      className="flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center md:min-h-96 md:py-16"
    >
      <span className="mb-6 flex size-14 items-center justify-center rounded-xl bg-accent">
        <Icon className="size-6 text-accent-foreground" aria-hidden="true" />
      </span>
      <h2 className="type-section max-w-md text-balance">{title}</h2>
      <p className="type-body mt-3 max-w-sm text-pretty text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </SurfaceCard>
  );
}
