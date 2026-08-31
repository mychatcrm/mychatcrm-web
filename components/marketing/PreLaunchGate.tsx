"use client";

import { useEffect, useState } from "react";
import { PreLaunchLeadModal } from "./PreLaunchLeadModal";

/**
 * Intercepta clique em qualquer elemento marcado `data-lead-gate` (contato
 * WhatsApp/e-mail, ou botão de assinar plano) e mostra o popup de captura em
 * vez de deixar a ação original acontecer — enquanto `enabled` for `true`.
 *
 * Um listener global em fase de CAPTURA (roda antes do handler do próprio
 * elemento, inclusive antes do <Link> do Next navegar) em vez de editar
 * cada botão com onClick — desligar é só não renderizar isto (flag lido
 * server-side em app/[locale]/layout.tsx).
 */
export function PreLaunchGate({ enabled }: { enabled: boolean }) {
  const [source, setSource] = useState<"contact" | "buy" | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const gated = target.closest("[data-lead-gate]");
      if (!gated) return;
      event.preventDefault();
      event.stopPropagation();
      const reason = gated.getAttribute("data-lead-gate");
      setSource(reason === "buy" ? "buy" : "contact");
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [enabled]);

  if (!enabled) return null;

  return <PreLaunchLeadModal open={source !== null} source={source} onClose={() => setSource(null)} />;
}
