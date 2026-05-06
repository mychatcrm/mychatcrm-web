"use client";

import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { hubGlass } from "@/components/admin/omnichat-ia-hub/hub-surface";
import { cn } from "@/lib/utils";
import type { OpenAiAccountPayload, OpenAiEndpointName, OpenAiEndpointStatus } from "@/components/admin/ai/ia-admin-types";
import { endpointTitle, formatUsd } from "@/components/admin/ai/ia-admin-types";
import { OPENAI_POLL_MS } from "@/components/admin/omnichat-ia-hub/constants";

type Props = {
  openAi: OpenAiAccountPayload | null;
  openAiLoading: boolean;
  openAiErr: string | null;
  lastOpenAiSync: string | null;
  liveSync: boolean;
  onToggleLiveSync: () => void;
  onRefreshOpenAi: () => void;
};

export function HubOpenAiPanel({
  openAi,
  openAiLoading,
  openAiErr,
  lastOpenAiSync,
  liveSync,
  onToggleLiveSync,
  onRefreshOpenAi,
}: Props) {
  const endpointRows = openAi?.endpointStatus
    ? (Object.entries(openAi.endpointStatus) as [OpenAiEndpointName, OpenAiEndpointStatus][])
    : [];
  const showBilling403Info =
    openAi?.configured && openAi.connectivityOk === true && openAi.billingApiAccess === "forbidden_project_key";
  const usageSubtitle =
    openAi?.usageDataSource === "organization_costs"
      ? "Organization Costs API"
      : openAi?.usageUnit === "cents_normalized"
        ? "USD (centavos normalizados)"
        : "Billing legado / mês UTC";

  return (
    <section className={cn(hubGlass, "p-5 sm:p-6")}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">OpenAI Platform</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">Conta oficial · billing</h2>
          <p className="mt-1 max-w-2xl text-xs text-zinc-400">
            Dados da API de billing OpenAI. Distinto da telemetria interna de consumo do OmniChat.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" type="button" className="border-white/10 bg-white/5 text-zinc-200" onClick={onToggleLiveSync}>
            {liveSync ? "Pausar sync" : "Retomar sync"}
          </Button>
          <Button variant="secondary" type="button" className="border-white/10 bg-white/5 text-zinc-200" disabled={openAiLoading} onClick={onRefreshOpenAi}>
            {openAiLoading ? "…" : "Atualizar"}
          </Button>
        </div>
      </div>
      <p className="mb-3 text-[10px] text-zinc-500">
        {liveSync ? `Sync ${OPENAI_POLL_MS / 1000}s · ` : null}
        {lastOpenAiSync ? `Última: ${lastOpenAiSync}` : null}
      </p>
      {openAiErr ? <p className="mb-2 text-sm text-rose-400">{openAiErr}</p> : null}
      {!openAi && openAiLoading ? <div className="h-20 animate-pulse rounded-xl bg-white/5" /> : null}
      {openAi && !openAi.configured ? (
        <p className="text-sm text-amber-200/90">Sem chave para consultar a API OpenAI neste painel.</p>
      ) : null}
      {openAi?.configured && showBilling403Info ? (
        <div className="mb-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100">
          Billing legado 403 (comum com <code className="text-[10px]">sk-proj-*</code>). Use <code className="text-[10px]">OPENAI_ADMIN_API_KEY</code> para custos agregados.
        </div>
      ) : null}
      {openAi?.configured ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Crédito disponível" value={openAi.credits?.totalAvailableUsd != null ? formatUsd(openAi.credits.totalAvailableUsd) : "—"} />
          <Metric label="Uso / concedido" value={openAi.credits?.totalUsedUsd != null && openAi.credits?.totalGrantedUsd != null ? `${formatUsd(openAi.credits.totalUsedUsd)} / ${formatUsd(openAi.credits.totalGrantedUsd)}` : "—"} />
          <Metric label="Limites hard/soft" value={openAi.subscription?.hardLimitUsd != null ? formatUsd(openAi.subscription.hardLimitUsd) : "—"} />
          <Metric label={openAi.usagePeriodLabel ?? "Uso período"} value={openAi.usagePeriodUsd != null ? formatUsd(openAi.usagePeriodUsd) : "—"} sub={usageSubtitle} />
        </div>
      ) : null}
      {endpointRows.length > 0 ? (
        <details className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
          <summary className="cursor-pointer font-medium text-zinc-300">Diagnóstico HTTP</summary>
          <ul className="mt-2 space-y-1">
            {endpointRows.map(([k, st]) => (
              <li key={k}>
                {endpointTitle(k)} · {st.httpStatus} {st.ok ? "ok" : "falhou"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-zinc-100">{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-zinc-500">{sub}</p> : null}
    </div>
  );
}
