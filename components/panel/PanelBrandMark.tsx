"use client";

import { BRAND_LOGO } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Marca no painel (`BRAND_LOGO.default`) — bolha + confirmação (CRM em dia). Fundo preto mantém contraste no tema claro. */
export function PanelBrandMark({
  size = 36,
  className,
}: {
  /** Largura/altura do bloco (px) */
  size?: number;
  className?: string;
}) {
  const inner = Math.round(size * 0.72);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-panel-xl bg-brand-secondary shadow-[0_12px_28px_rgba(242,68,0,0.18)] ring-1 ring-inset ring-white/12",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- asset estático em /public; evita edge cases do optimizer */}
      <img
        src={BRAND_LOGO.default}
        alt="MyChatCRM"
        width={inner}
        height={inner}
        className="max-h-[88%] max-w-[88%] object-contain"
        decoding="async"
      />
    </div>
  );
}
