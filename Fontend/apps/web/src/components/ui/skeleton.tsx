import { cn } from "@ep/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-neutral-200", className)}
      {...props}
    />
  );
}

export { Skeleton };
