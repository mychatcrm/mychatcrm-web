"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { LAB_MODES, LAB_MODE_LABELS, LAB_PROFILES, type LabMode, type LabCheck } from "@/lib/agent-test-lab/contracts";
import { isLabInternalMode } from "@/lib/agent-test-lab/policy";
import { labCodeLabel, LAB_STATUS_LABELS, LAB_VERDICT_LABELS } from "@/lib/agent-test-lab/presentation";
import { AgentTestLabConversation } from "./AgentTestLabConversation";

type Run = { id: string; trace_id: string; mode: LabMode; status: string; verdict: string | null; deployed_sha: string; config_hash: string;
  result_code: string | null; sent_messages: number; max_messages: number; budget_brl: number; spent_brl: number; reserved_brl: number;
  created_at: string; workflow_run_id: number | null };
type Snapshot = { sha: string; sender: { id: string; state: string; number: string | null; updatedAt: string } | null;
  tenants: { id: string; name: string; status: string }[]; agents: { agent_id: string; display_name: string; active: boolean }[];
  connections: { id: string; channel: "evolution" | "meta_cloud"; state: string; number: string | null; slot: number }[];
  rules: { id: string; name: string; active: boolean; connection_id: string; agent_ids: string[] }[];
  runs: Run[]; capabilities: { internal: boolean; modes: Partial<Record<LabMode, boolean>>; realReason: string } };
type Detail = { run: Run; evidence: { check_code: string; verdict: string; description: string; resource_ids: string[] }[];
  steps: { ordinal: number; kind: string; status: string; dispatch_started_at: string | null; confirmed_at: string | null }[];
  costs: { category: string; reserved_brl: number; actual_brl: number | null }[] };
const field = "w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-orange-500";
const button = "rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} bg-orange-600 hover:bg-orange-500 border-orange-500`;
const card = "rounded-2xl border border-white/10 bg-white/[0.025] p-5";
const modeDescription: Record<LabMode, string> = {
  internal: "Regressões, TypeScript e build em runner separado. Não envia WhatsApp.",
  scenarios_10000: "Certificação determinística: dez mil combinações, sem conversa real.",
  scenarios_million: "Um milhão de cenários no GitHub. Pode levar mais tempo.",
  mutation: "Verifica se os testes detectam defeitos introduzidos em uma cópia.",
  simulation: "Decisão do agente sem WhatsApp ou alteração de agenda. Consome IA.",
  manual: "Você escreve pelo número testador e acompanha o atendimento real.",
  scripted: "Mensagens e verificações de um roteiro definido por você.",
  autonomous: "Uma IA representa o lead, com modelo, destino e limites definidos.",
  correction: "Relaciona um problema, testes internos e evidência real ao SHA corrigido.",
};
function money(value: number) { return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/agent-tests${path}`, { ...options, cache: "no-store", credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.code ?? "lab_request_failed");
  return body as T;
}

export function AgentTestLab({ enabled }: { enabled: boolean }) {
  const [unlocked, setUnlocked] = useState(false), [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [tenantId, setTenantId] = useState(""), [agentId, setAgentId] = useState(""), [connectionId, setConnectionId] = useState("");
  const [ruleId, setRuleId] = useState(""), [formId, setFormId] = useState(""), [targetKind, setTargetKind] = useState<"copy" | "original">("copy");
  const [mode, setMode] = useState<LabMode>("internal"), [profile, setProfile] = useState<"short" | "complete" | "custom">("short");
  const [maxMessages, setMaxMessages] = useState(6), [maxMinutes, setMaxMinutes] = useState(20), [budgetBrl, setBudgetBrl] = useState(5);
  const [name, setName] = useState("Validação controlada"), [goal, setGoal] = useState(""), [language, setLanguage] = useState("pt-BR");
  const [script, setScript] = useState(""), [expectSilence, setExpectSilence] = useState(false), [model, setModel] = useState("");
  const [confirmed, setConfirmed] = useState(false), [effects, setEffects] = useState<string[]>([]);
  const [checks, setChecks] = useState<LabCheck[] | null>(null), [qr, setQr] = useState<string | null>(null), [detail, setDetail] = useState<Detail | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const showError = (err: unknown) => { const code = err instanceof Error ? err.message : "lab_failed"; setError(labCodeLabel(code)); if (code === "lab_locked") setUnlocked(false); };
  const reload = useCallback(async (signal?: AbortSignal) => {
    const data = await api<Snapshot>(`/bootstrap${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`, { signal });
    setSnapshot(data);
  }, [tenantId]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    api<{ unlocked: boolean }>("/session", { signal: controller.signal }).then(result => setUnlocked(result.unlocked)).catch(() => {});
    return () => controller.abort();
  }, [enabled]);
  useEffect(() => {
    if (!unlocked) return;
    const controller = new AbortController();
    reload(controller.signal).catch(err => { if (err.name !== "AbortError") showError(err); });
    return () => controller.abort();
  }, [reload, unlocked]);
  useEffect(() => { if (detail) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [detail]);
  async function act(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (err) { showError(err); } finally { setBusy(false); }
  }
  const selectedConnection = snapshot?.connections.find(connection => connection.id === connectionId);
  const selectedAgent = snapshot?.agents.find(agent => agent.agent_id === agentId);
  function requestBody() {
    return { mode, profile, limits: { maxMessages, maxMinutes, budgetBrl }, targetKind, tenantId: tenantId || "internal", agentId: agentId || "internal",
      ruleId: ruleId || null, formId: formId || null, connectionId: connectionId || null, channel: selectedConnection?.channel ?? "evolution",
      testerModel: model || null, allowedEffects: effects, originalConfirmed: confirmed, reuseTestContext: false,
      scenario: { version: 1, name, goal: goal || "Executar a suíte selecionada na versão publicada.", language,
        steps: script.split("\n").filter(line => line.trim()).map(text => ({ kind: "text", text, expected: { type: expectSilence ? "silence" : "reply" } })) } };
  }
  function clearApproval() { setChecks(null); setConfirmed(false); }
  const runnable = Boolean(snapshot?.capabilities.modes?.[mode]);
  const profileLimits = profile === "custom" ? { maxMessages, maxMinutes, budgetBrl } : LAB_PROFILES[profile];
  async function control(run: Run, action: string) {
    await api(`/runs/${run.id}`, { method: "POST", body: JSON.stringify({ action }) }); await reload();
    if (detail?.run.id === run.id) setDetail(await api<Detail>(`/runs/${run.id}`));
  }

  return <div className="mx-auto max-w-7xl space-y-6 p-4 text-white sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-orange-400">Laboratório privado · Proprietário</p>
        <h1 className="mt-2 text-2xl font-semibold">Central de testes dos agentes</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/55">Teste uma correção, acompanhe as evidências e diferencie falha real de bloqueio esperado. O painel não altera código nem prompts.</p></div>
      {unlocked && <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => { if (window.confirm("Parar TODAS as execuções abertas? Mensagens já entregues e compromissos já confirmados não são desfeitos."))
          void act(async () => { const data = await api<{ stopped: number }>("/runs/stop-all", { method: "POST" }); setNotice(`${data.stopped} execução(ões) interrompida(s).`); await reload(); }); }}>Parar todos os testes</button>
        <button className={button} disabled={busy} onClick={() => act(async () => { await api("/session", { method: "DELETE" }); setUnlocked(false); setSnapshot(null); setQr(null); })}>Bloquear central</button>
      </div>}
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">{notice}</div>}
    {!enabled ? <section className={card}><h2 className="font-semibold">Central em preparação</h2><p className="mt-2 text-sm text-white/60">O laboratório está desativado. Os agentes dos clientes continuam usando o fluxo atual.</p></section>
      : !unlocked ? <form className={`${card} max-w-lg space-y-4`} onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void act(async () => { try { await api("/session", { method: "POST", body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) }); setUnlocked(true); } finally { form.reset(); } }); }}>
        <h2 className="font-semibold">Confirme sua identidade</h2><p className="text-sm text-white/55">A central exige uma sessão temporária própria. Sua sessão comum de administrador não autoriza testes ou acesso ao QR.</p>
        <label className="block space-y-1 text-sm"><span>E-mail do proprietário</span><input className={field} name="email" type="email" autoComplete="username" required /></label>
        <label className="block space-y-1 text-sm"><span>Senha</span><input className={field} name="password" type="password" autoComplete="current-password" required /></label>
        <button className={primary} disabled={busy}>{busy ? "Verificando…" : "Desbloquear por 2 horas"}</button>
      </form> : !snapshot ? <p role="status" className="text-sm text-white/60">Carregando laboratório…</p> : <>
      <div className="grid gap-4 md:grid-cols-3">
        <section className={card}><h2 className="text-sm text-white/55">WhatsApp testador</h2><p className="mt-2 font-semibold">{snapshot.sender?.state === "open" ? "Conectado" : "Não conectado"}</p><p className="text-sm text-white/50">{snapshot.sender?.number ?? "Número exclusivo do laboratório"}</p>
          <div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => act(async () => { const data = await api<{ qr: string | null }>("/connection", { method: "POST", body: JSON.stringify({ action: "connect" }) }); setQr(data.qr); await reload(); })}>Conectar / QR</button>
            <button className={button} disabled={busy} onClick={() => act(async () => { await api("/connection", { method: "POST", body: JSON.stringify({ action: "refresh" }) }); await reload(); })}>Verificar</button>
            {snapshot.sender && <button className={button} disabled={busy} onClick={() => { if (window.confirm("Desconectar somente o WhatsApp testador?")) void act(async () => { await api("/connection", { method: "DELETE" }); setQr(null); await reload(); }); }}>Desconectar</button>}</div>
          {qr && <div className="mt-4 rounded-xl bg-white p-4"><Image unoptimized src={qr} alt="QR privado para conectar o WhatsApp testador" width={240} height={240} className="mx-auto" /><button className="mt-2 text-sm text-black" onClick={() => setQr(null)}>Ocultar QR</button></div>}
        </section>
        <section className={card}><h2 className="text-sm text-white/55">Versão em avaliação</h2><p className="mt-2 break-all font-mono text-sm">{snapshot.sha}</p><p className="mt-3 text-sm text-white/50">Um resultado vale apenas para o código, cenário e configuração identificados naquela execução.</p></section>
        <section className={card}><h2 className="text-sm text-white/55">Execuções e consumo</h2>
          <p className="mt-2 text-3xl font-semibold">{snapshot.runs.length}</p>
          <dl className="mt-3 space-y-1 text-sm text-white/60">
            <div className="flex justify-between"><dt>Abertas agora</dt><dd>{snapshot.runs.filter(r => !["completed", "failed", "cancelled"].includes(r.status)).length}</dd></div>
            <div className="flex justify-between"><dt>Falhas confirmadas</dt><dd>{snapshot.runs.filter(r => r.verdict === "failed").length}</dd></div>
            <div className="flex justify-between"><dt>Bloqueios esperados</dt><dd>{snapshot.runs.filter(r => r.verdict === "expected_block").length}</dd></div>
            <div className="flex justify-between"><dt>Inconclusivos</dt><dd>{snapshot.runs.filter(r => r.verdict === "inconclusive").length}</dd></div>
            <div className="flex justify-between"><dt>Mensagens do testador</dt><dd>{snapshot.runs.reduce((total, r) => total + (r.sent_messages ?? 0), 0)}</dd></div>
            <div className="flex justify-between"><dt>Consumo registrado</dt><dd>{money(snapshot.runs.reduce((total, r) => total + Number(r.spent_brl ?? 0), 0))}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-white/45">Inconclusivo e não executado nunca contam como aprovado.</p></section>
      </div>
      <section className={card}><h2 className="mb-4 text-lg font-semibold">1. Escolha a forma de execução</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{LAB_MODES.map(item => <button key={item} aria-pressed={mode === item} onClick={() => { setMode(item); clearApproval(); }}
          className={`rounded-xl border p-4 text-left ${mode === item ? "border-orange-500 bg-orange-500/10" : "border-white/10 hover:border-white/30"}`}>
          <span className="font-medium">{LAB_MODE_LABELS[item]}</span><span className="mt-2 block text-xs leading-relaxed text-white/55">{modeDescription[item]}</span>
          {!snapshot.capabilities.modes?.[item] && <span className="mt-2 block text-xs text-amber-400">
            {isLabInternalMode(item) ? "Runner do GitHub não configurado" : "Em implementação · execução bloqueada"}</span>}</button>)}</div>
      </section>
      {!isLabInternalMode(mode) && <section className={card}><h2 className="mb-4 text-lg font-semibold">2. Agente e destino exatos</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span>Ambiente</span><select className={field} value={targetKind} onChange={e => { setTargetKind(e.target.value as "copy" | "original"); clearApproval(); }}><option value="copy">Cópia isolada (padrão)</option><option value="original">Agente original — exige autorização por execução</option></select></label>
          <label className="space-y-1 text-sm"><span>Cliente / tenant</span><select className={field} value={tenantId} onChange={e => { setTenantId(e.target.value); setAgentId(""); setConnectionId(""); setRuleId(""); clearApproval(); }}><option value="">Selecione</option>{snapshot.tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="space-y-1 text-sm"><span>Agente</span><select className={field} value={agentId} onChange={e => { setAgentId(e.target.value); clearApproval(); }}><option value="">Selecione</option>{snapshot.agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.display_name}{a.active ? "" : " (inativo)"}</option>)}</select></label>
          <label className="space-y-1 text-sm"><span>Conexão e canal</span><select className={field} value={connectionId} onChange={e => { setConnectionId(e.target.value); setRuleId(""); clearApproval(); }}><option value="">Selecione</option>{snapshot.connections.map(c => <option key={c.id} value={c.id}>{c.channel} · {c.number ?? "sem número confirmado"} · {c.state}</option>)}</select></label>
          <label className="space-y-1 text-sm"><span>Regra de entrada</span><select className={field} value={ruleId} onChange={e => { setRuleId(e.target.value); clearApproval(); }}><option value="">Sem regra — somente teste de silêncio</option>{snapshot.rules.filter(r => r.connection_id === connectionId && r.agent_ids?.includes(agentId)).map(r => <option key={r.id} value={r.id}>{r.name}{r.active ? "" : " (inativa)"}</option>)}</select></label>
          <label className="space-y-1 text-sm"><span>Formulário Meta (quando aplicável)</span><input className={field} value={formId} onChange={e => { setFormId(e.target.value); clearApproval(); }} placeholder="ID do formulário autorizado" /></label>
        </div>
        <p className="mt-4 text-sm text-white/50">Destino escolhido: {selectedAgent?.display_name ?? "nenhum agente"} · {selectedConnection?.number ?? "nenhum número"}. O número testador deve ser diferente.</p>
        {targetKind === "original" && <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><p>O original pode gerar efeitos reais. Confirme somente os efeitos permitidos:</p><div className="my-3 flex flex-wrap gap-4">{["lead", "crm", "agenda", "follow_up", "reminder", "notifications", "external_api"].map(effect => <label key={effect}><input type="checkbox" checked={effects.includes(effect)} onChange={e => { setEffects(prev => e.target.checked ? [...prev, effect] : prev.filter(v => v !== effect)); setConfirmed(false); }} /> {effect}</label>)}</div><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Confirmo os efeitos nesta execução e o uso de contato exclusivo de teste.</label></div>}
      </section>}
      <section className={card}><h2 className="mb-4 text-lg font-semibold">{isLabInternalMode(mode) ? "2" : "3"}. Cenário e limites</h2><div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm"><span>Nome da execução</span><input className={field} value={name} onChange={e => setName(e.target.value)} maxLength={150} /></label>
        <label className="space-y-1 text-sm"><span>Perfil</span><select className={field} value={profile} onChange={e => setProfile(e.target.value as typeof profile)}><option value="short">Curto e econômico · 6 mensagens / 20 min / R$ 5</option><option value="complete">Mais completo · 20 mensagens / 60 min / R$ 20</option><option value="custom">Personalizado com limites</option></select></label>
        {profile === "custom" && <>{[["Mensagens", maxMessages, setMaxMessages], ["Minutos", maxMinutes, setMaxMinutes], ["Orçamento (R$)", budgetBrl, setBudgetBrl]].map(([label, value, setter]) => <label className="space-y-1 text-sm" key={String(label)}><span>{String(label)}</span><input type="number" min={1} className={field} value={Number(value)} onChange={e => (setter as (n: number) => void)(Number(e.target.value))} /></label>)}</>}
        <label className="space-y-1 text-sm md:col-span-2"><span>Problema ou objetivo</span><textarea className={field} rows={2} value={goal} onChange={e => setGoal(e.target.value)} placeholder="Qual comportamento deve ser verificado?" maxLength={5000} /></label>
        {!isLabInternalMode(mode) && <><label className="space-y-1 text-sm"><span>Idioma BCP-47</span><input className={field} value={language} onChange={e => setLanguage(e.target.value)} /></label>
          {["autonomous", "simulation"].includes(mode) && <label className="space-y-1 text-sm"><span>Modelo escolhido para esta execução</span><input className={field} value={model} onChange={e => setModel(e.target.value)} placeholder="Selecione o modelo após configurar o provedor" /></label>}
          <label className="space-y-1 text-sm md:col-span-2"><span>Mensagens do roteiro (uma por linha)</span><textarea className={field} rows={4} value={script} onChange={e => setScript(e.target.value)} maxLength={20000} /></label>
          <label className="text-sm"><input type="checkbox" checked={expectSilence} onChange={e => setExpectSilence(e.target.checked)} /> Esperar silêncio por ausência intencional de regra</label></>}
      </div><p className="mt-4 text-xs text-white/50">Limite: {profileLimits.maxMessages} mensagens · {profileLimits.maxMinutes} minutos · {money(profileLimits.budgetBrl)} estimados. Anexos contam como mensagens. Tarifas informadas depois pelo provedor podem alterar o custo final.</p>
        {!runnable && <p className="mt-4 text-sm text-amber-400">{isLabInternalMode(mode) ? "Configure o runner restrito do GitHub antes de iniciar." : labCodeLabel(snapshot.capabilities.realReason)}</p>}
        <div className="mt-5 flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={() => act(async () => { const data = await api<{ checks: LabCheck[] }>("/preflight", { method: "POST", body: JSON.stringify(requestBody()) }); setChecks(data.checks); })}>Verificar pré-requisitos</button>
          <button className={primary} disabled={busy || !runnable} onClick={() => act(async () => { const data = await api<{ ok: boolean; run: Run }>("/runs", { method: "POST", body: JSON.stringify(requestBody()) }); if (data.ok) { setNotice("Execução registrada. O runner trabalha separado da página."); await reload(); } })}>{busy ? "Processando…" : `Iniciar: ${LAB_MODE_LABELS[mode]}`}</button></div>
        {checks && <ul className="mt-4 space-y-2 text-sm">{checks.map(check => <li key={check.code} className={check.ok ? "text-emerald-400" : "text-amber-400"}>{check.ok ? "✓" : "!"} {check.detail}</li>)}</ul>}
      </section>
      <section className={card}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Histórico e evidências</h2><button className={button} disabled={busy} onClick={() => act(() => reload())}>Atualizar lista</button></div>
        {snapshot.runs.length === 0 ? <p className="text-sm text-white/50">Nenhuma execução registrada. Testes reais ainda não foram comprovados por esta central.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-white/50"><tr>{["Execução", "Versão", "Estado", "Resultado", "Consumo", ""].map((label, i) => <th key={i} className="pb-3 pr-4 font-medium">{label}</th>)}</tr></thead><tbody>{snapshot.runs.map(run => <tr key={run.id} className="border-t border-white/10"><td className="py-3 pr-4">{LAB_MODE_LABELS[run.mode]}<span className="block text-xs text-white/40">{new Date(run.created_at).toLocaleString()}</span></td><td className="font-mono">{run.deployed_sha.slice(0, 8)}</td><td>{LAB_STATUS_LABELS[run.status]}</td><td>{run.verdict ? LAB_VERDICT_LABELS[run.verdict] : "Em avaliação"}</td><td>{money(run.spent_brl)}</td><td><button className={button} onClick={() => act(async () => setDetail(await api<Detail>(`/runs/${run.id}`)))}>Abrir relatório</button></td></tr>)}</tbody></table></div>}
      </section>
    </>}
    <dialog ref={dialogRef} onClose={() => setDetail(null)} className="w-[min(900px,95vw)] rounded-2xl border border-white/15 bg-[#151820] p-6 text-white backdrop:bg-black/70">
      {detail && <><div className="flex justify-between gap-4"><h2 className="text-lg font-semibold">Evidências da execução</h2><button className={button} onClick={() => setDetail(null)}>Fechar</button></div>
        <p className="mt-4 text-sm">{detail.run.verdict ? LAB_VERDICT_LABELS[detail.run.verdict] : LAB_STATUS_LABELS[detail.run.status]}</p>
        {detail.run.result_code && <p className="mt-2 text-sm text-white/60">{labCodeLabel(detail.run.result_code)}</p>}
        <p className="mt-3 break-all font-mono text-xs text-white/45">runId: {detail.run.id}<br />traceId: {detail.run.trace_id}<br />SHA: {detail.run.deployed_sha}</p>
        <div className="my-4 flex flex-wrap gap-2">{([
          ["refresh", "Atualizar resultado", true],
          ["pause", "Pausar testador", true],
          ["resume", "Continuar", true],
          ["manual", "Assumir manualmente", !isLabInternalMode(detail.run.mode) && detail.run.mode !== "simulation"],
          ["stop", "Parar teste", true],
        ] as const).filter(([, , shown]) => shown).map(([action, label]) => <button key={action}
          disabled={busy || ["completed", "failed", "cancelled"].includes(detail.run.status)} className={button}
          onClick={() => act(() => control(detail.run, action))}>{label}</button>)}</div>
        <p className="text-xs text-amber-300">Pausa e parada não desfazem mensagens ou compromissos já confirmados. Suítes já disparadas no GitHub podem continuar no runner.</p>
        {!isLabInternalMode(detail.run.mode) && detail.run.mode !== "simulation" && <div className="mt-5">
          <AgentTestLabConversation runId={detail.run.id} status={detail.run.status}
            onSent={() => void act(async () => { await reload(); setDetail(await api<Detail>(`/runs/${detail.run.id}`)); })} />
        </div>}
        <h3 className="mb-2 mt-5 font-semibold">Verificações</h3>{detail.evidence.length ? detail.evidence.map(e => <div key={e.check_code} className="my-2 rounded-xl bg-white/5 p-3 text-sm"><strong>{LAB_VERDICT_LABELS[e.verdict]}</strong> — {e.description}</div>) : <p className="text-sm text-white/50">Ainda não há evidência suficiente para aprovar.</p>}
        {detail.steps.map(step => <p key={step.ordinal} className="my-2 text-sm text-white/55">Etapa {step.ordinal + 1} · {step.kind} · {step.status} · confirmação: {step.confirmed_at ? new Date(step.confirmed_at).toLocaleString() : "não confirmada"}</p>)}
        <div className="mt-5 flex flex-wrap gap-3"><a className={button} href={`/api/admin/agent-tests/runs/${detail.run.id}/export?format=json`}>Exportar JSON</a><a className={button} href={`/api/admin/agent-tests/runs/${detail.run.id}/export?format=csv`}>Exportar CSV</a>
          {detail.run.workflow_run_id && <a className={button} href={`https://github.com/mychatcrm/mychatcrm-web/actions/runs/${detail.run.workflow_run_id}`} target="_blank" rel="noreferrer">Abrir runner</a>}</div>
      </>}
    </dialog>
  </div>;
}
