import { cn } from "@/lib/utils";

export function NomviraLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline text-[1.375rem] leading-none font-semibold tracking-[-0.055em]",
        className,
      )}
    >
      Nomvira<span className="ml-0.5 text-accent-foreground">AI</span>
      <span
        aria-hidden="true"
        className="ml-1 size-1.5 self-end rounded-full bg-nomvira-orange"
      />
    </span>
  );
}
