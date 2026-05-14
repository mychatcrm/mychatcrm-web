"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientAgendaEvent } from "@/lib/agenda/client-event";
import { persistAgendaEvents, type AgendaEventRecord } from "@/components/dashboard/agenda/agenda-storage";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { agendaRealtimeChannel } from "@/lib/agenda/realtime";

function toStorageRecord(e: ClientAgendaEvent): AgendaEventRecord {
  return {
    id: e.id,
    title: e.title,
    startISO: e.startISO,
    endISO: e.endISO,
    kind: "evento",
    meetLink: e.description?.includes("Link:") ? e.description.split("Link:")[1]?.trim() : undefined,
    notifyWa: false,
  };
}

export type GoogleStatus = {
  tenantId: string | null;
  connected: boolean;
  email: string | null;
  lastSyncISO: string | null;
  configured: boolean;
};

export function useAgendaData() {
  const [events, setEvents] = useState<ClientAgendaEvent[]>([]);
  const [google, setGoogle] = useState<GoogleStatus>({
    tenantId: null,
    connected: false,
    email: null,
    lastSyncISO: null,
    configured: false,
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tenantRef = useRef<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/client/google-calendar/status", { credentials: "include" });
    if (!res.ok) throw new Error("status");
    const data = (await res.json()) as GoogleStatus & { tenantId?: string };
    tenantRef.current = data.tenantId ?? null;
    setGoogle({
      tenantId: data.tenantId ?? null,
      connected: data.connected === true,
      email: data.email ?? null,
      lastSyncISO: data.lastSyncISO ?? null,
      configured: data.configured === true,
    });
  }, []);

  const refreshEvents = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const url = q?.trim() ? `/api/client/google-calendar/events?q=${encodeURIComponent(q.trim())}` : "/api/client/google-calendar/events";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("events");
      const data = (await res.json()) as { events?: ClientAgendaEvent[] };
      const list = data.events ?? [];
      setEvents(list);
      persistAgendaEvents(list.map(toStorageRecord));
      setError(null);
    } catch {
      setError("Não foi possível carregar os eventos.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncGoogle = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/client/google-calendar/sync", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("sync");
      const data = (await res.json()) as { lastSyncISO?: string };
      setGoogle((g) => ({ ...g, lastSyncISO: data.lastSyncISO ?? new Date().toISOString() }));
      await refreshEvents();
      await refreshStatus();
    } catch {
      setError("Falha ao sincronizar com o Google Calendar.");
    } finally {
      setSyncing(false);
    }
  }, [refreshEvents, refreshStatus]);

  const createEvent = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/client/google-calendar/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, syncToGoogle: google.connected }),
      });
      if (!res.ok) throw new Error("create");
      await refreshEvents();
      return res.json();
    },
    [google.connected, refreshEvents],
  );

  const updateEvent = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      const res = await fetch(`/api/client/google-calendar/events/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, syncToGoogle: google.connected }),
      });
      if (!res.ok) throw new Error("update");
      await refreshEvents();
      return res.json();
    },
    [google.connected, refreshEvents],
  );

  const deleteEvent = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/client/google-calendar/events/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("delete");
      await refreshEvents();
    },
    [refreshEvents],
  );

  const connectGoogle = useCallback(() => {
    window.location.href = "/api/auth/google";
  }, []);

  const disconnectGoogle = useCallback(async (clearEvents = false) => {
    const qs = clearEvents ? "?clearEvents=true" : "";
    const res = await fetch(`/api/client/google-calendar/status${qs}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) throw new Error("disconnect_failed");
    setGoogle((g) => ({ ...g, connected: false, email: null, lastSyncISO: null }));
    if (clearEvents) await refreshEvents();
  }, [refreshEvents]);

  useEffect(() => {
    void refreshStatus().then(() => refreshEvents());
  }, [refreshEvents, refreshStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gp = params.get("google");
    if (gp === "connected") {
      void refreshStatus().then(() => refreshEvents());
    }
    if (gp === "error") setError(params.get("reason") || "Falha ao conectar Google.");
    if (gp) {
      params.delete("google");
      params.delete("reason");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
    }
  }, [refreshEvents, refreshStatus]);

  // Realtime: broadcast + postgres_changes fallback
  useEffect(() => {
    const tenantId = tenantRef.current;
    const sb = getSupabaseBrowserClient();
    if (!sb || !tenantId) return;

    const channel = sb
      .channel(agendaRealtimeChannel(tenantId))
      .on("broadcast", { event: "agenda_change" }, () => {
        void refreshEvents();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agenda_events", filter: `tenant_id=eq.${tenantId}` },
        () => {
          void refreshEvents();
        },
      )
      .subscribe();

    const poll = window.setInterval(() => void refreshEvents(), 60000);
    return () => {
      window.clearInterval(poll);
      void sb.removeChannel(channel);
    };
  }, [google.tenantId, refreshEvents]);

  return {
    events,
    google,
    loading,
    syncing,
    error,
    setError,
    refreshEvents,
    syncGoogle,
    createEvent,
    updateEvent,
    deleteEvent,
    connectGoogle,
    disconnectGoogle,
  };
}
