"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, X, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  type: string;
  to_number: string;
  message: string;
  status: string;
  error: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

function statusLabel(status: string): { label: string; tone: string } {
  if (status === "delivered") return { label: "entregue ✓", tone: "text-emerald-400" };
  if (status === "sent") return { label: "enviado", tone: "text-amber-400" };
  if (status === "pending") return { label: "enviando…", tone: "text-amber-400" };
  if (status === "delivery_failed" || status === "failed") return { label: "não entregue", tone: "text-rose-400" };
  if (status === "skipped") return { label: "não enviado", tone: "text-content-muted" };
  return { label: status, tone: "text-content-muted" };
}

const STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "delivered", label: "Entregue" },
  { value: "sent", label: "Enviado" },
  { value: "pending", label: "Enviando" },
  { value: "delivery_failed", label: "Não entregue" },
  { value: "skipped", label: "Não enviado" },
];

export function NotificationsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (type) p.set("type", type);
    if (status) p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    if (from) p.set("from", new Date(from).toISOString());
    if (to) p.set("to", new Date(to).toISOString());
    return p;
  }, [type, status, q, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = buildQuery();
    p.set("limit", "200");
    const res = await fetch(`/api/admin/system-agent/notifications?${p.toString()}`, {
      credentials: "same-origin",
    });
    const json = (await res.json().catch(() => ({}))) as {
      items?: NotificationItem[];
      total?: number;
      types?: string[];
    };
    setItems(json.items ?? []);
    setTotal(json.total ?? 0);
    if (json.types) setTypes(json.types);
    setLoading(false);
  }, [buildQuery]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const deleteOne = useCallback(
    async (id: string) => {
      setBusyId(id);
      await fetch(`/api/admin/system-agent/notifications?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      setItems((prev) => prev.filter((i) => i.id !== id));
      setBusyId(null);
    },
    [],
  );

  const deleteFiltered = useCallback(async () => {
    if (!window.confirm(`Apagar as ${items.length} notificações que correspondem ao filtro atual?`)) return;
    setBulkBusy(true);
    const p = buildQuery();
    await fetch(`/api/admin/system-agent/notifications?${p.toString()}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    setBulkBusy(false);
    await load();
  }, [buildQuery, items.length, load]);

  const deleteAll = useCallback(async () => {
    if (!window.confirm("Apagar TODAS as notificações? Esta ação não pode ser desfeita.")) return;
    setBulkBusy(true);
    await fetch(`/api/admin/system-agent/notifications?all=true`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    setBulkBusy(false);
    await load();
  }, [load]);

  const hasFilter = Boolean(type || status || q.trim() || from || to);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-content">Todas as notificações</h2>
            <p className="text-xs text-content-muted">{total} no total · {items.length} exibidas</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-content-secondary hover:bg-surface-elevated/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filtros */}
        <div className="grid gap-2 border-b border-line bg-surface-elevated/20 px-5 py-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="relative text-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-content-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void load()}
              placeholder="Buscar número ou texto"
              className="w-full rounded-lg border border-line bg-surface-card py-2 pl-8 pr-3 text-content"
            />
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-lg border border-line bg-surface-card px-3 py-2 text-xs text-content"
          >
            <option value="">Todos os tipos</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-line bg-surface-card px-3 py-2 text-xs text-content"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="text-xs text-content-faint">
            De
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-line bg-surface-card px-3 py-1.5 text-content"
            />
          </label>
          <label className="text-xs text-content-faint">
            Até
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-line bg-surface-card px-3 py-1.5 text-content"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white"
            >
              Filtrar
            </button>
            <button
              type="button"
              onClick={() => {
                setType("");
                setStatus("");
                setQ("");
                setFrom("");
                setTo("");
                setTimeout(() => void load(), 0);
              }}
              className="rounded-lg border border-line px-3 py-2 text-xs text-content-secondary"
            >
              Limpar
            </button>
          </div>
        </div>

        {/* Ações em massa */}
        <div className="flex items-center justify-end gap-2 border-b border-line px-5 py-2">
          {hasFilter ? (
            <button
              type="button"
              disabled={bulkBusy || items.length === 0}
              onClick={() => void deleteFiltered()}
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 disabled:opacity-50"
            >
              Apagar filtradas
            </button>
          ) : null}
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void deleteAll()}
            className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-100 disabled:opacity-50"
          >
            {bulkBusy ? "Apagando…" : "Limpar todas"}
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-content-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-content-muted">Nenhuma notificação encontrada.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                const st = statusLabel(item.status);
                return (
                  <li
                    key={item.id}
                    className="rounded-lg border border-line/80 bg-surface-elevated/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold uppercase tracking-wide text-content-secondary">
                            {item.type}
                          </span>
                          <span className={st.tone}>{st.label}</span>
                        </div>
                        <p className="mt-1 text-xs text-content-faint">
                          {new Date(item.created_at).toLocaleString("pt-BR")} · {item.to_number}
                        </p>
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-content-secondary">
                          {item.message}
                        </p>
                        {item.error ? <p className="mt-1 text-xs text-rose-300">{item.error}</p> : null}
                      </div>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void deleteOne(item.id)}
                        aria-label="Apagar notificação"
                        className={cn(
                          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-line text-content-muted hover:border-rose-500/50 hover:text-rose-300",
                          busyId === item.id ? "opacity-50" : "",
                        )}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
