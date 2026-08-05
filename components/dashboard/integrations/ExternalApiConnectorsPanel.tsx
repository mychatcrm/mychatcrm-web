"use client";

import { useCallback, useEffect, useState } from "react";
import { DatabaseZap, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Modal } from "@/components/ui/Modal";
import type { ExternalApiConnectorInput, ExternalApiConnectorSummary, ExternalApiOperationInput } from "@/lib/external-api/types";

const emptyOperation = (): ExternalApiOperationInput => ({ operationKey: "consultar", name: "Consultar", description: "Consulta informações na API", method: "GET", pathTemplate: "/", parameters: [], responseMapping: {}, cacheTtlSeconds: 0, enabled: true });
const emptyConnector = (): ExternalApiConnectorInput => ({ name: "", description: "", baseUrl: "https://", authType: "none", enabled: true, operations: [emptyOperation()] });

export function ExternalApiConnectorsPanel() {
  const [items, setItems] = useState<ExternalApiConnectorSummary[]>([]);
  const [capacity, setCapacity] = useState({ used: 0, total: 1, purchased: 0 });
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ExternalApiConnectorSummary | null | "new">(null);
  const [draft, setDraft] = useState<ExternalApiConnectorInput>(emptyConnector);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/client/external-api-connectors", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar as APIs externas.");
    const data = await response.json();
    setItems(data.connectors ?? []); setCapacity(data.capacity ?? { used: 0, total: 1, purchased: 0 }); setCanManage(data.canManage === true);
  }, []);
  useEffect(() => { void load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, [load]);

  const openEditor = (item?: ExternalApiConnectorSummary) => {
    setError(""); setEditing(item ?? "new");
    setDraft(item ? { name: item.name, description: item.description, baseUrl: item.baseUrl, authType: item.authType,
      authHeaderName: item.authHeaderName ?? undefined, authUsername: item.authUsername ?? undefined, enabled: item.enabled,
      operations: item.operations } : emptyConnector());
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      const id = editing && editing !== "new" ? editing.id : null;
      const response = await fetch(id ? `/api/client/external-api-connectors/${id}` : "/api/client/external-api-connectors", {
        method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar a API.");
      setEditing(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Erro ao salvar."); } finally { setBusy(false); }
  };
  const buy = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/client/billing/addons/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addonCode: "api_connector_recurring", quantity: 1 }) });
      const data = await response.json(); if (!response.ok || !data.url) throw new Error(data.error ?? "Checkout indisponível.");
      window.location.assign(data.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Checkout indisponível."); setBusy(false); }
  };

  return <section className="rounded-2xl border border-line bg-surface-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><DatabaseZap className="size-5 text-primary"/><h2 className="font-semibold text-content">APIs externas dos agentes</h2></div>
        <p className="mt-1 text-sm text-content-muted">Conectores REST/JSON universais, somente para consultas. 1 API está incluída em todos os planos.</p></div>
      {canManage ? <div className="flex gap-2"><Button variant="outline" onClick={() => void buy()} disabled={busy}>+ API por R$ 49,90/mês</Button><Button onClick={() => capacity.used < capacity.total ? openEditor() : void buy()}><Plus className="size-4"/>Adicionar API</Button></div> : null}
    </div>
    <div className="mt-4 rounded-xl bg-surface-elevated p-3 text-sm text-content-secondary">Capacidade: <strong>{capacity.used}/{capacity.total}</strong> conectores · {capacity.purchased} extra(s) pago(s)</div>
    {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    {loading ? <div className="mt-5 flex items-center gap-2 text-sm text-content-muted"><Loader2 className="size-4 animate-spin"/>Carregando…</div> :
      <div className="mt-4 grid gap-3">{items.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
        <div><div className="flex items-center gap-2"><strong className="text-content">{item.name}</strong><span className="rounded-full bg-surface-elevated px-2 py-0.5 text-xs text-content-muted">{item.billingStatus === "included" ? "Incluída" : item.effective ? "Extra ativa" : "Suspensa por cobrança"}</span></div>
          <p className="mt-1 text-xs text-content-muted">{item.baseUrl} · {item.operations.length} operação(ões) · {item.agentCount} agente(s)</p></div>
        {canManage ? <div className="flex gap-2"><Button variant="outline" onClick={async () => { const response = await fetch(`/api/client/external-api-connectors/${item.id}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }); const data = await response.json(); alert(response.ok ? `Teste concluído: ${data.data?.records?.length ?? 0} resultado(s).` : `Falha no teste: ${data.errorCode ?? data.error ?? "não identificada"}`); }}>Testar</Button><Button variant="outline" onClick={() => openEditor(item)}>Editar</Button><Button variant="ghost" onClick={async () => { if (!confirm("Remover esta API?")) return; await fetch(`/api/client/external-api-connectors/${item.id}`, { method: "DELETE" }); await load(); }}><Trash2 className="size-4"/></Button></div> : null}
      </div>)}</div>}
    {!canManage ? <p className="mt-4 flex items-center gap-2 text-sm text-content-muted"><ShieldCheck className="size-4"/>Somente o titular da conta pode cadastrar credenciais e contratar capacidade.</p> : null}

    <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Adicionar API externa" : "Editar API externa"} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={() => void save()} isLoading={busy}>Salvar</Button></div>}>
      <div className="space-y-4 text-sm">
        <label className="block">Nome<input className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label>
        <label className="block">Descrição para o agente<textarea className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}/></label>
        <label className="block">URL-base HTTPS<input className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}/></label>
        <label className="block">Autenticação<select className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.authType} onChange={(e) => setDraft({ ...draft, authType: e.target.value as ExternalApiConnectorInput["authType"] })}><option value="none">Sem chave</option><option value="bearer">Bearer</option><option value="api_key">API Key em header</option><option value="basic">Basic</option></select></label>
        {draft.authType === "api_key" ? <label className="block">Nome do header<input className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.authHeaderName ?? "X-Api-Key"} onChange={(e) => setDraft({ ...draft, authHeaderName: e.target.value })}/></label> : null}
        {draft.authType === "basic" ? <label className="block">Usuário<input className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.authUsername ?? ""} onChange={(e) => setDraft({ ...draft, authUsername: e.target.value })}/></label> : null}
        {draft.authType !== "none" ? <label className="block">Segredo {editing !== "new" ? "(deixe vazio para manter)" : ""}<input type="password" autoComplete="new-password" className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.secret ?? ""} onChange={(e) => setDraft({ ...draft, secret: e.target.value })}/></label> : null}
        <div className="space-y-3"><div className="flex justify-between"><strong>Operações de consulta</strong><Button variant="ghost" onClick={() => draft.operations.length < 10 && setDraft({ ...draft, operations: [...draft.operations, emptyOperation()] })}>+ Operação</Button></div>
          {draft.operations.map((operation, index) => <div key={index} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
            <input aria-label="Chave" className="rounded border border-line bg-surface-elevated p-2" value={operation.operationKey} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, operationKey: e.target.value } : o) })}/>
            <input aria-label="Nome" className="rounded border border-line bg-surface-elevated p-2" value={operation.name} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, name: e.target.value } : o) })}/>
            <select className="rounded border border-line bg-surface-elevated p-2" value={operation.method} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, method: e.target.value as "GET" | "POST" } : o) })}><option>GET</option><option>POST</option></select>
            <input aria-label="Caminho" className="rounded border border-line bg-surface-elevated p-2" value={operation.pathTemplate} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, pathTemplate: e.target.value } : o) })}/>
            <textarea aria-label="Descrição da operação" className="rounded border border-line bg-surface-elevated p-2 sm:col-span-2" placeholder="Quando o agente deve usar esta consulta" value={operation.description} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, description: e.target.value } : o) })}/>
            <div className="space-y-2 sm:col-span-2"><div className="flex items-center justify-between text-xs font-semibold"><span>Parâmetros permitidos</span><button type="button" className="text-primary" onClick={() => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: [...o.parameters, { name: "parametro", in: o.method === "GET" ? "query" : "body", type: "string", required: false, description: "" }] } : o) })}>+ Parâmetro</button></div>
              {operation.parameters.map((parameter, parameterIndex) => <div key={parameterIndex} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <input className="rounded border border-line bg-surface-elevated p-2" value={parameter.name} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: o.parameters.map((p,j) => j === parameterIndex ? { ...p, name: e.target.value } : p) } : o) })}/>
                <select className="rounded border border-line bg-surface-elevated p-2" value={parameter.in} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: o.parameters.map((p,j) => j === parameterIndex ? { ...p, in: e.target.value as "path" | "query" | "body" } : p) } : o) })}><option value="path">Path</option><option value="query">Query</option>{operation.method === "POST" ? <option value="body">Body</option> : null}</select>
                <select className="rounded border border-line bg-surface-elevated p-2" value={parameter.type} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: o.parameters.map((p,j) => j === parameterIndex ? { ...p, type: e.target.value as "string" | "number" | "boolean" } : p) } : o) })}><option value="string">Texto</option><option value="number">Número</option><option value="boolean">Sim/não</option></select>
                <label className="flex items-center gap-1"><input type="checkbox" checked={parameter.required} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: o.parameters.map((p,j) => j === parameterIndex ? { ...p, required: e.target.checked } : p) } : o) })}/>Obrigatório</label>
                <button type="button" className="text-danger" onClick={() => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: o.parameters.filter((_,j) => j !== parameterIndex) } : o) })}>Remover</button>
              </div>)}</div>
            <div className="space-y-2 sm:col-span-2"><p className="text-xs font-semibold">Mapeamento da resposta JSON</p><div className="grid gap-2 sm:grid-cols-4">
              {(["itemsPath","id","title","availability","price","currency","link","media"] as const).map((field) => <input key={field} className="rounded border border-line bg-surface-elevated p-2" placeholder={field} value={operation.responseMapping[field] ?? ""} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, responseMapping: { ...o.responseMapping, [field]: e.target.value || undefined } } : o) })}/>)}
            </div></div>
            <label className="text-xs">Cache<select className="ml-2 rounded border border-line bg-surface-elevated p-2" value={operation.cacheTtlSeconds} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, cacheTtlSeconds: Number(e.target.value) as 0 | 30 | 60 | 120 | 300 } : o) })}><option value="0">Desligado</option><option value="30">30s</option><option value="60">60s</option><option value="120">120s</option><option value="300">300s</option></select></label>
            {draft.operations.length > 1 ? <button type="button" className="text-right text-xs text-danger" onClick={() => setDraft({ ...draft, operations: draft.operations.filter((_,i) => i !== index) })}>Remover operação</button> : null}
          </div>)}</div>
      </div>
    </Modal>
  </section>;
}
