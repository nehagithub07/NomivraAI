import Image from "next/image";
import { cn } from "@/lib/utils";

export function NomviraLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap text-[1.375rem] leading-none font-semibold tracking-[-0.055em]",
        className,
      )}
    >
      <span aria-hidden="true" className="relative size-11 shrink-0 overflow-hidden rounded-full">
        <Image
          src="/Logo.png"
          alt=""
          fill
          sizes="66px"
          loading="eager"
          className="scale-150 object-contain"
        />
      </span>
      <span className="inline-flex items-baseline">
        Nomvira<span className="ml-0.5 text-accent-foreground">AI</span>
        <span
          aria-hidden="true"
          className="ml-1 size-1.5 self-end rounded-full bg-nomvira-orange"
        />
      </span>
    </span>
  );
}
