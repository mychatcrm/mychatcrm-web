"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AiTimeseriesPoint } from "@/lib/ai/admin-metrics";
import { hubGlass } from "@/components/admin/omnichat-ia-hub/hub-surface";
import { cn } from "@/lib/utils";

type Props = {
  series: AiTimeseriesPoint[];
  className?: string;
  /** true = telemetria legível; false = bloqueada; undefined = ainda sem sinal (mostra texto neutro). */
  telemetryReachable?: boolean;
};

export function HubTimeseriesChart({ series, className, telemetryReachable }: Props) {
  const data = series.map((p) => ({
    ...p,
    label: p.day.slice(5),
  }));

  if (data.length === 0) {
    const blocked = telemetryReachable === false;
    const ok = telemetryReachable === true;
    return (
      <div
        className={cn(
          hubGlass,
          "relative flex min-h-[260px] flex-col items-center justify-center overflow-hidden p-8 text-center",
          className,
        )}
      >
        <div className="relative space-y-3">
          <div className="mx-auto h-12 w-12 rounded-xl border border-line bg-surface-card" />
          <p className="text-sm font-medium text-content">Sem actividade no período</p>
          <p className="max-w-sm text-xs leading-relaxed text-content-muted">
            {blocked ? (
              <>
                A telemetria interna não está acessível no servidor (permissões ou configuração). Use{" "}
                <span className="text-content">Diagnóstico de ligação</span> acima e confirme a chave privilegiada da base no ambiente de alojamento.
              </>
            ) : ok ? (
              <>
                A leitura da telemetria está OK; não há pedidos registados neste intervalo de datas. Gere tráfego real (ex.{" "}
                <span className="font-mono text-[10px] text-content-secondary">POST /api/chat</span>) ou alargue as datas. Se esperava dados e continua vazio, confira o filtro de
                estado e volte a revalidar a integração.
              </>
            ) : (
              <>
                Quando existir tráfego nos agentes (ex. <span className="font-mono text-[10px] text-content-secondary">/api/chat</span>), o consumo diário aparece aqui. Se a telemetria
                estiver bloqueada, execute o <span className="text-content">Diagnóstico de ligação</span> acima após carregar o painel.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(hubGlass, "p-4 sm:p-5", className)}>
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-content-muted">Consumo diário (requests)</p>
      <div className="h-[260px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(113,113,122,0.2)" vertical={false} />
            <XAxis dataKey="label" stroke="#71717A" tick={{ fill: "#71717A", fontSize: 11 }} />
            <YAxis stroke="#71717A" tick={{ fill: "#71717A", fontSize: 11 }} width={36} />
            <Tooltip
              contentStyle={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 12,
                color: "#09090B",
              }}
              labelFormatter={(_, p) => (p?.[0]?.payload?.day as string) ?? ""}
            />
            <Line type="monotone" dataKey="requests" name="Requests" stroke="#F24400" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="successCount" name="OK" stroke="#00A650" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
