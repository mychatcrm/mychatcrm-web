"use client";

/**
 * Público do disparo — a campanha pode combinar quantos blocos o cliente
 * quiser: filtros do CRM, listas importadas e contatos digitados na hora,
 * repetidos à vontade (3 tags diferentes, uma lista + o CRM inteiro, etc.).
 *
 * Cada bloco resolve pra um conjunto de leads de forma independente:
 * - "crm" é resolvido no servidor no momento de criar a campanha (mesmo
 *   filtro all/tag/funnel_stage de sempre).
 * - "contatos" (import ou manual) já chega com `leadIds` prontos — a rota de
 *   importação roda assim que o cliente confirma o bloco, não só quando a
 *   campanha é criada, pra ele ver na hora quantos contatos entraram.
 *
 * `buildAudienceBlocksPayload` é o que vira `audienceBlocks` no POST da
 * campanha; `estimatePublicoTotal`/`hasUsablePublico` alimentam o aviso de
 * risco e a validação do botão de agendar em DisparosMassaHub.
 */
import { useCallback, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Keyboard, Plus, Trash2, Upload, Users } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { cn } from "@/lib/utils";
import type { CrmFunnel } from "@/lib/crm-funnels";

export type PublicoFiltroCrm = "todos" | "tag" | "etapa" | "dias" | "data";

export type PublicoAudiencePreview = { totalMatched: number; optedIn: number; notOptedIn: number };

export type PublicoCrmBlock = {
  id: string;
  kind: "crm";
  filtro: PublicoFiltroCrm;
  valor: string;
  preview: PublicoAudiencePreview | null;
  previewLoading: boolean;
};

export type PublicoContatosBlock = {
  id: string;
  kind: "contatos";
  origem: "import" | "manual";
  status: "editando" | "pronto";
  rascunhoTexto: string;
  rascunhoOptIn: boolean;
  leadIds: string[];
  resumo: string;
  busy: boolean;
  erro: string | null;
};

export type PublicoBlock = PublicoCrmBlock | PublicoContatosBlock;

function newBlockId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `pub-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createCrmBlock(): PublicoCrmBlock {
  return { id: newBlockId(), kind: "crm", filtro: "todos", valor: "", preview: null, previewLoading: false };
}

export function createContatosBlock(origem: "import" | "manual"): PublicoContatosBlock {
  return {
    id: newBlockId(),
    kind: "contatos",
    origem,
    status: "editando",
    rascunhoTexto: "",
    rascunhoOptIn: false,
    leadIds: [],
    resumo: "",
    busy: false,
    erro: null,
  };
}

export function publicoFiltroToApi(
  filtro: PublicoFiltroCrm,
): "all" | "tag" | "funnel_stage" | "cadastro_dias" | "cadastro_data" {
  if (filtro === "etapa") return "funnel_stage";
  if (filtro === "tag") return "tag";
  if (filtro === "dias") return "cadastro_dias";
  if (filtro === "data") return "cadastro_data";
  return "all";
}

/** Hoje em "AAAA-MM-DD", pro valor inicial do filtro "Data de cadastro". */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** true quando o bloco já tem gente pra receber — bloco em edição não conta. */
function isBlockUsable(block: PublicoBlock): boolean {
  return block.kind === "crm" || (block.status === "pronto" && block.leadIds.length > 0);
}

export function hasUsablePublico(blocks: PublicoBlock[]): boolean {
  return blocks.some(isBlockUsable);
}

/** Estimativa pro aviso de risco — soma otimista, pode contar duas vezes quem está em mais de um bloco (o dedupe de verdade é no servidor). */
export function estimatePublicoTotal(blocks: PublicoBlock[]): number {
  return blocks.reduce((sum, block) => {
    if (block.kind === "crm") return sum + (block.preview?.optedIn ?? 0);
    return sum + (block.status === "pronto" ? block.leadIds.length : 0);
  }, 0);
}

export function buildAudienceBlocksPayload(blocks: PublicoBlock[]) {
  return blocks.filter(isBlockUsable).map((block) =>
    block.kind === "crm"
      ? {
          kind: "crm" as const,
          filter: publicoFiltroToApi(block.filtro),
          value: block.filtro === "todos" ? null : block.valor.trim() || null,
        }
      : { kind: "leads" as const, leadIds: block.leadIds },
  );
}

const CRM_FILTROS: Array<{ id: PublicoFiltroCrm; label: string; hint: string }> = [
  { id: "todos", label: "Base completa", hint: "Todos os leads com opt-in" },
  { id: "tag", label: "Por tag", hint: "Segmentos do CRM Kanban" },
  { id: "etapa", label: "Por funil", hint: "Colunas do CRM Kanban" },
  { id: "dias", label: "Dias no CRM", hint: "Base parada há X dias ou mais" },
  { id: "data", label: "Data de cadastro", hint: "Só quem cadastrou num dia certo" },
];

type UpdateFn = (id: string, patch: Record<string, unknown>) => void;

function BlockShell({
  icon: Icon,
  title,
  onRemove,
  isLight,
  children,
}: {
  icon: typeof Users;
  title: string;
  onRemove: () => void;
  isLight: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        isLight ? "border-slate-200/80 bg-surface-card" : "border-line/70 bg-surface-card/30",
      )}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-content">
          <Icon className="size-4 text-primary" aria-hidden />
          {title}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remover público ${title}`}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-content-secondary transition-colors hover:bg-rose-500/10 hover:text-rose-500"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
      {children}
    </div>
  );
}

function CrmBlockCard({
  block,
  onUpdate,
  onRemove,
  isLight,
  onAfterOptIn,
  funnels,
  availableTags,
}: {
  block: PublicoCrmBlock;
  onUpdate: UpdateFn;
  onRemove: (id: string) => void;
  isLight: boolean;
  onAfterOptIn?: () => void;
  funnels: CrmFunnel[];
  availableTags: string[];
}) {
  const [optInBusy, setOptInBusy] = useState(false);
  const apiType = publicoFiltroToApi(block.filtro);
  const valor = block.valor;
  const id = block.id;

  // Funil sendo navegado na coluna "Por funil" — separado de `valor` (que só
  // guarda o id da coluna) porque trocar de funil pra olhar as colunas dele
  // não deveria depender de já ter escolhido uma coluna antes.
  const [browsingFunnelIdOverride, setBrowsingFunnelIdOverride] = useState<string | null>(null);
  const funnelContainingValue = funnels.find((f) => f.columns.some((c) => c.id === valor));
  const browsingFunnelId = browsingFunnelIdOverride ?? funnelContainingValue?.id ?? funnels[0]?.id ?? "";
  const browsingFunnel = funnels.find((f) => f.id === browsingFunnelId) ?? null;

  const refreshPreview = useCallback(() => {
    if (apiType !== "all" && !valor.trim()) {
      onUpdate(id, { preview: null, previewLoading: false });
      return;
    }
    onUpdate(id, { previewLoading: true });
    const qs = new URLSearchParams({ type: apiType, ...(valor.trim() ? { value: valor.trim() } : {}) });
    fetch(`/api/client/whatsapp-campaigns/audience-preview?${qs.toString()}`)
      .then((r) => r.json())
      .then((data: PublicoAudiencePreview) => onUpdate(id, { preview: data, previewLoading: false }))
      .catch(() => onUpdate(id, { preview: null, previewLoading: false }));
  }, [apiType, valor, id, onUpdate]);

  useEffect(() => {
    const timer = window.setTimeout(refreshPreview, 350);
    return () => window.clearTimeout(timer);
  }, [refreshPreview]);

  const handleBulkOptIn = useCallback(async () => {
    setOptInBusy(true);
    try {
      const res = await fetch("/api/client/whatsapp-campaigns/audience-opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audienceType: apiType, audienceValue: apiType === "all" ? null : valor.trim() }),
      });
      if (res.ok) {
        refreshPreview();
        onAfterOptIn?.();
      }
    } finally {
      setOptInBusy(false);
    }
  }, [apiType, valor, refreshPreview, onAfterOptIn]);

  return (
    <BlockShell icon={Users} title="Base do CRM" onRemove={() => onRemove(id)} isLight={isLight}>
      <div className="grid gap-2 sm:grid-cols-3">
        {CRM_FILTROS.map((opt) => {
          const active = opt.id === block.filtro;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                // Trocar de filtro já deixa um valor válido selecionado — um
                // select vazio (sem opção batendo) é o que fazia parecer que
                // não tinha nada pra escolher.
                if (opt.id === "todos") {
                  onUpdate(id, { filtro: "todos", valor: "" });
                } else if (opt.id === "etapa") {
                  const jaValido = funnels.some((f) => f.columns.some((c) => c.id === block.valor));
                  onUpdate(id, { filtro: "etapa", valor: jaValido ? block.valor : funnels[0]?.columns[0]?.id ?? "" });
                } else if (opt.id === "tag") {
                  const jaValido = availableTags.includes(block.valor);
                  onUpdate(id, { filtro: "tag", valor: jaValido ? block.valor : availableTags[0] ?? "" });
                } else if (opt.id === "dias") {
                  const jaValido = /^\d+$/.test(block.valor);
                  onUpdate(id, { filtro: "dias", valor: jaValido ? block.valor : "30" });
                } else {
                  const jaValido = /^\d{4}-\d{2}-\d{2}$/.test(block.valor);
                  onUpdate(id, { filtro: "data", valor: jaValido ? block.valor : todayIsoDate() });
                }
              }}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left text-xs transition-all",
                active
                  ? "border-primary/60 bg-primary/10"
                  : "border-line bg-surface-card/40 hover:border-primary/35 hover:bg-surface-elevated/30",
              )}
            >
              <div className="font-semibold text-content">{opt.label}</div>
              <div className="mt-0.5 text-[10px] text-content-secondary">{opt.hint}</div>
            </button>
          );
        })}
      </div>
      {block.filtro === "tag" ? (
        availableTags.length > 0 ? (
          <select
            value={block.valor}
            onChange={(e) => onUpdate(id, { valor: e.target.value })}
            className="mt-2.5 h-11 w-full rounded-lg border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
          >
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-2.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
            Nenhuma tag encontrada nos seus leads ainda.
          </p>
        )
      ) : null}
      {block.filtro === "etapa" ? (
        funnels.length > 0 ? (
          <div className="mt-2.5 space-y-2">
            {funnels.length > 1 ? (
              <select
                value={browsingFunnelId}
                onChange={(e) => {
                  const nextFunnel = funnels.find((f) => f.id === e.target.value);
                  setBrowsingFunnelIdOverride(e.target.value);
                  onUpdate(id, { valor: nextFunnel?.columns[0]?.id ?? "" });
                }}
                className="h-11 w-full rounded-lg border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
              >
                {funnels.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={block.valor}
              onChange={(e) => onUpdate(id, { valor: e.target.value })}
              className="h-11 w-full rounded-lg border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
            >
              {(browsingFunnel?.columns ?? []).map((column) => (
                <option key={column.id} value={column.id}>
                  {column.title}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="mt-2.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
            Nenhum funil configurado ainda.
          </p>
        )
      ) : null}
      {block.filtro === "dias" ? (
        <div className="mt-2.5">
          <label className="mb-1 block text-[11px] font-medium text-content-secondary">
            Cadastrados há pelo menos quantos dias?
          </label>
          <input
            type="number"
            min={0}
            value={block.valor}
            onChange={(e) => onUpdate(id, { valor: e.target.value })}
            className="h-11 w-full rounded-lg border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
          />
          <p className="mt-1 text-[10px] text-content-secondary">
            Ex.: 30 pega quem está no CRM há 30 dias ou mais — bom pra resgatar base parada.
          </p>
        </div>
      ) : null}
      {block.filtro === "data" ? (
        <div className="mt-2.5">
          <label className="mb-1 block text-[11px] font-medium text-content-secondary">Cadastrados em que dia?</label>
          <input
            type="date"
            value={block.valor}
            onChange={(e) => onUpdate(id, { valor: e.target.value })}
            className="h-11 w-full rounded-lg border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
          />
        </div>
      ) : null}
      <div
        className={cn(
          "mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
          isLight ? "border-slate-200/80 bg-slate-50/60" : "border-line/70 bg-surface-card/30",
        )}
      >
        <div className="text-[11px] text-content-secondary">
          {block.previewLoading ? (
            "Contando leads…"
          ) : block.preview ? (
            <>
              <strong className="text-content">{block.preview.totalMatched}</strong> lead(s) ·{" "}
              <strong className="text-emerald-500">{block.preview.optedIn}</strong> autorizado(s)
              {block.preview.notOptedIn > 0 ? (
                <>
                  {" "}
                  · <strong className="text-amber-500">{block.preview.notOptedIn}</strong> sem autorização
                </>
              ) : null}
            </>
          ) : (
            "Digite o valor pra ver a contagem."
          )}
        </div>
        {block.preview && block.preview.notOptedIn > 0 ? (
          <Button type="button" variant="secondary" size="sm" onClick={handleBulkOptIn} isLoading={optInBusy}>
            Autorizar todos
          </Button>
        ) : null}
      </div>
    </BlockShell>
  );
}

function ContatosBlockCard({
  block,
  onUpdate,
  onRemove,
  isLight,
}: {
  block: PublicoContatosBlock;
  onUpdate: UpdateFn;
  onRemove: (id: string) => void;
  isLight: boolean;
}) {
  const isManual = block.origem === "manual";
  const id = block.id;

  const handleConfirm = useCallback(async () => {
    if (!block.rascunhoTexto.trim()) return;
    onUpdate(id, { busy: true, erro: null });
    try {
      const res = await fetch("/api/client/whatsapp-campaigns/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: block.rascunhoTexto,
          optIn: block.rascunhoOptIn,
          source: isManual ? "manual_entry" : "csv_import",
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        reused?: number;
        duplicatesInFile?: number;
        invalidCount?: number;
        truncated?: boolean;
        leadIds?: string[];
      };
      if (!res.ok) throw new Error(payload.error ?? "Não foi possível adicionar este público.");

      const leadIds = payload.leadIds ?? [];
      if (leadIds.length === 0) {
        onUpdate(id, { busy: false, erro: "Nenhum telefone válido encontrado." });
        return;
      }
      const partes = [`${leadIds.length} contato(s) pronto(s)`];
      if (payload.reused) partes.push(`${payload.reused} já era(m) do CRM`);
      if (payload.duplicatesInFile) partes.push(`${payload.duplicatesInFile} repetido(s)`);
      if (payload.invalidCount) partes.push(`${payload.invalidCount} inválido(s)`);
      if (payload.truncated) partes.push("lista cortada em 5.000");
      onUpdate(id, { busy: false, status: "pronto", leadIds, resumo: partes.join(" · ") });
    } catch (error) {
      onUpdate(id, { busy: false, erro: error instanceof Error ? error.message : "Falha ao adicionar." });
    }
  }, [block.rascunhoTexto, block.rascunhoOptIn, id, isManual, onUpdate]);

  return (
    <BlockShell
      icon={isManual ? Keyboard : Upload}
      title={isManual ? "Digitar manualmente" : "Importar lista"}
      onRemove={() => onRemove(id)}
      isLight={isLight}
    >
      {block.status === "pronto" ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed",
            isLight
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
          )}
        >
          <span>{block.resumo}.</span>
          <button
            type="button"
            onClick={() => onUpdate(id, { status: "editando" })}
            className="font-medium text-primary hover:underline"
          >
            Editar
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <textarea
            value={block.rascunhoTexto}
            onChange={(e) => onUpdate(id, { rascunhoTexto: e.target.value })}
            placeholder={
              isManual
                ? "Um contato por linha — ex.: Maria Silva, 62991234567"
                : "nome,telefone\nMaria Silva,5562991234567\nJoão Souza,(62) 99765-4321"
            }
            className={cn(
              "w-full resize-y rounded-lg border px-3 py-2.5 font-mono text-xs text-content outline-none",
              isManual ? "min-h-[64px]" : "min-h-[110px]",
              isLight ? "border-slate-200 bg-surface-deep" : "border-line bg-surface-card/40",
            )}
          />
          <p className="text-[11px] leading-relaxed text-content-secondary">
            {isManual
              ? "Bom pra adicionar alguns contatos específicos, sem precisar de arquivo."
              : "Cole do Excel ou de um CSV. Aceita vírgula ou ponto e vírgula, com ou sem cabeçalho."}{" "}
            Contato que já existe no CRM é reaproveitado, não duplicado.
          </p>
          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-content-secondary">
            <input
              type="checkbox"
              checked={block.rascunhoOptIn}
              onChange={(e) => onUpdate(id, { rascunhoOptIn: e.target.checked })}
              className="mt-0.5 size-3.5 shrink-0 accent-primary"
            />
            <span>
              Marcar como autorizados a receber WhatsApp. Só marque se você realmente tem o consentimento — disparo
              pra quem não pediu é o caminho mais rápido pro número ser bloqueado.
            </span>
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleConfirm}
            isLoading={block.busy}
            disabled={!block.rascunhoTexto.trim()}
          >
            Adicionar à campanha
          </Button>
          {block.erro ? (
            <div
              className={cn(
                "rounded-lg border px-3 py-2 text-[11px] leading-relaxed",
                isLight ? "border-red-200 bg-red-50 text-red-900" : "border-red-500/30 bg-red-500/10 text-red-200",
              )}
              role="alert"
            >
              {block.erro}
            </div>
          ) : null}
        </div>
      )}
    </BlockShell>
  );
}

type Props = {
  blocks: PublicoBlock[];
  onChange: Dispatch<SetStateAction<PublicoBlock[]>>;
  isLight: boolean;
  onAfterOptIn?: () => void;
  funnels: CrmFunnel[];
  availableTags: string[];
};

export function DisparosPublicoBuilder({ blocks, onChange, isLight, onAfterOptIn, funnels, availableTags }: Props) {
  const updateBlock = useCallback<UpdateFn>(
    (id, patch) => {
      onChange((prev) => prev.map((block) => (block.id === id ? ({ ...block, ...patch } as PublicoBlock) : block)));
    },
    [onChange],
  );
  const removeBlock = useCallback(
    (id: string) => onChange((prev) => prev.filter((block) => block.id !== id)),
    [onChange],
  );
  const addBlock = useCallback((block: PublicoBlock) => onChange((prev) => [...prev, block]), [onChange]);

  return (
    <div className="space-y-3">
      {blocks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-content-secondary">
          Nenhum público ainda — adicione pelo menos um abaixo.
        </p>
      ) : null}
      {blocks.map((block) =>
        block.kind === "crm" ? (
          <CrmBlockCard
            key={block.id}
            block={block}
            isLight={isLight}
            onUpdate={updateBlock}
            onRemove={removeBlock}
            onAfterOptIn={onAfterOptIn}
            funnels={funnels}
            availableTags={availableTags}
          />
        ) : (
          <ContatosBlockCard key={block.id} block={block} isLight={isLight} onUpdate={updateBlock} onRemove={removeBlock} />
        ),
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => addBlock(createCrmBlock())}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2.5 text-xs font-medium text-content-secondary transition-colors hover:border-primary/45 hover:text-primary"
        >
          <Plus className="size-3.5" aria-hidden /> CRM
        </button>
        <button
          type="button"
          onClick={() => addBlock(createContatosBlock("import"))}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2.5 text-xs font-medium text-content-secondary transition-colors hover:border-primary/45 hover:text-primary"
        >
          <Plus className="size-3.5" aria-hidden /> Importar lista
        </button>
        <button
          type="button"
          onClick={() => addBlock(createContatosBlock("manual"))}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2.5 text-xs font-medium text-content-secondary transition-colors hover:border-primary/45 hover:text-primary"
        >
          <Plus className="size-3.5" aria-hidden /> Digitar manualmente
        </button>
      </div>
    </div>
  );
}
