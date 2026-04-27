import { cn } from "@/lib/utils";

/** Placeholder leve para secções da landing carregadas sob demanda (reduz JS inicial). */
export function LandingSectionSkeleton({
  className,
  label = "A carregar…",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[200px] w-full animate-pulse items-center justify-center rounded-2xl border border-line/50 bg-surface-deep/35",
        className,
      )}
      aria-busy
      aria-label={label}
    >
      <span className="text-sm text-content-faint/90">{label}</span>
    </div>
  );
}
