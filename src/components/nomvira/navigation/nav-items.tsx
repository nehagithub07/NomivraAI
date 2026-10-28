"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  isNavigationActive,
  primaryNavigation,
  secondaryNavigation,
} from "./navigation-config";

export function NavItems({
  secondary = false,
  mobile = false,
  onNavigate,
}: {
  secondary?: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = secondary ? secondaryNavigation : primaryNavigation;

  return items.map(({ label, mobileLabel, href, icon: Icon }) => {
    const active = isNavigationActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        onClick={onNavigate}
        className={cn(
          "ui-transition relative flex min-w-0 items-center transition-colors",
          mobile
            ? "min-h-16 flex-col justify-center gap-1 px-1 py-2 text-[0.6875rem]"
            : "min-h-12 gap-3 rounded-md px-4 py-3 text-sm",
          active
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
          active && !mobile && "bg-secondary",
          !active && !mobile && "hover:bg-secondary/60",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
        <span>{mobile ? mobileLabel : label}</span>
        {active && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute bg-nomvira-orange",
              mobile
                ? "top-0 h-0.5 w-4 rounded-b-sm"
                : "right-4 size-1.5 rounded-full",
            )}
          />
        )}
      </Link>
    );
  });
}
