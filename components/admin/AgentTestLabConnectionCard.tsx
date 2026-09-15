"use client";

import Image from "next/image";
import {
  LAB_PROVIDER_LABELS, labConnectionStateLabel, isLabConnectionReady,
  type LabConnectionView, type LabProvider, type LabRole,
} from "@/lib/agent-test-lab/connection-plan";

const button = "rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} bg-orange-600 hover:bg-orange-500 border-orange-500`;

const PROVIDER_HINTS: Record<LabProvider, string> = {
  evolution: "Você lê um QR Code com o celular. Bom para um número comum de teste.",
  meta_cloud: "Conexão oficial pela Meta, sem celular. O número precisa estar em uma conta WhatsApp Business.",
};

/**
 * One laboratory line — the tester's or the isolated copy's. The provider that is
 * not in use is always offered as "Trocar para", never as a disabled button: the
 * swap is a real, confirmable action, so the panel says so instead of going quiet.
 */
export function AgentTestLabConnectionCard({
  role, title, description, connection, busy, qr, onHideQr,
  unavailable, onChoose, onRefresh, onDisconnect, pendingMeta, onOpenMeta, onCancelPending,
}: {
  role: LabRole;
  title: string;
  description: string;
  connection: LabConnectionView;
  busy: boolean;
  qr: string | null;
  onHideQr: () => void;
  /** Why this line cannot be touched yet, plus where to click to resolve it. */
  unavailable: { reason: string; action: { label: string; anchor: string } } | null;
  onChoose: (provider: LabProvider) => void;
  onRefresh: () => void;
  onDisconnect: () => void;
  /** The previous link was removed and the Meta signup still has to be finished. */
  pendingMeta: boolean;
  onOpenMeta: () => void;
  onCancelPending: () => void;
}) {
  const ready = isLabConnectionReady(connection);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 max-w-xl text-sm text-white/55">{description}</p>
      </div>
      <p className={`rounded-full border px-3 py-1 text-xs ${ready ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/15 text-white/60"}`}>
        {connection ? `${labConnectionStateLabel(connection.state)} · ${LAB_PROVIDER_LABELS[connection.provider]}` : "Não conectado"}
        {connection?.number ? ` · ${connection.number}` : ""}
      </p>
    </div>

    {unavailable
      ? <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p>{unavailable.reason}</p>
        <a className={`${button} mt-3 inline-block`} href={`#${unavailable.action.anchor}`}>{unavailable.action.label}</a>
      </div>
      : <>
        {pendingMeta && <div role="status" className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm">
          <p className="font-medium">Falta concluir a conexão com a Meta.</p>
          <p className="mt-1 text-white/70">A conexão anterior desta linha já foi removida. Se a janela da Meta não abriu, permita popups e abra de novo.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={primary} disabled={busy} onClick={onOpenMeta}>Abrir conexão da Meta</button>
            <button className={button} disabled={busy} onClick={onCancelPending}>Conectar por QR em vez disso</button>
          </div>
        </div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {(["evolution", "meta_cloud"] as const).map(provider => {
            const active = connection?.provider === provider;
            return <div key={provider} aria-current={active ? "true" : undefined}
              className={`rounded-xl border p-4 ${active ? "border-orange-500 bg-orange-500/10" : "border-white/10"}`}>
              <p className="flex items-center gap-2 font-medium">
                {LAB_PROVIDER_LABELS[provider]}
                {active && <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[11px] text-orange-300">Em uso</span>}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/55">{PROVIDER_HINTS[provider]}</p>
              <button className={`${active ? button : primary} mt-3 w-full`} disabled={busy}
                onClick={() => onChoose(provider)}>
                {active ? (ready ? "Reconectar" : "Concluir conexão") : `Trocar para ${LAB_PROVIDER_LABELS[provider]}`}
              </button>
            </div>;
          })}
        </div>
        {connection?.provider === "meta_cloud" && <p className="text-xs text-amber-300">
          A API Oficial só envia texto livre dentro da janela de 24 horas da Meta. Fora dela, a Meta exige um template aprovado.
        </p>}
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy} onClick={onRefresh}>Verificar conexão</button>
          {connection && <button className={button} disabled={busy} onClick={onDisconnect}>Desconectar</button>}
        </div>
        {qr && <div className="rounded-xl bg-white p-4">
          <Image unoptimized src={qr} width={240} height={240} className="mx-auto"
            alt={role === "tester" ? "QR privado para conectar o WhatsApp testador" : "QR privado para conectar o número da cópia isolada"} />
          <button className="mt-2 text-sm text-black" onClick={onHideQr}>Ocultar QR</button>
        </div>}
      </>}
  </div>;
}
