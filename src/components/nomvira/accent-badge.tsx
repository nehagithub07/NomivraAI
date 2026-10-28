import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";

export function AccentBadge(
  props: Omit<ComponentProps<typeof Badge>, "variant">,
) {
  return <Badge variant="accent" {...props} />;
}
