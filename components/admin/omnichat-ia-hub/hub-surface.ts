import { cn } from "@/lib/utils";

/** Shell visual premium (dark futurista) confinado ao hub — não afecta resto do /admin. */
export const hubPageBg = cn(
  "relative min-h-[60vh] rounded-2xl border border-white/[0.08]",
  "bg-[radial-gradient(1200px_600px_at_10%_-10%,rgba(120,119,198,0.18),transparent_55%),radial-gradient(900px_480px_at_100%_0%,rgba(56,189,248,0.08),transparent_50%),linear-gradient(180deg,#0a0a0f_0%,#0c0c12_40%,#09090e_100%)]",
  "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_24px_80px_-24px_rgba(0,0,0,0.75)]",
);

export const hubGlass = cn(
  "rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-xl",
  "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]",
);

export const hubGlowTitle = cn("bg-gradient-to-r from-sky-200 via-violet-200 to-fuchsia-200 bg-clip-text text-transparent");
