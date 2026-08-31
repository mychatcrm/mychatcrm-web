"use client";

/**
 * Público do disparo — três origens, nada além disso: base do CRM, lista
 * importada de arquivo e contatos digitados na hora. A campanha combina
 * quantos blocos quiser.
 *
 * O bloco de CRM é um fluxo de duas perguntas, na ordem que o cliente pensa:
 *  1. DE ONDE: a base inteira, ou funis/colunas escolhidos a dedo (vários).
 *  2. DE QUANDO: todo o período, ou recorte por data de cadastro / silêncio.
 *
 * Antes eram cinco filtros soltos e mutuamente exclusivos (base completa, tag,
 * funil, dias no CRM, data de cadastro) numa grade só — impossível pedir
 * "coluna Proposta, só quem está parado há 30 dias", e somar dois funis
 * exigia empilhar blocos.
 *
 * `buildAudienceBlocksPayload` é o que vira `audienceBlocks` no POST da
 * campanha; `estimatePublicoTotal`/`hasUsablePublico` alimentam o aviso de
 * risco e a validação do botão de agendar em DisparosMassaHub.
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Keyboard, Plus, Trash2, Upload, Users } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { cn } from "@/lib/utils";
import type { CrmFunnel } from "@/lib/crm-funnels";

export type PublicoAudiencePreview = { totalMatched: number; optedIn: number; notOptedIn: number };

/**
 * Espelha `CampaignCrmScope` do servidor: vazio dos dois lados = base
 * inteira. Cada coluna carrega o id do SEU funil junto — funis diferentes
 * reaproveitam os mesmos ids de etapa do Kanban (ex.: "proposta" existe em
 * vários funis), então guardar só o id da coluna faria marcar uma coluna de
 * um funil acender a mesma coluna em todos os outros que têm etapa com esse
 * id, e o servidor bateria em leads de QUALQUER um deles.
 */
export type PublicoCrmScope = {
  funnelIds: string[];
  columns: Array<{ funnelId: string; columnId: string }>;
};

/** Espelha `CampaignCrmPeriod` do servidor. */
export type PublicoCrmPeriod =
  | { mode: "all" }
  | { mode: "cadastro_dias"; days: number }
  | { mode: "cadastro_data"; date: string }
  | { mode: "sem_contato_dias"; days: number };

export type PublicoCrmBlock = {
  id: string;
  kind: "crm";
  /**
   * Modo escolhido a dedo pelo clique em "Todos os funis" vs "Escolher funis
   * e colunas" — não é derivado do `scope` estar vazio. Antes era derivado, e
   * isso causava o bug de desmarcar um funil (pra depois escolher só colunas
   * dele) zerar o `scope` momentaneamente e a tela reinterpretar isso como
   * "voltar pra Todos os funis", fechando a seção inteira embaixo do clique.
   */
  scopeMode: "all" | "custom";
  scope: PublicoCrmScope;
  period: PublicoCrmPeriod;
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
  return {
    id: newBlockId(),
    kind: "crm",
    scopeMode: "all",
    scope: { funnelIds: [], columns: [] },
    period: { mode: "all" },
    preview: null,
    previewLoading: false,
  };
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

/** true quando o bloco já tem gente pra receber — bloco em edição não conta. */
function isBlockUsable(block: PublicoBlock): boolean {
  if (block.kind === "crm") {
    // "Todos os funis" sempre vale. "Escolher funis e colunas" só vale depois
    // que algo foi de fato marcado — um escopo vazio em modo custom não pode
    // virar "base inteira" sozinho, que é como o servidor lê `scope` vazio.
    if (block.scopeMode === "all") return true;
    return block.scope.funnelIds.length > 0 || block.scope.columns.length > 0;
  }
  return block.status === "pronto" && block.leadIds.length > 0;
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

/**
 * Funil inteiro e colunas soltas são escolhas INDEPENDENTES: marcar um nunca
 * apaga o outro. Antes, marcar "funil inteiro" varria as colunas daquele
 * funil escolhidas antes — cliente selecionava uma coluna, marcava o funil e
 * a coluna sumia sozinha, sem ele pedir. Marcar as duas coisas ao mesmo tempo
 * é redundante (o funil inteiro já cobre a coluna), mas redundante não é
 * errado — sumir sozinho é que era o problema.
 */
export function toggleFunnelInScope(scope: PublicoCrmScope, funnelId: string): PublicoCrmScope {
  const on = scope.funnelIds.includes(funnelId);
  return {
    funnelIds: on ? scope.funnelIds.filter((f) => f !== funnelId) : [...scope.funnelIds, funnelId],
    columns: scope.columns,
  };
}

/**
 * A coluna é identificada pelo PAR (funnelId, columnId) — nunca só pelo id
 * da coluna. Marcar "Proposta" do Funil A não pode acender "Proposta" do
 * Funil B só porque os dois reaproveitam o mesmo id de etapa do Kanban.
 */
export function toggleColumnInScope(scope: PublicoCrmScope, funnelId: string, columnId: string): PublicoCrmScope {
  const on = scope.columns.some((c) => c.funnelId === funnelId && c.columnId === columnId);
  return {
    funnelIds: scope.funnelIds,
    columns: on
      ? scope.columns.filter((c) => !(c.funnelId === funnelId && c.columnId === columnId))
      : [...scope.columns, { funnelId, columnId }],
  };
}

export function buildAudienceBlocksPayload(blocks: PublicoBlock[]) {
  return blocks.filter(isBlockUsable).map((block) =>
    block.kind === "crm"
      ? { kind: "crm" as const, scope: block.scope, period: block.period }
      : { kind: "leads" as const, leadIds: block.leadIds },
  );
}

/**
 * Teto do arquivo lido no navegador. A rota já corta a lista em 5.000 linhas;
 * isto existe só pra um arquivo gigante escolhido por engano não travar a aba
 * antes de chegar lá.
 */
const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

/** Hoje civil em "AAAA-MM-DD" no fuso explícito da campanha. */
function todayIsoDate(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return "";
  }
}

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

/** Rótulo de etapa dentro do bloco — deixa claro que é "primeiro isso, depois aquilo". */
function StepLabel({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-content-secondary">
      <span className="grid size-4 place-items-center rounded-full bg-primary/15 text-[9px] font-bold text-primary">
        {n}
      </span>
      {children}
    </span>
  );
}

function ChoiceButton({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-2.5 text-left text-xs transition-all",
        active
          ? "border-primary/60 bg-primary/10"
          : "border-line bg-surface-card/40 hover:border-primary/35 hover:bg-surface-elevated/30",
      )}
    >
      <div className="font-semibold text-content">{title}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-content-secondary">{hint}</div> : null}
    </button>
  );
}

function CrmBlockCard({
  block,
  onUpdate,
  onRemove,
  isLight,
  onAfterOptIn,
  funnels,
  timezone,
}: {
  block: PublicoCrmBlock;
  onUpdate: UpdateFn;
  onRemove: (id: string) => void;
  isLight: boolean;
  onAfterOptIn?: () => void;
  funnels: CrmFunnel[];
  timezone: string;
}) {
  const [optInBusy, setOptInBusy] = useState(false);
  const id = block.id;
  const { scope, period, scopeMode } = block;
  const baseInteira = scopeMode === "all";
  // Modo "custom" sem nada marcado ainda: o servidor lê escopo vazio como
  // "base inteira", então contar leads aqui daria um número enganoso (a base
  // toda) pra uma seleção que na verdade está incompleta.
  const customSemSelecao = scopeMode === "custom" && scope.funnelIds.length === 0 && scope.columns.length === 0;
  // Serializado: o efeito de preview precisa reagir ao CONTEÚDO do escopo e do
  // período, não à identidade dos objetos (que muda a cada render e dispararia
  // uma requisição por tecla digitada em qualquer campo da tela).
  const scopeKey = JSON.stringify(scope);
  const periodKey = JSON.stringify(period);

  const refreshPreview = useCallback(() => {
    if (!timezone) {
      onUpdate(id, { preview: null, previewLoading: false });
      return;
    }
    if (customSemSelecao) {
      onUpdate(id, { preview: { totalMatched: 0, optedIn: 0, notOptedIn: 0 }, previewLoading: false });
      return;
    }
    onUpdate(id, { previewLoading: true });
    fetch("/api/client/whatsapp-campaigns/audience-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: JSON.parse(scopeKey), period: JSON.parse(periodKey), timezone }),
    })
      .then((r) => r.json())
      .then((data: PublicoAudiencePreview) => onUpdate(id, { preview: data, previewLoading: false }))
      .catch(() => onUpdate(id, { preview: null, previewLoading: false }));
  }, [id, onUpdate, scopeKey, periodKey, customSemSelecao, timezone]);

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
        body: JSON.stringify({ scope: JSON.parse(scopeKey), period: JSON.parse(periodKey), timezone }),
      });
      if (res.ok) {
        refreshPreview();
        onAfterOptIn?.();
      }
    } finally {
      setOptInBusy(false);
    }
  }, [scopeKey, periodKey, refreshPreview, onAfterOptIn, timezone]);

  const toggleFunnel = (funnelId: string) => onUpdate(id, { scope: toggleFunnelInScope(scope, funnelId) });
  const toggleColumn = (funnelId: string, columnId: string) =>
    onUpdate(id, { scope: toggleColumnInScope(scope, funnelId, columnId) });

  return (
    <BlockShell icon={Users} title="Base do CRM" onRemove={() => onRemove(id)} isLight={isLight}>
      <div>
        <StepLabel n={1}>De onde vêm os leads</StepLabel>
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceButton
            active={baseInteira}
            title="Todos os funis"
            hint="A base inteira do CRM"
            onClick={() => onUpdate(id, { scopeMode: "all", scope: { funnelIds: [], columns: [] } })}
          />
          <ChoiceButton
            active={!baseInteira}
            title="Escolher funis e colunas"
            hint="Pode marcar mais de um"
            onClick={() => {
              if (!baseInteira) return;
              onUpdate(id, { scopeMode: "custom", scope: { funnelIds: [], columns: [] } });
            }}
          />
        </div>

        {!baseInteira ? (
          funnels.length > 0 ? (
            <div className="mt-2.5 space-y-2">
              {funnels.map((funnel) => {
                const funnelOn = scope.funnelIds.includes(funnel.id);
                return (
                  <div
                    key={funnel.id}
                    className={cn(
                      "rounded-lg border p-2.5",
                      isLight ? "border-slate-200/80 bg-surface-deep/50" : "border-line/70 bg-surface-deep/30",
                    )}
                  >
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-content">
                      <input
                        type="checkbox"
                        checked={funnelOn}
                        onChange={() => toggleFunnel(funnel.id)}
                        className="size-3.5 shrink-0 accent-primary"
                      />
                      {funnel.nome}
                      <span className="text-[10px] font-normal text-content-secondary">(funil inteiro)</span>
                    </label>
                    {funnel.columns.length > 0 ? (
                      <div className="mt-2 pl-5">
                        {funnelOn ? (
                          <p className="mb-1.5 text-[10px] text-content-secondary">
                            Funil inteiro já cobre todas as colunas — marcar uma aqui não muda nada.
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-1.5">
                          {funnel.columns.map((column) => {
                            // Marcada só se o par (ESTE funil, esta coluna) estiver no
                            // scope — nunca acende por causa de outro funil que tenha
                            // uma coluna com o mesmo id.
                            const on = scope.columns.some(
                              (c) => c.funnelId === funnel.id && c.columnId === column.id,
                            );
                            return (
                              <button
                                key={column.id}
                                type="button"
                                onClick={() => toggleColumn(funnel.id, column.id)}
                                className={cn(
                                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                                  on
                                    ? "border-primary bg-primary text-white"
                                    : "border-line text-content-secondary hover:border-primary/40",
                                  funnelOn && "opacity-60",
                                )}
                              >
                                {column.title}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              Nenhum funil configurado ainda.
            </p>
          )
        ) : null}
      </div>

      <div className="mt-4 border-t border-line/60 pt-3">
        <StepLabel n={2}>De quando</StepLabel>
        <div className="grid gap-2 sm:grid-cols-3">
          <ChoiceButton
            active={period.mode === "all"}
            title="Todo o período"
            hint="Sem recorte de tempo"
            onClick={() => onUpdate(id, { period: { mode: "all" } })}
          />
          <ChoiceButton
            active={period.mode === "cadastro_dias" || period.mode === "cadastro_data"}
            title="Por cadastro"
            hint="Quando entrou no CRM"
            onClick={() => {
              if (period.mode === "cadastro_dias" || period.mode === "cadastro_data") return;
              onUpdate(id, { period: { mode: "cadastro_dias", days: 30 } });
            }}
          />
          <ChoiceButton
            active={period.mode === "sem_contato_dias"}
            title="Sem falar há um tempo"
            hint="Parou de responder"
            onClick={() => {
              if (period.mode === "sem_contato_dias") return;
              onUpdate(id, { period: { mode: "sem_contato_dias", days: 30 } });
            }}
          />
        </div>

        {period.mode === "cadastro_dias" || period.mode === "cadastro_data" ? (
          <div className="mt-2.5 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  period.mode !== "cadastro_dias" && onUpdate(id, { period: { mode: "cadastro_dias", days: 30 } })
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  period.mode === "cadastro_dias"
                    ? "border-primary bg-primary text-white"
                    : "border-line text-content-secondary hover:border-primary/40",
                )}
              >
                Há X dias ou mais
              </button>
              <button
                type="button"
                onClick={() =>
                  period.mode !== "cadastro_data" &&
                  onUpdate(id, { period: { mode: "cadastro_data", date: todayIsoDate(timezone) } })
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  period.mode === "cadastro_data"
                    ? "border-primary bg-primary text-white"
                    : "border-line text-content-secondary hover:border-primary/40",
                )}
              >
                Num dia específico
              </button>
            </div>
            {period.mode === "cadastro_dias" ? (
              <div>
                <input
                  type="number"
                  min={0}
                  value={period.days}
                  onChange={(e) => onUpdate(id, { period: { mode: "cadastro_dias", days: Number(e.target.value) } })}
                  className="h-11 w-full rounded-lg border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
                />
                <p className="mt-1 text-[10px] text-content-secondary">
                  Pega quem está no CRM há esse tanto de dias ou mais — base parada.
                </p>
              </div>
            ) : (
              <input
                type="date"
                value={period.date}
                onChange={(e) => onUpdate(id, { period: { mode: "cadastro_data", date: e.target.value } })}
                className="h-11 w-full rounded-lg border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
              />
            )}
          </div>
        ) : null}

        {period.mode === "sem_contato_dias" ? (
          <div className="mt-2.5">
            <input
              type="number"
              min={0}
              value={period.days}
              onChange={(e) => onUpdate(id, { period: { mode: "sem_contato_dias", days: Number(e.target.value) } })}
              className="h-11 w-full rounded-lg border border-line bg-surface-card px-3 text-sm text-content outline-none focus:border-primary/60"
            />
            <p className="mt-1 text-[10px] text-content-secondary">
              Sem trocar mensagem há esse tanto de dias. Quem nunca falou também entra.
            </p>
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
          isLight ? "border-slate-200/80 bg-slate-50/60" : "border-line/70 bg-surface-card/30",
        )}
      >
        <div className="text-[11px] text-content-secondary">
          {customSemSelecao ? (
            "Marque ao menos um funil ou coluna acima."
          ) : block.previewLoading ? (
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
            "Nenhum lead encontrado com esses critérios."
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  /**
   * O arquivo é lido AQUI e vira texto no mesmo campo de colar — a rota de
   * import recebe `content` como string, então não há upload de binário
   * envolvido. Também deixa o cliente conferir e corrigir o conteúdo antes de
   * confirmar, em vez de mandar um arquivo às cegas.
   */
  const handleFile = useCallback(
    async (file: File) => {
      setFileName(null);
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        onUpdate(id, { erro: "Arquivo muito grande (máx. 2 MB). Divida a lista em partes." });
        return;
      }
      // .xlsx é um zip binário: ler como texto devolveria lixo e o cliente só
      // descobriria no erro genérico de "nenhum telefone válido".
      if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
        onUpdate(id, {
          erro: "Formato não suportado. Salve como CSV (no Excel: Arquivo → Salvar como → CSV) e envie de novo.",
        });
        return;
      }
      try {
        const text = await file.text();
        if (!text.trim()) {
          onUpdate(id, { erro: "O arquivo está vazio." });
          return;
        }
        setFileName(file.name);
        onUpdate(id, { rascunhoTexto: text, erro: null });
      } catch {
        onUpdate(id, { erro: "Não foi possível ler o arquivo." });
      }
    },
    [id, onUpdate],
  );

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
          {!isManual ? (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.tsv,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  // Zera pra que escolher o MESMO arquivo de novo dispare o onChange.
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs font-medium transition-colors",
                  isLight
                    ? "border-slate-300 text-content-secondary hover:border-primary/45 hover:text-primary"
                    : "border-line text-content-secondary hover:border-primary/45 hover:text-primary",
                )}
              >
                <Upload className="size-4" aria-hidden />
                {fileName ? `Trocar arquivo — ${fileName}` : "Escolher arquivo (CSV)"}
              </button>
              <p className="mt-1.5 text-center text-[10px] text-content-secondary">
                ou cole a lista no campo abaixo
              </p>
            </div>
          ) : null}
          <textarea
            value={block.rascunhoTexto}
            onChange={(e) => {
              setFileName(null);
              onUpdate(id, { rascunhoTexto: e.target.value });
            }}
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
              : "Envie um CSV ou cole direto do Excel. Aceita vírgula ou ponto e vírgula, com ou sem cabeçalho."}{" "}
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
  timezone: string;
};

export function DisparosPublicoBuilder({ blocks, onChange, isLight, onAfterOptIn, funnels, timezone }: Props) {
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
            timezone={timezone}
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
          <Plus className="size-3.5" aria-hidden /> Base do CRM
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
