"use client";

import { usePathname } from "next/navigation";
import { getPageContext } from "@/components/nomvira/navigation/navigation-config";

export function HeaderContext() {
  const pathname = usePathname();
  return (
    <p className="hidden text-sm font-medium lg:block">
      {getPageContext(pathname)}
    </p>
  );
}
