"use client";

import { useCallback, useEffect, useState } from "react";
import { DatabaseZap, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { Modal } from "@/components/ui/Modal";
import { createStandardExternalApiOperations } from "@/lib/external-api/standard-contract";
import type { ExternalApiConnectorInput, ExternalApiConnectorSummary, ExternalApiOperationInput } from "@/lib/external-api/types";
import type { ExternalApiConnectorCard, IntegrationsDashboardSnapshotV1 } from "@/lib/integrations/dashboard-snapshot";

type ExternalApiConnectorDraft = ExternalApiConnectorInput & { operations: ExternalApiOperationInput[] };

const emptyOperation = (): ExternalApiOperationInput => ({ operationKey: "consultar", name: "Consultar", description: "Consulta informações na API", method: "GET", pathTemplate: "/", parameters: [], responseMapping: {}, cacheTtlSeconds: 0, enabled: true });
const usesStandardContract = (operations: ExternalApiOperationInput[]) => {
  const signature = (operation: ExternalApiOperationInput) => `${operation.operationKey}:${operation.method}:${operation.pathTemplate}`;
  const expected = createStandardExternalApiOperations().map(signature);
  return operations.length === expected.length && operations.every((operation, index) => signature(operation) === expected[index]);
};
const emptyConnector = (): ExternalApiConnectorDraft => ({ name: "", description: "", baseUrl: "https://", authType: "none", enabled: true, operations: createStandardExternalApiOperations() });

/** Explicação em português pro código de erro técnico — sem isto, a única pista era um alert() com "json_required". */
const ERROR_EXPLANATIONS: Record<string, string> = {
  json_required: "a URL respondeu, mas o conteúdo não é um JSON válido.",
  invalid_json: "a resposta dizia ser JSON, mas veio quebrada.",
  too_many_redirects: "a URL redirecionou demais (mais de 3 vezes) antes de chegar numa resposta final.",
  invalid_redirect: "a URL redirecionou para um endereço inválido.",
  https_required: "o endereço de destino não é HTTPS.",
  private_network_blocked: "o endereço aponta para uma rede privada/interna — bloqueado por segurança.",
  timeout: "a API não respondeu a tempo (mais de 8 segundos).",
  response_too_large: "a resposta da API é grande demais (acima de 512 KB).",
  network_error: "não foi possível conectar a esse endereço (DNS ou rede).",
  read_only_method_required: "a operação está configurada com um método diferente de GET.",
  host_mismatch: "o caminho da operação aponta pra um endereço diferente da URL-base.",
  missing_argument: "faltou preencher um parâmetro obrigatório da operação.",
  missing_path_argument: "faltou preencher um parâmetro usado no caminho da operação.",
  not_available: "esta API está desativada ou suspensa por cobrança.",
  agent_not_linked: "esta API não está vinculada a nenhum agente.",
  operation_not_found: "a operação não existe ou está desativada.",
  rate_limit: "o limite de chamadas por minuto desta API foi atingido — tente de novo em instantes.",
  credentials_unavailable: "a chave/credencial desta API não está configurada.",
};

function explainExternalApiError(errorCode?: string | null, httpStatus?: number | null): string {
  if (!errorCode) return "erro não identificado.";
  if (errorCode.startsWith("http_")) {
    const status = httpStatus ?? errorCode.slice(5);
    return `a URL respondeu com o erro HTTP ${status} — confira se o caminho e a URL-base estão certos.`;
  }
  return ERROR_EXPLANATIONS[errorCode] ?? `erro "${errorCode}".`;
}

function fmtHealthAt(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

type SnapshotBackedConnector = ExternalApiConnectorSummary & { operationCount: number; detailsLoaded: boolean };

function fromSnapshot(item: ExternalApiConnectorCard): SnapshotBackedConnector {
  return {
    ...item,
    credentialMask: null,
    operations: [],
    operationCount: item.operationCount,
    detailsLoaded: false,
  };
}

export function ExternalApiConnectorsPanel({
  initialData,
  canManage: initialCanManage,
}: {
  initialData: IntegrationsDashboardSnapshotV1["externalApis"];
  canManage: boolean;
}) {
  const [items, setItems] = useState<SnapshotBackedConnector[]>(() => initialData.connectors.map(fromSnapshot));
  const [capacity, setCapacity] = useState(initialData.capacity);
  const [canManage, setCanManage] = useState(initialCanManage);
  const [editing, setEditing] = useState<ExternalApiConnectorSummary | null | "new">(null);
  const [draft, setDraft] = useState<ExternalApiConnectorDraft>(emptyConnector);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<SnapshotBackedConnector[]> => {
    const response = await fetch("/api/client/external-api-connectors", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar as APIs externas.");
    const data = await response.json();
    const next = ((data.connectors ?? []) as ExternalApiConnectorSummary[]).map((item) => ({
      ...item,
      operationCount: item.operations.length,
      detailsLoaded: true,
    }));
    setItems(next); setCapacity(data.capacity ?? { used: 0, total: 1, purchased: 0, included: 1 }); setCanManage(data.canManage === true);
    return next;
  }, []);

  useEffect(() => {
    setItems(initialData.connectors.map(fromSnapshot));
    setCapacity(initialData.capacity);
    setCanManage(initialCanManage);
  }, [initialCanManage, initialData]);

  const openEditor = async (item?: SnapshotBackedConnector) => {
    let editable = item;
    if (item && !item.detailsLoaded) {
      try {
        editable = (await load()).find((candidate) => candidate.id === item.id) ?? item;
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os detalhes da API.");
        return;
      }
    }
    setError(""); setEditing(item ?? "new");
    setAdvanced(editable ? !usesStandardContract(editable.operations) : false);
    setDraft(editable ? { name: editable.name, description: editable.description, baseUrl: editable.baseUrl, authType: editable.authType,
      authHeaderName: editable.authHeaderName ?? undefined, authUsername: editable.authUsername ?? undefined, enabled: editable.enabled,
      operations: editable.operations } : emptyConnector());
    if (editable) setEditing(editable);
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      const id = editing && editing !== "new" ? editing.id : null;
      const payload = advanced ? draft : { ...draft, description: "", operations: createStandardExternalApiOperations() };
      const response = await fetch(id ? `/api/client/external-api-connectors/${id}` : "/api/client/external-api-connectors", {
        method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
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
      {canManage ? <div className="flex gap-2"><Button variant="outline" onClick={() => void buy()} disabled={busy}>+ API por R$ 49,90/mês</Button><Button onClick={() => capacity.used < capacity.total ? void openEditor() : void buy()}><Plus className="size-4"/>Adicionar API</Button></div> : null}
    </div>
    <div className="mt-4 rounded-xl bg-surface-elevated p-3 text-sm text-content-secondary">Capacidade: <strong>{capacity.used}/{capacity.total}</strong> conectores · {capacity.purchased} extra(s) pago(s)</div>
    {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    <div className="mt-4 grid gap-3">{items.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
        <div><div className="flex items-center gap-2"><strong className="text-content">{item.name}</strong><span className="rounded-full bg-surface-elevated px-2 py-0.5 text-xs text-content-muted">{item.billingStatus === "included" ? "Incluída" : item.effective ? "Extra ativa" : "Suspensa por cobrança"}</span></div>
          <p className="mt-1 text-xs text-content-muted">{item.baseUrl} · {item.operationCount} operação(ões) · {item.agentCount} agente(s)</p>
          {item.healthStatus === "error" ? (
            <p className="mt-1 text-xs text-danger">Última chamada falhou{item.lastHealthAt ? ` (${fmtHealthAt(item.lastHealthAt)})` : ""}: {explainExternalApiError(item.lastErrorCode)}</p>
          ) : item.healthStatus === "healthy" ? (
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">Funcionando{item.lastHealthAt ? ` — último teste ${fmtHealthAt(item.lastHealthAt)}` : ""}</p>
          ) : (
            <p className="mt-1 text-xs text-content-muted">Ainda não testada — clique em &quot;Testar&quot;.</p>
          )}</div>
        {canManage ? <div className="flex gap-2"><Button variant="outline" onClick={async () => { const response = await fetch(`/api/client/external-api-connectors/${item.id}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }); const data = await response.json(); alert(response.ok ? `Teste concluído: ${data.data?.records?.length ?? 0} resultado(s).` : `Falha no teste: ${explainExternalApiError(data.errorCode, data.httpStatus)}`); await load(); }}>Testar</Button><Button variant="outline" onClick={() => void openEditor(item)}>Editar</Button><Button variant="ghost" onClick={async () => { if (!confirm("Remover esta API?")) return; await fetch(`/api/client/external-api-connectors/${item.id}`, { method: "DELETE" }); await load(); }}><Trash2 className="size-4"/></Button></div> : null}
      </div>)}</div>
    {!canManage ? <p className="mt-4 flex items-center gap-2 text-sm text-content-muted"><ShieldCheck className="size-4"/>Somente o titular da conta pode cadastrar credenciais e contratar capacidade.</p> : null}

    <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Adicionar API externa" : "Editar API externa"} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={() => void save()} isLoading={busy}>Salvar</Button></div>}>
      <div className="space-y-4 text-sm">
        <label className="block">Nome<input className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label>
        <label className="block">URL-base HTTPS<input className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}/></label>
        <label className="block">Autenticação<select className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.authType} onChange={(e) => setDraft({ ...draft, authType: e.target.value as ExternalApiConnectorInput["authType"] })}><option value="none">Sem chave</option><option value="bearer">Bearer</option><option value="api_key">API Key em header</option><option value="basic">Basic</option></select></label>
        {draft.authType === "api_key" ? <label className="block">Nome do header<input className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.authHeaderName ?? "X-Api-Key"} onChange={(e) => setDraft({ ...draft, authHeaderName: e.target.value })}/></label> : null}
        {draft.authType === "basic" ? <label className="block">Usuário<input className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.authUsername ?? ""} onChange={(e) => setDraft({ ...draft, authUsername: e.target.value })}/></label> : null}
        {draft.authType !== "none" ? <label className="block">Segredo {editing !== "new" ? "(deixe vazio para manter)" : ""}<input type="password" autoComplete="new-password" className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.secret ?? ""} onChange={(e) => setDraft({ ...draft, secret: e.target.value })}/></label> : null}
        <div className="rounded-lg border border-line bg-surface-elevated p-3">
          <button type="button" className="flex w-full items-center justify-between text-left" aria-expanded={advanced} onClick={() => setAdvanced((current) => !current)}><span><strong>Modo avançado</strong><span className="mt-0.5 block text-xs text-content-muted">Opcional: use apenas quando a API não seguir o contrato padrão.</span></span><span aria-hidden>{advanced ? "−" : "+"}</span></button>
        </div>
        {advanced ? <><label className="block">Descrição para o agente<textarea className="mt-1 w-full rounded-lg border border-line bg-surface-elevated p-2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}/></label>
        <div className="space-y-3"><div className="flex justify-between"><strong>Operações de consulta</strong><Button variant="ghost" onClick={() => draft.operations.length < 10 && setDraft({ ...draft, operations: [...draft.operations, emptyOperation()] })}>+ Operação</Button></div>
          {draft.operations.map((operation, index) => <div key={index} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
            <input aria-label="Chave" className="rounded border border-line bg-surface-elevated p-2" value={operation.operationKey} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, operationKey: e.target.value } : o) })}/>
            <input aria-label="Nome" className="rounded border border-line bg-surface-elevated p-2" value={operation.name} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, name: e.target.value } : o) })}/>
            <div className="rounded border border-line bg-surface-elevated p-2 text-sm">GET · somente consulta</div>
            <input aria-label="Caminho" className="rounded border border-line bg-surface-elevated p-2" value={operation.pathTemplate} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, pathTemplate: e.target.value } : o) })}/>
            <textarea aria-label="Descrição da operação" className="rounded border border-line bg-surface-elevated p-2 sm:col-span-2" placeholder="Quando o agente deve usar esta consulta" value={operation.description} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, description: e.target.value } : o) })}/>
            <div className="space-y-2 sm:col-span-2"><div className="flex items-center justify-between text-xs font-semibold"><span>Parâmetros permitidos</span><button type="button" className="text-primary" onClick={() => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: [...o.parameters, { name: "parametro", in: "query", type: "string", required: false, description: "" }] } : o) })}>+ Parâmetro</button></div>
              {operation.parameters.map((parameter, parameterIndex) => <div key={parameterIndex} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <input className="rounded border border-line bg-surface-elevated p-2" value={parameter.name} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: o.parameters.map((p,j) => j === parameterIndex ? { ...p, name: e.target.value } : p) } : o) })}/>
                <select className="rounded border border-line bg-surface-elevated p-2" value={parameter.in} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: o.parameters.map((p,j) => j === parameterIndex ? { ...p, in: e.target.value as "path" | "query" } : p) } : o) })}><option value="path">Path</option><option value="query">Query</option></select>
                <select className="rounded border border-line bg-surface-elevated p-2" value={parameter.type} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: o.parameters.map((p,j) => j === parameterIndex ? { ...p, type: e.target.value as "string" | "number" | "boolean" } : p) } : o) })}><option value="string">Texto</option><option value="number">Número</option><option value="boolean">Sim/não</option></select>
                <label className="flex items-center gap-1"><input type="checkbox" checked={parameter.required} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: o.parameters.map((p,j) => j === parameterIndex ? { ...p, required: e.target.checked } : p) } : o) })}/>Obrigatório</label>
                <button type="button" className="text-danger" onClick={() => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, parameters: o.parameters.filter((_,j) => j !== parameterIndex) } : o) })}>Remover</button>
              </div>)}</div>
            <div className="space-y-2 sm:col-span-2"><p className="text-xs font-semibold">Mapeamento da resposta JSON</p><div className="grid gap-2 sm:grid-cols-4">
              {(["itemsPath","id","title","availability","price","currency","link","media"] as const).map((field) => <input key={field} className="rounded border border-line bg-surface-elevated p-2" placeholder={field} value={operation.responseMapping[field] ?? ""} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, responseMapping: { ...o.responseMapping, [field]: e.target.value || undefined } } : o) })}/>)}
            </div></div>
            <label className="text-xs">Cache<select className="ml-2 rounded border border-line bg-surface-elevated p-2" value={operation.cacheTtlSeconds} onChange={(e) => setDraft({ ...draft, operations: draft.operations.map((o,i) => i === index ? { ...o, cacheTtlSeconds: Number(e.target.value) as 0 | 30 | 60 | 120 | 300 } : o) })}><option value="0">Desligado</option><option value="30">30s</option><option value="60">60s</option><option value="120">120s</option><option value="300">300s</option></select></label>
            {draft.operations.length > 1 ? <button type="button" className="text-right text-xs text-danger" onClick={() => setDraft({ ...draft, operations: draft.operations.filter((_,i) => i !== index) })}>Remover operação</button> : null}
          </div>)}</div></> : <p className="text-xs text-content-muted">O MyChatCRM usará automaticamente lista, busca e detalhe e normalizará a resposta JSON.</p>}
      </div>
    </Modal>
  </section>;
}
