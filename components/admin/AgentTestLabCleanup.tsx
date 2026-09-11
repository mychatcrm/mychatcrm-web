"use client";

import { useCallback, useEffect, useState } from "react";

type Resource = { id: string; resourceType: string; resourceId: string; tenantId: string; cleanupStatus: string; label: string };
const button = "rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * What the run created, and what the owner chooses to undo.
 *
 * Nothing is selected by default and nothing is cleaned automatically. Appointments
 * go out through the same cancellation the agent uses, so Google Calendar and the
 * reminders follow; messages already delivered are never taken back, because they
 * cannot be.
 */
export function AgentTestLabCleanup({ runId, finished }: { runId: string; finished: boolean }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/admin/agent-tests/runs/${runId}/cleanup`, { cache: "no-store", credentials: "same-origin", signal });
    if (!response.ok) return;
    const body = await response.json();
    setResources(Array.isArray(body.resources) ? body.resources : []);
  }, [runId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [load]);

  const pending = resources.filter(resource => resource.cleanupStatus !== "cleaned");

  async function apply() {
    if (!selected.length) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/admin/agent-tests/runs/${runId}/cleanup`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceIds: selected }),
      });
      const body = await response.json().catch(() => ({}));
      setNotice(response.ok
        ? `${body.cleaned ?? 0} limpo(s), ${body.failed ?? 0} requer(em) sua decisão.`
        : `Não foi possível limpar: ${body.code ?? "erro"}.`);
      setSelected([]);
      await load();
    } catch { setNotice("Falha de rede ao limpar."); }
    finally { setBusy(false); }
  }

  return <section className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-4">
    <h3 className="font-semibold">Recursos criados por este teste</h3>
    {resources.length === 0
      ? <p className="mt-2 text-sm text-white/50">Nenhum lead ou compromisso foi atribuído a esta execução.</p>
      : <>
        <ul className="mt-3 space-y-2 text-sm">
          {resources.map(resource => <li key={resource.id} className="flex flex-wrap items-center gap-2">
            <input type="checkbox" disabled={!finished || busy || resource.cleanupStatus === "cleaned"}
              checked={selected.includes(resource.id)}
              onChange={event => setSelected(prev => event.target.checked ? [...prev, resource.id] : prev.filter(id => id !== resource.id))} />
            <span>{resource.label}</span>
            <span className="font-mono text-xs text-white/40">{resource.resourceId.slice(0, 8)}</span>
            <span className="text-xs text-white/45">
              {resource.cleanupStatus === "cleaned" ? "· já limpo"
                : resource.cleanupStatus === "needs_owner_review" ? "· requer sua decisão manual no CRM"
                : resource.cleanupStatus === "failed" ? "· falhou" : ""}
            </span>
          </li>)}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className={button} disabled={!finished || busy || !selected.length} onClick={apply}>
            {busy ? "Limpando…" : `Limpar ${selected.length} selecionado(s)`}
          </button>
          {!finished && <span className="text-xs text-amber-400">Encerre a execução antes de limpar.</span>}
          {finished && pending.length > 0 && !selected.length && <span className="text-xs text-white/45">Marque o que deseja desfazer.</span>}
        </div>
      </>}
    <p className="mt-3 text-xs text-white/40">Mensagens já entregues não são desfeitas. Compromissos são cancelados pelo fluxo normal, sincronizando a agenda.</p>
    {notice && <p role="status" className="mt-2 text-sm text-white/70">{notice}</p>}
  </section>;
}
