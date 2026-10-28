import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function AuthMessage({
  message,
  tone = "info",
}: {
  message?: string;
  tone?: "info" | "error" | "success";
}) {
  if (!message) return null;
  const Icon =
    tone === "error" ? CircleAlert : tone === "success" ? CircleCheck : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "type-small flex items-start gap-2.5 rounded-md border bg-surface-secondary px-4 py-3",
        tone === "error" && "border-destructive/25",
        tone === "success" && "border-nomvira-orange/25 bg-accent-card",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4",
          tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <p>{message}</p>
    </div>
  );
}
