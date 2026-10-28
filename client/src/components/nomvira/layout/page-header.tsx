import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-5 md:mb-10">
      <div className="min-w-0 max-w-2xl">
        <h1 className="type-page text-balance wrap-anywhere">{title}</h1>
        {description && (
          <p className="type-body mt-3 max-w-xl text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      )}
    </div>
  );
}
