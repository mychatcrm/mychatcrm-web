"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Calendar, CalendarClock, FileText, History, MessageSquare, Phone } from "lucide-react";
import type { ClientLead } from "@/lib/dashboard-data";
import { funnelColumnTitle, normalizeColunaInicialForFunnel, type CrmFunnel } from "@/lib/crm-funnels";
import { appendCrmTimelineEvent, type CrmTimelineItem } from "@/lib/crm-lead-extras";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { cn } from "@/lib/utils";

const MAX_DESC = 500;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayLocalISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysToIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function formatAgendamentoPt(dataIso: string, horaHHmm: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataIso);
  const hm = /^(\d{1,2}):(\d{2})$/.exec(horaHHmm.trim());
  if (!m || !hm) return `${dataIso} ${horaHHmm}`;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(hm[1]), Number(hm[2]), 0, 0);
  return dt.toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export type FollowUpTipoAtividade = "ligacao" | "mensagem" | "reuniao" | "nota";

const TIPO_LABEL: Record<FollowUpTipoAtividade, string> = {
  ligacao: "Ligação",
  mensagem: "Mensagem",
  reuniao: "Reunião",
  nota: "Nota",
};

const tipos: { id: FollowUpTipoAtividade; label: string; Icon: typeof Phone }[] = [
  { id: "ligacao", label: "Ligação", Icon: Phone },
  { id: "mensagem", label: "Mensagem", Icon: MessageSquare },
  { id: "reuniao", label: "Reunião", Icon: Calendar },
  { id: "nota", label: "Nota", Icon: FileText },
];

export function CrmRegistrarFollowUpModal({
  open,
  onClose,
  lead,
  funnel,
  allFunnels,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  lead: ClientLead;
  funnel: CrmFunnel | undefined;
  /** Lista completa de funis do tenant (para transferir o lead). */
  allFunnels: readonly CrmFunnel[];
  onSaved: (next: ClientLead) => void;
}) {
  const formId = useId();
  const [tipo, setTipo] = useState<FollowUpTipoAtividade>("nota");
  const [dataIso, setDataIso] = useState(todayLocalISODate());
  const [hora, setHora] = useState("20:00");
  const [descricao, setDescricao] = useState("");
  const [funilDestinoId, setFunilDestinoId] = useState(lead.funilId);
  const [etapaId, setEtapaId] = useState(lead.status);
  const [erro, setErro] = useState("");

  const funnelDestino = useMemo(
    () => allFunnels.find((f) => f.id === funilDestinoId) ?? funnel,
    [allFunnels, funilDestinoId, funnel],
  );

  useEffect(() => {
    if (!open) return;
    setTipo("nota");
    setDataIso(todayLocalISODate());
    setHora("20:00");
    setDescricao("");
    setFunilDestinoId(lead.funilId);
    setEtapaId(lead.status);
    setErro("");
  }, [open, lead.id, lead.status, lead.funilId]);

  /** Ao mudar o funil, normaliza a etapa para uma coluna válida no funil de destino. */
  useEffect(() => {
    if (!open) return;
    const f = allFunnels.find((x) => x.id === funilDestinoId) ?? funnel;
    if (!f?.columns.length) return;
    setEtapaId((prev) => (f.columns.some((c) => c.id === prev) ? prev : normalizeColunaInicialForFunnel(lead.status, f)));
  }, [open, funilDestinoId, allFunnels, funnel, lead.id, lead.status]);

  const colunas = funnelDestino?.columns ?? [];

  const submit = () => {
    const d = descricao.trim();
    if (!d) {
      setErro("A descrição da atividade é obrigatória.");
      return;
    }
    if (d.length > MAX_DESC) {
      setErro(`Use no máximo ${MAX_DESC} caracteres.`);
      return;
    }
    if (!dataIso || !hora) {
      setErro("Indique data e hora do próximo contacto.");
      return;
    }
    if (colunas.length && !colunas.some((c) => c.id === etapaId)) {
      setErro("Seleccione uma etapa válida do funil.");
      return;
    }

    const mudouFunil = funilDestinoId !== lead.funilId;
    const mudouEtapa = etapaId !== lead.status;
    const fromFunilNome = allFunnels.find((f) => f.id === lead.funilId)?.nome ?? funnel?.nome ?? "—";
    const toFunilNome = funnelDestino?.nome ?? "—";
    const fromTitle = funnelColumnTitle(funnel, lead.status);
    const toTitle = funnelColumnTitle(funnelDestino, etapaId);
    const agendadoFmt = formatAgendamentoPt(dataIso, hora);
    const titulo = `Follow-up registrado · ${TIPO_LABEL[tipo]}`;

    const linhasMov: string[] = [];
    if (mudouFunil) {
      linhasMov.push(`Funil: lead transferido de «${fromFunilNome}» para «${toFunilNome}».`);
      linhasMov.push(`Etapa no funil de destino: «${toTitle}».`);
    } else if (mudouEtapa) {
      linhasMov.push(`Etapa do funil alterada de «${fromTitle}» para «${toTitle}».`);
    } else {
      linhasMov.push(`Etapa mantida em «${fromTitle}».`);
    }

    const texto = [
      `Descrição da interação:\n${d}`,
      "",
      `Próximo contacto planeado: ${agendadoFmt}.`,
      "",
      ...linhasMov,
    ].join("\n");

    const item: CrmTimelineItem = {
      id: `${lead.id}-tl-fu-${Date.now()}`,
      at: new Date().toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short", hour12: false }),
      tipo: "followup",
      titulo,
      texto,
    };

    const resumoProxima = `${TIPO_LABEL[tipo]} · ${d.slice(0, 72)}${d.length > 72 ? "…" : ""}`;

    const nextLead: ClientLead = {
      ...lead,
      funilId: funilDestinoId,
      status: etapaId,
      proximaAcao: resumoProxima,
    };

    appendCrmTimelineEvent({
      leadId: lead.id,
      lead: nextLead,
      funnel: funnelDestino,
      item,
    });

    onSaved(nextLead);
    onClose();
  };

  const header = (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25">
        <History className="h-5 w-5" aria-hidden />
      </span>
      <span className="text-base font-semibold leading-snug text-content sm:text-lg">Registrar Follow-Up</span>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar Follow-Up"
      titleContent={header}
      className="max-w-lg"
      footer={
        <>
          <Button type="button" variant="secondary" className="w-full min-w-0 sm:w-auto" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" className="w-full min-w-0 gap-2 sm:w-auto" onClick={submit}>
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
            Agendar Atividade
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-5" onSubmit={(e) => e.preventDefault()}>
        <div>
          <p className="text-sm font-semibold text-content">
            Tipo de atividade <span className="text-error">*</span>
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tipos.map(({ id, label, Icon }) => {
              const active = tipo === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTipo(id)}
                  className={cn(
                    "flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-center text-xs font-semibold transition",
                    active
                      ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/25"
                      : "border-line bg-surface-deep/40 text-content-muted hover:border-primary/40 hover:text-content",
                  )}
                >
                  <Icon className="h-6 w-6" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {allFunnels.length > 0 ? (
          <div>
            <label htmlFor={`${formId}-funil`} className="text-sm font-semibold text-content">
              Funil de destino <span className="text-error">*</span>
            </label>
            <p className="mt-0.5 text-xs text-content-muted">
              Pode manter o funil actual ou mover o lead para outro funil; as etapas listadas abaixo são as do funil
              seleccionado.
            </p>
            <Select
              id={`${formId}-funil`}
              className="mt-2"
              value={funilDestinoId}
              onChange={(e) => setFunilDestinoId(e.target.value)}
            >
              {allFunnels.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {colunas.length > 0 ? (
          <div>
            <label htmlFor={`${formId}-etapa`} className="text-sm font-semibold text-content">
              Etapa no funil <span className="text-error">*</span>
            </label>
            <p className="mt-0.5 text-xs text-content-muted">
              Coluna do pipeline no funil de destino (pode ser diferente do funil em que abriu a ficha).
            </p>
            <Select
              id={`${formId}-etapa`}
              className="mt-2"
              value={etapaId}
              onChange={(e) => setEtapaId(e.target.value)}
            >
              {colunas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${formId}-data`} className="text-sm font-semibold text-content">
              Data próximo contacto <span className="text-error">*</span>
            </label>
            <Input
              id={`${formId}-data`}
              type="date"
              className="mt-2"
              value={dataIso}
              onChange={(e) => setDataIso(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDataIso(todayLocalISODate())}>
                Hoje
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setDataIso(addDaysToIso(todayLocalISODate(), 1))}>
                Amanhã
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setDataIso(addDaysToIso(todayLocalISODate(), 7))}>
                Próxima semana
              </Button>
            </div>
          </div>
          <div>
            <label htmlFor={`${formId}-hora`} className="text-sm font-semibold text-content">
              Hora próximo contacto <span className="text-error">*</span>
            </label>
            <Input id={`${formId}-hora`} type="time" className="mt-2" value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
        </div>

        <div>
          <label htmlFor={`${formId}-desc`} className="text-sm font-semibold text-content">
            Descrição da atividade <span className="text-error">*</span>
          </label>
          <textarea
            id={`${formId}-desc`}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value.slice(0, MAX_DESC))}
            placeholder="Ex.: Fazer ligação para agendar visita ao imóvel"
            rows={5}
            className="mt-2 w-full rounded-xl border border-line bg-surface-deep/40 px-4 py-3 text-sm text-content outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <p className="mt-1 text-right text-xs text-content-muted">
            {descricao.length} / {MAX_DESC}
          </p>
        </div>

        {erro ? <p className="text-sm font-medium text-error">{erro}</p> : null}
      </form>
    </Modal>
  );
}
