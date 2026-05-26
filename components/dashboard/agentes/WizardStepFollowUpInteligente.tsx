"use client";

import { useState } from "react";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect } from "@/components/panel/ui/PanelSelect";
import type { AgentWizardDraft } from "@/lib/agents";
import { DEFAULT_FOLLOW_UP_INTELIGENTE } from "@/lib/server/follow-up-settings";
import type { AgentFollowUpInteligente } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AGENT_FIELD_HELP } from "./agent-field-help-content";
import { FieldTitle, InlineFieldTitle } from "./agent-field-help";

function parsePositiveInt(raw: string, fallback: number, max: number) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return Math.min(max, Math.max(1, fallback));
  return Math.min(max, Math.max(1, n));
}

function parseHour(raw: string, fallback: number) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 23) return fallback;
  return n;
}

function parseMinute(raw: string, fallback: number) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 59) return fallback;
  return n;
}

const COMMON_TIMEZONES: { label: string; value: string }[] = [
  { label: "UTC (padrão)", value: "UTC" },
  { label: "América/São Paulo (BRT, UTC-3)", value: "America/Sao_Paulo" },
  { label: "América/Manaus (AMT, UTC-4)", value: "America/Manaus" },
  { label: "América/Belém (BRT, UTC-3)", value: "America/Belem" },
  { label: "América/Fortaleza (BRT, UTC-3)", value: "America/Fortaleza" },
  { label: "América/Recife (BRT, UTC-3)", value: "America/Recife" },
  { label: "América/New York (EST/EDT)", value: "America/New_York" },
  { label: "América/Chicago (CST/CDT)", value: "America/Chicago" },
  { label: "América/Denver (MST/MDT)", value: "America/Denver" },
  { label: "América/Los Angeles (PST/PDT)", value: "America/Los_Angeles" },
  { label: "América/Mexico City (CST, UTC-6)", value: "America/Mexico_City" },
  { label: "América/Bogotá (COT, UTC-5)", value: "America/Bogota" },
  { label: "América/Lima (PET, UTC-5)", value: "America/Lima" },
  { label: "América/Buenos Aires (ART, UTC-3)", value: "America/Argentina/Buenos_Aires" },
  { label: "América/Santiago (CLT/CLST)", value: "America/Santiago" },
  { label: "Europa/Lisboa (WET/WEST)", value: "Europe/Lisbon" },
  { label: "Europa/Londres (GMT/BST)", value: "Europe/London" },
  { label: "Europa/Madrid (CET/CEST)", value: "Europe/Madrid" },
  { label: "Europa/Paris (CET/CEST)", value: "Europe/Paris" },
  { label: "Ásia/Dubai (GST, UTC+4)", value: "Asia/Dubai" },
  { label: "Ásia/Tóquio (JST, UTC+9)", value: "Asia/Tokyo" },
  { label: "Austrália/Sydney (AEST/AEDT)", value: "Australia/Sydney" },
  { label: "África/Luanda (WAT, UTC+1)", value: "Africa/Luanda" },
];

const WEEK_DAYS = [
  { label: "Dom", value: 0 },
  { label: "Seg", value: 1 },
  { label: "Ter", value: 2 },
  { label: "Qua", value: 3 },
  { label: "Qui", value: 4 },
  { label: "Sex", value: 5 },
  { label: "Sáb", value: 6 },
];

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        checked && !disabled ? "border-primary/40 bg-gradient-primary" : "border-line/80 bg-surface-deep",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform duration-200 ease-out",
          checked && !disabled ? "translate-x-[22px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

function SectionBlock({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-elevated/20">
      <div className="border-b border-line px-3 py-3 sm:px-4">
        <h4 className="text-sm font-semibold text-content">{title}</h4>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-content-muted">{description}</p>
        ) : null}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </div>
  );
}

function ToggleRow({
  title,
  help,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-4 sm:px-4">
      <InlineFieldTitle title={title} help={help} />
      <ToggleSwitch
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(!checked)}
        label={title}
      />
    </div>
  );
}

export function WizardStepFollowUpInteligente({
  draft,
  onChange,
  agentId,
}: {
  draft: AgentWizardDraft;
  onChange: (next: AgentWizardDraft) => void;
  agentId?: string | null;
}) {
  const f: AgentFollowUpInteligente = {
    ...DEFAULT_FOLLOW_UP_INTELIGENTE,
    ...draft.followUpInteligente,
  };
  const setF = (patch: Partial<AgentFollowUpInteligente>) =>
    onChange({ ...draft, followUpInteligente: { ...f, ...patch } });

  const [testJid, setTestJid] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const toggleDay = (day: number) => {
    const current = f.diasAtivos ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    setF({ diasAtivos: next });
  };

  const runDryTest = async () => {
    if (!agentId) {
      setTestResult("Salve o agente primeiro para testar com o ID persistido.");
      return;
    }
    const jid = testJid.trim();
    if (!jid) {
      setTestResult("Informe o JID da conversa (ex.: 5562999999999@s.whatsapp.net).");
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/client/agentes/${encodeURIComponent(agentId)}/follow-up-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remoteJid: jid,
          draft: { followUpInteligente: f },
        }),
      });
      const data = (await res.json()) as {
        message?: string;
        error?: string;
        wouldSend?: boolean;
        decision?: { skipReason?: string | null; followUpType?: string };
      };
      if (!res.ok) {
        setTestResult(data.error ?? "Falha no teste.");
      } else {
        setTestResult(data.message ?? (data.wouldSend ? "Enviaria." : "Não enviaria."));
      }
    } catch {
      setTestResult("Erro de rede ao testar.");
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <SectionBlock
        title="A) Ativação"
        description="Com o follow-up desligado, o agente só responde quando o lead chama. Nenhum job é criado nem processado."
      >
        <ToggleRow
          title="Ativar Follow-up Inteligente"
          help={AGENT_FIELD_HELP.followUpAtivar}
          checked={f.ativo}
          onChange={(ativo) => setF({ ativo })}
        />
      </SectionBlock>

      <SectionBlock
        title="B) Frequência"
        description="Limites de tentativas e espaçamento entre mensagens automáticas."
      >
        <div className="grid gap-4 px-3 py-4 sm:grid-cols-2 sm:px-4">
          <div>
            <FieldTitle title="Tentativas máximas" help={AGENT_FIELD_HELP.followUpTentativas} className="mb-3" />
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={99}
                disabled={!f.ativo}
                value={f.tentativasContato}
                onChange={(e) =>
                  setF({ tentativasContato: parsePositiveInt(e.target.value, f.tentativasContato, 99) })
                }
                className="w-[5.75rem] min-h-10 shrink-0 py-2"
              />
            </div>
          </div>
          <div>
            <FieldTitle title="Intervalo entre tentativas" help={AGENT_FIELD_HELP.followUpIntervalo} className="mb-3" />
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={10080}
                disabled={!f.ativo}
                value={f.intervaloVerificacaoMinutos}
                onChange={(e) =>
                  setF({
                    intervaloVerificacaoMinutos: parsePositiveInt(
                      e.target.value,
                      f.intervaloVerificacaoMinutos,
                      10080,
                    ),
                  })
                }
                className="w-[5.75rem] min-h-10 shrink-0 py-2"
              />
              <span className="text-sm text-content-muted">min</span>
            </div>
          </div>
        </div>
        <ToggleRow
          title="Cooldown anti-spam"
          help={AGENT_FIELD_HELP.followUpCooldownAtivo}
          checked={f.cooldownAtivo}
          disabled={!f.ativo}
          onChange={(cooldownAtivo) => setF({ cooldownAtivo })}
        />
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Minutos de cooldown" help={AGENT_FIELD_HELP.followUpCooldown} className="mb-3" />
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={10080}
              disabled={!f.ativo || !f.cooldownAtivo}
              value={f.cooldownMinutos}
              onChange={(e) =>
                setF({ cooldownMinutos: parsePositiveInt(e.target.value, f.cooldownMinutos, 10080) })
              }
              className="w-[5.75rem] min-h-10 shrink-0 py-2"
            />
            <span className="text-sm text-content-muted">min (padrão 24h = 1440)</span>
          </div>
        </div>
        <ToggleRow
          title="Desativar automaticamente após esgotar tentativas"
          help={AGENT_FIELD_HELP.followUpDesativarAposEncerrar}
          checked={f.desativarAposEncerrar}
          disabled={!f.ativo}
          onChange={(desativarAposEncerrar) => setF({ desativarAposEncerrar })}
        />
      </SectionBlock>

      <SectionBlock
        title="C) Horários"
        description="Só envia follow-up dentro da janela configurada. Escolha o fuso horário e os horários serão interpretados nele."
      >
        <ToggleRow
          title="Usar horário comercial"
          help={AGENT_FIELD_HELP.followUpHorarioComercial}
          checked={f.usarHorarioComercial}
          disabled={!f.ativo}
          onChange={(usarHorarioComercial) => setF({ usarHorarioComercial })}
        />
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Fuso horário" help="Define como horaInicio e horaFim são interpretados. Padrão: UTC." className="mb-3" />
          <PanelSelect
            disabled={!f.ativo || !f.usarHorarioComercial}
            value={f.timezone ?? "UTC"}
            onChange={(e) => setF({ timezone: e.target.value })}
            className="max-w-xs"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </PanelSelect>
        </div>
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Janela de envio" help={AGENT_FIELD_HELP.followUpHorario} className="mb-3" />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={0}
              max={23}
              disabled={!f.ativo || !f.usarHorarioComercial}
              value={f.horaInicio}
              onChange={(e) => setF({ horaInicio: parseHour(e.target.value, f.horaInicio) })}
              className="w-[4.5rem] min-h-10 shrink-0 py-2"
            />
            <span className="text-sm text-content-muted">h</span>
            <Input
              type="number"
              min={0}
              max={59}
              step={5}
              disabled={!f.ativo || !f.usarHorarioComercial}
              value={f.minutoInicio ?? 0}
              onChange={(e) => setF({ minutoInicio: parseMinute(e.target.value, f.minutoInicio ?? 0) })}
              className="w-[4.5rem] min-h-10 shrink-0 py-2"
            />
            <span className="text-sm text-content-muted">min às</span>
            <Input
              type="number"
              min={0}
              max={23}
              disabled={!f.ativo || !f.usarHorarioComercial}
              value={f.horaFim}
              onChange={(e) => setF({ horaFim: parseHour(e.target.value, f.horaFim) })}
              className="w-[4.5rem] min-h-10 shrink-0 py-2"
            />
            <span className="text-sm text-content-muted">h</span>
            <Input
              type="number"
              min={0}
              max={59}
              step={5}
              disabled={!f.ativo || !f.usarHorarioComercial}
              value={f.minutoFim ?? 0}
              onChange={(e) => setF({ minutoFim: parseMinute(e.target.value, f.minutoFim ?? 0) })}
              className="w-[4.5rem] min-h-10 shrink-0 py-2"
            />
            <span className="text-sm text-content-muted">min</span>
          </div>
        </div>
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Dias permitidos" help={AGENT_FIELD_HELP.followUpDias} className="mb-3" />
          <div className="flex flex-wrap gap-2">
            {WEEK_DAYS.map((day) => {
              const active = (f.diasAtivos ?? []).includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  disabled={!f.ativo || !f.usarHorarioComercial}
                  onClick={() => toggleDay(day.value)}
                  className={cn(
                    "h-9 w-12 rounded-lg border text-xs font-medium transition-colors",
                    active && f.ativo && f.usarHorarioComercial
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-line bg-surface-base text-content-muted",
                    (!f.ativo || !f.usarHorarioComercial) && "cursor-not-allowed opacity-50",
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>
      </SectionBlock>

      <SectionBlock title="D) Regras de segurança" description="Quando bloquear o envio automático.">
        <ToggleRow
          title="Respeitar atendimento humano ativo"
          help={AGENT_FIELD_HELP.followUpRespeitarHumano}
          checked={f.respeitarHumanoAtivo}
          disabled={!f.ativo}
          onChange={(respeitarHumanoAtivo) => setF({ respeitarHumanoAtivo })}
        />
        <ToggleRow
          title="Retomar só se humano abandonou"
          help={AGENT_FIELD_HELP.followUpSoHumano}
          checked={f.retomadaApenasSeHumanoAbandonou}
          disabled={!f.ativo}
          onChange={(retomadaApenasSeHumanoAbandonou) => setF({ retomadaApenasSeHumanoAbandonou })}
        />
        <ToggleRow
          title="Bloquear se o lead respondeu"
          help={AGENT_FIELD_HELP.followUpBloquearRespondeu}
          checked={f.bloquearSeLeadRespondeu}
          disabled={!f.ativo}
          onChange={(bloquearSeLeadRespondeu) => setF({ bloquearSeLeadRespondeu })}
        />
        <ToggleRow
          title="Bloquear se houver tarefa futura no CRM"
          help={AGENT_FIELD_HELP.followUpBloquearTarefa}
          checked={f.bloquearTarefaFutura}
          disabled={!f.ativo}
          onChange={(bloquearTarefaFutura) => setF({ bloquearTarefaFutura })}
        />
        <ToggleRow
          title="Bloquear lead perdido / inativo"
          help={AGENT_FIELD_HELP.followUpBloquearPerdido}
          checked={f.bloquearStatusPerdido}
          disabled={!f.ativo}
          onChange={(bloquearStatusPerdido) => setF({ bloquearStatusPerdido })}
        />
        <ToggleRow
          title="Permitir retomada por SLA vencido"
          help={AGENT_FIELD_HELP.followUpSlaAtivo}
          checked={f.permitirSlaVencido}
          disabled={!f.ativo}
          onChange={(permitirSlaVencido) =>
            setF({
              permitirSlaVencido,
              slaHorasResposta: permitirSlaVencido ? f.slaHorasResposta ?? 4 : null,
            })
          }
        />
        {f.permitirSlaVencido && f.ativo ? (
          <div className="px-3 py-4 sm:px-4">
            <FieldTitle title="SLA (horas sem resposta)" help={AGENT_FIELD_HELP.followUpSla} className="mb-3" />
            <Input
              type="number"
              min={1}
              max={168}
              value={f.slaHorasResposta ?? 4}
              onChange={(e) =>
                setF({ slaHorasResposta: parsePositiveInt(e.target.value, f.slaHorasResposta ?? 4, 168) })
              }
              className="w-[5.75rem] min-h-10 shrink-0 py-2"
            />
          </div>
        ) : null}
      </SectionBlock>

      <SectionBlock title="E) Inteligência" description="Fontes de contexto e tom da mensagem.">
        <div className="px-3 py-4 sm:px-4">
          <FieldTitle title="Modo de abordagem" help={AGENT_FIELD_HELP.followUpModo} className="mb-3" />
          <div className="grid grid-cols-3 gap-2">
            {(["suave", "moderado", "agressivo"] as const).map((modo) => (
              <button
                key={modo}
                type="button"
                disabled={!f.ativo}
                onClick={() => setF({ modo })}
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs font-medium capitalize transition-colors",
                  f.modo === modo && f.ativo
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-line bg-surface-base text-content-muted",
                  !f.ativo && "cursor-not-allowed opacity-50",
                )}
              >
                {modo === "suave" ? "Suave" : modo === "moderado" ? "Moderado" : "Agressivo"}
              </button>
            ))}
          </div>
        </div>
        <ToggleRow
          title="Usar histórico do WhatsApp"
          help={AGENT_FIELD_HELP.followUpHistoricoWhatsapp}
          checked={f.usarHistoricoWhatsapp}
          disabled={!f.ativo}
          onChange={(usarHistoricoWhatsapp) => setF({ usarHistoricoWhatsapp })}
        />
        <ToggleRow
          title="Usar histórico do CRM"
          help={AGENT_FIELD_HELP.followUpHistoricoCrm}
          checked={f.usarHistoricoCrm}
          disabled={!f.ativo}
          onChange={(usarHistoricoCrm) => setF({ usarHistoricoCrm })}
        />
        <ToggleRow
          title="Usar dados do formulário Meta Lead Ads"
          help={AGENT_FIELD_HELP.followUpMetaForm}
          checked={f.usarDadosFormularioMeta}
          disabled={!f.ativo}
          onChange={(usarDadosFormularioMeta) => setF({ usarDadosFormularioMeta })}
        />
      </SectionBlock>

      <SectionBlock
        title="F) Teste (simulação)"
        description="Avalia as regras atuais sem enviar WhatsApp. Informe o JID de uma conversa existente."
      >
        <div className="space-y-3 px-3 py-4 sm:px-4">
          <Input
            placeholder="5562999999999@s.whatsapp.net"
            value={testJid}
            onChange={(e) => setTestJid(e.target.value)}
            disabled={!f.ativo}
            className="min-h-10"
          />
          <button
            type="button"
            disabled={!f.ativo || testLoading}
            onClick={() => void runDryTest()}
            className={cn(
              "rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20",
              (!f.ativo || testLoading) && "cursor-not-allowed opacity-50",
            )}
          >
            {testLoading ? "Testando…" : "Rodar follow-up agora (simulação)"}
          </button>
          {testResult ? (
            <p className="rounded-lg border border-line bg-surface-base px-3 py-2 text-sm text-content">
              {testResult}
            </p>
          ) : null}
          {!agentId ? (
            <p className="text-xs text-content-muted">Salve o agente para habilitar o teste com ID persistido.</p>
          ) : null}
        </div>
      </SectionBlock>
    </div>
  );
}
