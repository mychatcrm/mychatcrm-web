import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-gradient-to-r from-line/50 via-line/70 to-line/50 bg-[length:200%_100%]",
        className,
      )}
      aria-hidden
    />
  );
}
