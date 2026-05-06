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
};

export function HubTimeseriesChart({ series, className }: Props) {
  const data = series.map((p) => ({
    ...p,
    label: p.day.slice(5),
  }));

  if (data.length === 0) {
    return (
      <div className={cn(hubGlass, "flex min-h-[220px] items-center justify-center p-8 text-sm text-zinc-400", className)}>
        Sem dados no período para o gráfico.
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
