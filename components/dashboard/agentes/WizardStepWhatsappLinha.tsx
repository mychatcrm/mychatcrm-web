"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Smartphone } from "lucide-react";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import {
  readWhatsAppSlotMethods,
  totalWhatsAppLinesForTenant,
  WHATSAPP_CONNECTION_UPDATED_EVENT,
} from "@/lib/whatsapp-connection-storage";
import { WHATSAPP_EXTRAS_UPDATED_EVENT } from "@/lib/whatsapp-extra-numbers-storage";
import { cn } from "@/lib/utils";
import type { AgentWizardDraft } from "@/lib/agents";

function lineLabel(index: number, extrasPurchased: number): string {
  if (index === 0) return "Linha 1 — número incluído no plano";
  return `Linha ${index + 1} — número extra (${index} de ${extrasPurchased})`;
}

export function WizardStepWhatsappLinha({
  tenantId,
  draft,
  onChange,
}: {
  tenantId: string;
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
}) {
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const bump = () => setRev((n) => n + 1);
    window.addEventListener(WHATSAPP_CONNECTION_UPDATED_EVENT, bump);
    window.addEventListener(WHATSAPP_EXTRAS_UPDATED_EVENT, bump);
    return () => {
      window.removeEventListener(WHATSAPP_CONNECTION_UPDATED_EVENT, bump);
      window.removeEventListener(WHATSAPP_EXTRAS_UPDATED_EVENT, bump);
    };
  }, []);

  const totalLines = useMemo(() => {
    void rev;
    return totalWhatsAppLinesForTenant(tenantId);
  }, [rev, tenantId]);

  const methods = useMemo(() => {
    void rev;
    return readWhatsAppSlotMethods(tenantId);
  }, [rev, tenantId]);

  const maxIdx = Math.max(0, totalLines - 1);
  const safeIdx = Math.min(Math.max(0, Math.floor(draft.whatsappSlotIndex)), maxIdx);

  const extrasPurchased = Math.max(0, totalLines - 1);
  const options = useMemo(
    () =>
      Array.from({ length: totalLines }, (_, i) => ({
        value: String(i),
        label: lineLabel(i, extrasPurchased),
        hint: methods[i] === "qr" ? " — QR" : methods[i] === "meta" ? " — API Meta" : " — não ligada",
      })),
    [extrasPurchased, methods, totalLines],
  );

  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface-elevated/25 px-3 py-4 sm:px-4",
        "space-y-3",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-content-muted [&_svg]:h-[18px] [&_svg]:w-[18px]" aria-hidden>
          <Smartphone strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-content">Número WhatsApp do agente</p>
          <p className="text-xs leading-relaxed text-content-muted">
            Escolha qual linha contratada este agente utiliza. Cada linha liga-se em{" "}
            <Link href="/dashboard/integracoes#canal-whatsapp" className="font-medium text-primary underline-offset-2 hover:underline">
              Integrações → WhatsApp
            </Link>{" "}
            (QR ou API oficial — uma opção por linha).
          </p>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-content-faint" htmlFor="agent-wa-slot-select">
          Linha
        </label>
        <Select
          id="agent-wa-slot-select"
          className="mt-1.5 min-h-[44px]"
          value={String(safeIdx)}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value, 10);
            if (Number.isNaN(v)) return;
            onChange({ ...draft, whatsappSlotIndex: Math.min(Math.max(0, v), maxIdx) });
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.hint}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
