import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconButtonProps = Omit<ButtonProps, "size" | "asChild"> & {
  "aria-label": string;
};

export function IconButton({
  className,
  variant = "secondary",
  ...props
}: IconButtonProps) {
  return (
    <Button
      size="icon"
      variant={variant}
      className={cn("rounded-full", className)}
      {...props}
    />
  );
}
