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
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-[radial-gradient(400px_120px_at_50%_0%,rgba(120,119,198,0.08),transparent_65%)]" />
        <div className="relative space-y-3">
          <div className="mx-auto h-12 w-12 rounded-xl border border-white/10 bg-white/[0.04] shadow-inner" />
          <p className="text-sm font-medium text-zinc-200">Sem actividade no período</p>
          <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
            {blocked ? (
              <>
                A telemetria interna não está acessível no servidor (permissões ou configuração). Use{" "}
                <span className="text-zinc-300">Diagnóstico de ligação</span> acima e confirme a chave privilegiada da base no ambiente de alojamento.
              </>
            ) : ok ? (
              <>
                A leitura da telemetria está OK; não há pedidos registados neste intervalo de datas. Gere tráfego real (ex.{" "}
                <span className="font-mono text-[10px] text-zinc-400">POST /api/chat</span>) ou alargue as datas. Se esperava dados e continua vazio, confira o filtro de
                estado e volte a revalidar a integração.
              </>
            ) : (
              <>
                Quando existir tráfego nos agentes (ex. <span className="font-mono text-[10px] text-zinc-400">/api/chat</span>), o consumo diário aparece aqui. Se a telemetria
                estiver bloqueada, execute o <span className="text-zinc-300">Diagnóstico de ligação</span> acima após carregar o painel.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(hubGlass, "p-4 sm:p-5", className)}>
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Consumo diário (requests)</p>
      <div className="h-[260px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
            <YAxis stroke="#71717a" tick={{ fill: "#a1a1aa", fontSize: 11 }} width={36} />
            <Tooltip
              contentStyle={{
                background: "rgba(15,15,20,0.95)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                color: "#e4e4e7",
              }}
              labelFormatter={(_, p) => (p?.[0]?.payload?.day as string) ?? ""}
            />
            <Line type="monotone" dataKey="requests" name="Requests" stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="successCount" name="OK" stroke="#4ade80" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
