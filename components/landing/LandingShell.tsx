import { cn } from "@/lib/utils";

export function LandingShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("relative", className)}>{children}</div>;
}
