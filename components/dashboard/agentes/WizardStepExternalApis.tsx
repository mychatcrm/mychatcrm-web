"use client";

import { useEffect, useState } from "react";
import { DatabaseZap } from "lucide-react";
import type { AgentWizardDraft } from "@/lib/agents";
import type { ExternalApiConnectorSummary } from "@/lib/external-api/types";

export function WizardStepExternalApis({ draft, onChange }: { draft: AgentWizardDraft; onChange: (draft: AgentWizardDraft) => void }) {
  const [connectors, setConnectors] = useState<ExternalApiConnectorSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    void fetch("/api/client/external-api-connectors", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json(); setConnectors(data.connectors ?? []); setCanManage(data.canManage === true);
    }).catch(() => undefined);
  }, []);
  if (!canManage) return null;
  return <div className="mt-4 rounded-xl border border-line bg-surface-elevated/40 p-4">
    <div className="flex items-center gap-2"><DatabaseZap className="size-4 text-primary"/><strong className="text-sm text-content">APIs para consulta</strong></div>
    <p className="mt-1 text-xs text-content-muted">Somente as APIs marcadas poderão ser consultadas por este agente. Credenciais nunca são enviadas ao modelo.</p>
    <div className="mt-3 space-y-2">{connectors.filter((item) => item.enabled && item.effective).map((connector) => <label key={connector.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3">
      <input type="checkbox" className="mt-1" checked={draft.externalApiConnectorIds.includes(connector.id)} onChange={(event) => onChange({ ...draft, externalApiConnectorIds: event.target.checked ? [...draft.externalApiConnectorIds, connector.id] : draft.externalApiConnectorIds.filter((id) => id !== connector.id) })}/>
      <span><span className="block text-sm font-medium text-content">{connector.name}</span><span className="text-xs text-content-muted">{connector.description || connector.baseUrl}</span></span>
    </label>)}</div>
    {!connectors.length ? <a className="mt-3 inline-block text-sm text-primary" href="/dashboard/integracoes">Cadastre uma API em Integrações</a> : null}
  </div>;
}
