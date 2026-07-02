"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type OptInState = {
  whatsapp_opt_in: boolean;
  whatsapp_opt_in_at: string | null;
  whatsapp_opt_in_source: string | null;
  whatsapp_opt_out_at: string | null;
};

export function CrmWhatsAppOptInControl({ leadId }: { leadId: string }) {
  const [value, setValue] = useState<OptInState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/client/crm/leads/${encodeURIComponent(leadId)}/whatsapp-opt-in`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as { optIn?: OptInState; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível consultar o opt-in.");
        if (!cancelled) setValue(payload.optIn ?? null);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Falha ao consultar opt-in.");
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const update = async (enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/client/crm/leads/${encodeURIComponent(leadId)}/whatsapp-opt-in`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled, source: "crm_manual_confirmation" }),
        },
      );
      const payload = (await response.json()) as { optIn?: OptInState; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível atualizar o opt-in.");
      setValue(payload.optIn ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao atualizar opt-in.");
    } finally {
      setBusy(false);
    }
  };

  const enabled = value?.whatsapp_opt_in === true && !value.whatsapp_opt_out_at;
  return (
    <div className="rounded-2xl bg-surface-elevated/35 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", enabled ? "bg-emerald-500/12 text-emerald-500" : "bg-surface-base text-content-muted")}>
            {enabled ? <CheckCircle2 className="size-4" /> : <ShieldCheck className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-content">Consentimento para campanhas WhatsApp</p>
            <p className="mt-0.5 text-xs text-content-muted">
              {enabled
                ? `Opt-in ativo${value?.whatsapp_opt_in_source ? ` · ${value.whatsapp_opt_in_source}` : ""}`
                : "Sem opt-in ativo. Este contato não entra em disparos."}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy || value === null}
          onClick={() => void update(!enabled)}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition-colors disabled:opacity-50",
            enabled
              ? "bg-rose-500/10 text-rose-500 hover:bg-rose-500/15"
              : "bg-primary text-white hover:brightness-110",
          )}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {enabled ? "Revogar opt-in" : "Registrar opt-in"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-500">{error}</p> : null}
    </div>
  );
}
