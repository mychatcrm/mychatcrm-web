"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import type { ClientSession } from "@/lib/client-auth";

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Web colour palette
// ─────────────────────────────────────────────────────────────────────────────
const W = {
  bgApp:      "#111b21",
  bgSidebar:  "#111b21",
  bgHeader:   "#202c33",
  bgBorder:   "#2a3942",
  bgInput:    "#2a3942",
  bgChat:     "#0b141a",
  bubbleIn:   "#202c33",
  bubbleOut:  "#005c4b",
  text:       "#e9edef",
  muted:      "#8696a0",
  green:      "#00a884",
} as const;

// Chat background: dark base + subtle dot pattern
const CHAT_BG_STYLE: React.CSSProperties = {
  background: W.bgChat,
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='1' fill='%23ffffff' fill-opacity='0.03'/%3E%3C/svg%3E\")",
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type WaMessage = {
  id: string;
  direction: "inbound" | "outbound";
  kind: "text" | "audio" | "image" | "document";
  content: string;
  media_url: string | null;
  agent_id: string | null;
  created_at: string;
};

type WaConversation = {
  remoteJid: string;
  lastContent: string;
  lastKind: string;
  lastDirection: string;
  lastAt: string;
  unreadCount: number;
  messages: WaMessage[];
  messagesLoaded: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Supabase browser singleton
// ─────────────────────────────────────────────────────────────────────────────
let _supa: ReturnType<typeof createClient> | null = null;
function getSupaBrowser() {
  if (!_supa) {
    _supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _supa;
}

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────
async function apiLoadConversations(): Promise<WaConversation[]> {
  const res = await fetch("/api/client/conversas", { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/client/conversas ${res.status}`);
  const data = (await res.json()) as {
    conversations: Omit<WaConversation, "messages" | "messagesLoaded">[];
  };
  return (data.conversations ?? []).map((c) => ({
    ...c,
    messages: [],
    messagesLoaded: false,
  }));
}

async function apiLoadMessages(remoteJid: string): Promise<WaMessage[]> {
  const enc = encodeURIComponent(remoteJid);
  const res = await fetch(`/api/client/conversas/${enc}/messages`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET messages ${res.status}`);
  const data = (await res.json()) as { messages: WaMessage[] };
  return data.messages ?? [];
}

async function apiSendMessage(remoteJid: string, text: string): Promise<WaMessage | null> {
  const res = await fetch("/api/client/conversas/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remoteJid, text }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Erro ${res.status} ao enviar`);
  }
  const data = (await res.json()) as { message?: WaMessage };
  return data.message ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters / helpers
// ─────────────────────────────────────────────────────────────────────────────
function jidToPhone(jid: string): string {
  return "+" + (jid.split("@")[0] ?? jid).replace(/\D/g, "");
}

function jidToInitials(jid: string): string {
  const digits = (jid.split("@")[0] ?? jid).replace(/\D/g, "");
  return digits.slice(-4, -2) || digits.slice(0, 2) || "?";
}

const AVATAR_PALETTE = [
  "#1565c0","#6a1b9a","#ad1457","#c62828",
  "#2e7d32","#00695c","#e65100","#4527a0",
];
function avatarColor(jid: string): string {
  let h = 0;
  for (let i = 0; i < jid.length; i++) h = ((h << 5) - h + jid.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]!;
}

function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

function formatFullDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return "";
  }
}

function previewFromConv(conv: WaConversation): string {
  const dir = conv.lastDirection === "outbound" ? "Você: " : "";
  if (conv.lastKind === "audio") return `${dir}🎵 Áudio`;
  if (conv.lastKind === "image") return `${dir}📷 Imagem`;
  return dir + conv.lastContent.slice(0, 70);
}

function sameCalendarDay(a: string, b: string): boolean {
  try {
    const da = new Date(a);
    const db = new Date(b);
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    );
  } catch {
    return false;
  }
}

function formatAudioTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Generates deterministic waveform bar heights from a string seed
function makeWaveBars(seed: string, count = 32): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return Array.from({ length: count }, (_, i) => {
    const v = ((h * (i + 1) * 1664525 + 1013904223) | 0) & 0x7fffffff;
    return 18 + (v % 82); // 18 – 100
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AudioPlayer — WhatsApp-style custom player
// ─────────────────────────────────────────────────────────────────────────────
function AudioPlayer({ src, msgId, isOut }: { src: string; msgId: string; isOut: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed]   = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = useMemo(() => makeWaveBars(msgId), [msgId]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { void a.play(); setPlaying(true); }
  }, [playing]);

  const onTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setElapsed(a.currentTime);
    setProgress(a.duration > 0 ? (a.currentTime / a.duration) * 100 : 0);
  }, []);

  const onLoaded = useCallback(() => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  }, []);

  const onEnded = useCallback(() => { setPlaying(false); setProgress(0); setElapsed(0); }, []);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration;
  }, []);

  const waveActive  = W.green;
  const waveInactive = isOut ? "rgba(255,255,255,0.25)" : "rgba(134,150,160,0.5)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 210, maxWidth: 270 }}>
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoaded}
        onEnded={onEnded}
        preload="metadata"
      />

      {/* Play / Pause */}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pausar" : "Reproduzir"}
        style={{
          width: 42, height: 42, borderRadius: "50%",
          background: W.green, border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="white">
            <rect x="2" y="1" width="4" height="12" rx="1" />
            <rect x="8" y="1" width="4" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="white">
            <path d="M3 1.5v11l9-5.5-9-5.5z" />
          </svg>
        )}
      </button>

      {/* Waveform + time */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        {/* Bars */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 1.5, height: 28, cursor: "pointer" }}
          onClick={seek}
        >
          {bars.map((ht, i) => {
            const pct = (i / bars.length) * 100;
            return (
              <div
                key={i}
                style={{
                  width: 2,
                  height: `${Math.max(4, (ht / 100) * 24)}px`,
                  borderRadius: 2,
                  background: pct <= progress ? waveActive : waveInactive,
                  flexShrink: 0,
                  transition: "background 0.08s",
                }}
              />
            );
          })}
        </div>

        {/* Elapsed / total */}
        <span style={{ fontSize: 11, color: W.muted, lineHeight: 1 }}>
          {playing ? formatAudioTime(elapsed) : formatAudioTime(duration || elapsed)}
        </span>
      </div>

      {/* Mic icon (decorative — indicates voice message) */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill={W.muted} style={{ flexShrink: 0, marginLeft: 2 }}>
        <path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke={W.muted} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <line x1="12" y1="19" x2="12" y2="23" stroke={W.muted} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="8" y1="23" x2="16" y2="23" stroke={W.muted} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ImageBubble — thumbnail + fullscreen overlay
// ─────────────────────────────────────────────────────────────────────────────
function ImageBubble({ src, caption }: { src: string; caption: string }) {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      <div
        style={{ cursor: "zoom-in", borderRadius: 6, overflow: "hidden" }}
        onClick={() => setFullscreen(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={caption || "Imagem"}
          style={{ display: "block", maxWidth: "100%", maxHeight: 260, objectFit: "cover", width: "100%" }}
          loading="lazy"
        />
        {caption && (
          <p style={{ margin: "4px 4px 2px", fontSize: 13, color: W.text }}>{caption}</p>
        )}
      </div>

      {fullscreen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.93)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setFullscreen(false)}
        >
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            aria-label="Fechar"
            style={{
              position: "absolute", top: 16, right: 16,
              background: "rgba(255,255,255,0.12)", border: "none",
              borderRadius: "50%", width: 44, height: 44,
              cursor: "pointer", color: "white", fontSize: 22,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={caption || "Imagem"}
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 4 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MessageBubble
// ─────────────────────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: WaMessage }) {
  const out = msg.direction === "outbound";
  const caption = msg.content.replace(/\[Imagem\]/g, "").trim();

  return (
    <div style={{ display: "flex", width: "100%", justifyContent: out ? "flex-end" : "flex-start" }}>
      <div
        className="max-w-[85%] lg:max-w-[65%]"
        style={{
          background: out ? W.bubbleOut : W.bubbleIn,
          borderRadius: out ? "8px 8px 0 8px" : "8px 8px 8px 0",
          padding: msg.kind === "image" && msg.media_url ? "4px 4px 0 4px" : "7px 10px 4px 10px",
          boxShadow: "0 1px 1px rgba(0,0,0,0.25)",
          position: "relative",
        }}
      >
        {/* ── Content ── */}
        {msg.kind === "audio" ? (
          msg.media_url ? (
            <AudioPlayer src={msg.media_url} msgId={msg.id} isOut={out} />
          ) : (
            <span style={{ color: W.muted, fontSize: 13 }}>🎵 Áudio</span>
          )
        ) : msg.kind === "image" ? (
          msg.media_url ? (
            <ImageBubble src={msg.media_url} caption={caption} />
          ) : (
            <span style={{ color: W.muted, fontSize: 13 }}>📷 Imagem</span>
          )
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: 14.2,
              lineHeight: 1.55,
              color: W.text,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              paddingRight: 52, // room for timestamp
            }}
          >
            {msg.content}
          </p>
        )}

        {/* ── Timestamp row ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 4,
            marginTop: msg.kind === "text" ? -14 : 3,
            paddingBottom: 2,
            paddingRight: msg.kind === "text" ? 0 : 4,
            float: msg.kind === "text" ? "right" : undefined,
          }}
        >
          {out && msg.agent_id && msg.agent_id !== "human" && (
            <span style={{ fontSize: 10, color: W.muted, opacity: 0.8 }}>IA</span>
          )}
          <span style={{ fontSize: 11, color: W.muted, whiteSpace: "nowrap" }}>
            {formatShortTime(msg.created_at)}
          </span>
          {out && (
            // Double tick ✓✓
            <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
              <path d="M1 5.5 4.5 9 10 1" stroke={W.green} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 5.5 8.5 9 15 1" stroke={W.green} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        {/* Clear float */}
        {msg.kind === "text" && <div style={{ clear: "both" }} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ConversationItem
// ─────────────────────────────────────────────────────────────────────────────
function ConversationItem({
  conv,
  selected,
  onSelect,
}: {
  conv: WaConversation;
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const phone = jidToPhone(conv.remoteJid);
  const initials = jidToInitials(conv.remoteJid);
  const bg = avatarColor(conv.remoteJid);

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", width: "100%", gap: 12, padding: "10px 16px",
        textAlign: "left", border: "none", cursor: "pointer",
        background: selected ? W.bgBorder : hovered ? "#1f2c34" : "transparent",
        borderBottom: `1px solid ${W.bgBorder}`,
        transition: "background 0.1s",
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 49, height: 49, borderRadius: "50%",
          background: bg, display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0,
          color: "white", fontSize: 17, fontWeight: 600,
          userSelect: "none",
        }}
      >
        {initials}
      </div>

      {/* Text content */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span style={{
            color: W.text, fontSize: 16.5, fontWeight: 500,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {phone}
          </span>
          <span style={{ color: conv.unreadCount > 0 ? W.green : W.muted, fontSize: 12, flexShrink: 0 }}>
            {formatShortTime(conv.lastAt)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <p style={{
            margin: 0, fontSize: 13.5, color: W.muted,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
          }}>
            {previewFromConv(conv)}
          </p>
          {conv.unreadCount > 0 && (
            <span style={{
              background: W.green, color: "white",
              borderRadius: 999, minWidth: 20, height: 20,
              padding: "0 5px", fontSize: 11.5, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export function OperacaoConversasHub({ session }: { session: ClientSession }) {
  const tenantId = session.tenantId;

  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [loading,      setLoading]        = useState(true);
  const [selectedJid,  setSelectedJid]    = useState<string | null>(null);
  const [query,        setQuery]          = useState("");
  const [draft,        setDraft]          = useState("");
  const [sendError,    setSendError]      = useState("");
  const [sending,      setSending]        = useState(false);
  const [mobileThread, setMobileThread]   = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiLoadConversations()
      .then((convs) => { if (!cancelled) { setConversations(convs); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  // ── Supabase Realtime ─────────────────────────────────────────────────────
  useEffect(() => {
    const supa = getSupaBrowser();
    const channel = supa
      .channel(`wamsg-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "whatsapp_messages",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          console.log("[realtime] INSERT recebido", payload.new);
          const row = payload.new as WaMessage & { remote_jid: string };
          const msg: WaMessage = {
            id: row.id,
            direction: row.direction,
            kind: row.kind,
            content: row.content,
            media_url: row.media_url,
            agent_id: row.agent_id,
            created_at: row.created_at,
          };
          const jid: string = row.remote_jid;
          setConversations((prev) => {
            const existing = prev.find((c) => c.remoteJid === jid);
            if (existing) {
              return prev
                .map((c) =>
                  c.remoteJid !== jid
                    ? c
                    : {
                        ...c,
                        lastContent: msg.content,
                        lastKind: msg.kind,
                        lastDirection: msg.direction,
                        lastAt: msg.created_at,
                        unreadCount:
                          msg.direction === "inbound" && jid !== selectedJid
                            ? c.unreadCount + 1
                            : c.unreadCount,
                        messages: c.messagesLoaded ? [...c.messages, msg] : c.messages,
                      },
                )
                .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
            }
            const newConv: WaConversation = {
              remoteJid: jid,
              lastContent: msg.content,
              lastKind: msg.kind,
              lastDirection: msg.direction,
              lastAt: msg.created_at,
              unreadCount: msg.direction === "inbound" ? 1 : 0,
              messages: [msg],
              messagesLoaded: true,
            };
            return [newConv, ...prev];
          });
        },
      )
      .subscribe((status) => {
        console.log("[realtime] status do canal:", status);
      });

    return () => { void supa.removeChannel(channel); };
  }, [tenantId, selectedJid]);

  // ── Polling de fallback (garante sincronização mesmo sem Realtime) ─────────
  // Atualiza a lista de conversas a cada 10s e as mensagens da conversa ativa a cada 5s
  useEffect(() => {
    const refreshConvs = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const convs = await apiLoadConversations();
        setConversations((prev) =>
          convs.map((c) => {
            const existing = prev.find((p) => p.remoteJid === c.remoteJid);
            return existing
              ? { ...c, messages: existing.messages, messagesLoaded: existing.messagesLoaded }
              : c;
          }),
        );
      } catch { /* silencioso */ }
    };
    const convInterval = setInterval(() => void refreshConvs(), 10_000);
    return () => clearInterval(convInterval);
  }, []);

  useEffect(() => {
    if (!selectedJid) return;
    const refreshMsgs = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const msgs = await apiLoadMessages(selectedJid);
        setConversations((prev) =>
          prev.map((c) =>
            c.remoteJid === selectedJid ? { ...c, messages: msgs, messagesLoaded: true } : c,
          ),
        );
      } catch { /* silencioso */ }
    };
    const msgInterval = setInterval(() => void refreshMsgs(), 5_000);
    return () => clearInterval(msgInterval);
  }, [selectedJid]);

  // ── Select conversation ───────────────────────────────────────────────────
  const handleSelect = useCallback(
    async (jid: string) => {
      setSelectedJid(jid);
      setMobileThread(true);
      setSendError("");
      setDraft("");
      setConversations((prev) => prev.map((c) => (c.remoteJid === jid ? { ...c, unreadCount: 0 } : c)));

      const conv = conversations.find((c) => c.remoteJid === jid);
      if (conv?.messagesLoaded) return;

      try {
        const msgs = await apiLoadMessages(jid);
        setConversations((prev) =>
          prev.map((c) => (c.remoteJid === jid ? { ...c, messages: msgs, messagesLoaded: true } : c)),
        );
      } catch (e) {
        console.warn("[conversas] load messages error", e);
      }
    },
    [conversations],
  );

  // ── Scroll to bottom ──────────────────────────────────────────────────────
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedJid, conversations]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!selectedJid || !draft.trim() || sending) return;
    setSendError("");
    const text = draft.trim();
    setDraft("");
    setSending(true);

    const tempMsg: WaMessage = {
      id: `temp-${Date.now()}`,
      direction: "outbound",
      kind: "text",
      content: text,
      media_url: null,
      agent_id: "human",
      created_at: new Date().toISOString(),
    };
    setConversations((prev) =>
      prev.map((c) =>
        c.remoteJid !== selectedJid
          ? c
          : { ...c, messages: [...c.messages, tempMsg], lastContent: text, lastAt: tempMsg.created_at },
      ),
    );

    try {
      const saved = await apiSendMessage(selectedJid, text);
      if (saved) {
        setConversations((prev) =>
          prev.map((c) =>
            c.remoteJid !== selectedJid
              ? c
              : { ...c, messages: c.messages.map((m) => (m.id === tempMsg.id ? saved : m)) },
          ),
        );
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Erro ao enviar mensagem.");
      setConversations((prev) =>
        prev.map((c) =>
          c.remoteJid !== selectedJid
            ? c
            : { ...c, messages: c.messages.filter((m) => m.id !== tempMsg.id) },
        ),
      );
    } finally {
      setSending(false);
    }
  }, [selectedJid, draft, sending]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.remoteJid.toLowerCase().includes(q) ||
        jidToPhone(c.remoteJid).includes(q) ||
        c.lastContent.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  const active = useMemo(
    () => conversations.find((c) => c.remoteJid === selectedJid) ?? null,
    [conversations, selectedJid],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="h-[min(780px,calc(100dvh-80px))] md:h-[min(780px,calc(100dvh-96px))]"
      style={{
        display: "flex",
        background: W.bgApp,
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${W.bgBorder}`,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* ─────────────── LEFT SIDEBAR ─────────────── */}
      <div
        className={cn(
          mobileThread ? "hidden md:flex" : "flex",
          // Responsive widths: md=240px, lg=320px, xl=360px
          "md:w-[240px] lg:w-[320px] xl:w-[360px]",
        )}
        style={{
          flexDirection: "column",
          background: W.bgSidebar,
          borderRight: `1px solid ${W.bgBorder}`,
          flexShrink: 0,
        }}
      >
        {/* Sidebar header */}
        <div
          style={{
            background: W.bgHeader,
            height: 59,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 600, color: W.text }}>MyChatCRM</span>
          <div style={{ display: "flex", gap: 6 }}>
            {/* Dots menu icon (decorative) */}
            <button
              type="button"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: "50%" }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill={W.muted}>
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: "8px 12px", background: W.bgSidebar, flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke={W.muted}
              strokeWidth="2"
              strokeLinecap="round"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ou começar nova conversa"
              style={{
                width: "100%",
                height: 35,
                background: W.bgInput,
                border: "none",
                borderRadius: 8,
                paddingLeft: 34,
                paddingRight: 12,
                fontSize: 13.5,
                color: W.text,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: W.muted, fontSize: 14 }}>
              Carregando conversas…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 28, textAlign: "center", color: W.muted, fontSize: 13.5, lineHeight: 1.6 }}>
              {conversations.length === 0
                ? "Nenhuma conversa ainda.\nAs mensagens WhatsApp aparecerão aqui automaticamente."
                : "Nenhuma conversa encontrada."}
            </div>
          ) : (
            filtered.map((c) => (
              <ConversationItem
                key={c.remoteJid}
                conv={c}
                selected={c.remoteJid === selectedJid}
                onSelect={() => void handleSelect(c.remoteJid)}
              />
            ))
          )}
        </div>
      </div>

      {/* ─────────────── RIGHT CHAT PANEL ─────────────── */}
      <div
        className={cn(!mobileThread && !selectedJid ? "hidden md:flex" : "flex")}
        style={{ flex: 1, flexDirection: "column", minWidth: 0 }}
      >
        {!active ? (
          /* Empty state */
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 20,
              padding: 32,
              textAlign: "center",
              ...CHAT_BG_STYLE,
            }}
          >
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: "50%",
                background: "#1f2c34",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg viewBox="0 0 24 24" width="44" height="44" fill={W.muted}>
                <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2.546 21.5a.5.5 0 0 0 .63.63l4.332-.892A9.96 9.96 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z" />
              </svg>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 300, color: W.text }}>
                MyChatCRM
              </p>
              <p style={{ margin: "10px 0 0", fontSize: 14, color: W.muted, maxWidth: 320 }}>
                Selecione uma conversa à esquerda para visualizar as mensagens.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div
              style={{
                background: W.bgHeader,
                height: 59,
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
                gap: 10,
                flexShrink: 0,
                borderBottom: `1px solid ${W.bgBorder}`,
              }}
            >
              {/* Back button (mobile only) */}
              <button
                type="button"
                className="md:hidden"
                onClick={() => { setSelectedJid(null); setMobileThread(false); }}
                aria-label="Voltar"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: W.muted }}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={W.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              {/* Avatar */}
              <div
                style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: avatarColor(active.remoteJid),
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "white", fontSize: 14, fontWeight: 600, flexShrink: 0,
                  userSelect: "none",
                }}
              >
                {jidToInitials(active.remoteJid)}
              </div>

              {/* Contact info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: W.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {jidToPhone(active.remoteJid)}
                </p>
                <p style={{ margin: 0, fontSize: 12.5, color: W.muted }}>
                  {active.messages.length > 0 ? "online" : "WhatsApp"}
                </p>
              </div>

              {/* Action icons (decorative) */}
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={W.muted} strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                </button>
                <button type="button" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill={W.muted}>
                    <circle cx="12" cy="5" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="12" cy="19" r="1.5" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages thread */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "12px 5%",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                ...CHAT_BG_STYLE,
              }}
            >
              {!active.messagesLoaded ? (
                <div style={{ textAlign: "center", padding: 32, color: W.muted, fontSize: 14 }}>
                  Carregando mensagens…
                </div>
              ) : active.messages.length === 0 ? (
                <div
                  style={{
                    margin: "auto",
                    background: "rgba(11,20,26,0.85)",
                    borderRadius: 10,
                    padding: "8px 16px",
                    fontSize: 13,
                    color: W.muted,
                    backdropFilter: "blur(4px)",
                  }}
                >
                  Sem mensagens nesta conversa ainda.
                </div>
              ) : (
                active.messages.map((m, i) => {
                  const prev = active.messages[i - 1];
                  const showDateSep =
                    !prev || !sameCalendarDay(prev.created_at, m.created_at);
                  return (
                    <div key={m.id}>
                      {showDateSep && (
                        <div style={{ display: "flex", justifyContent: "center", margin: "10px 0 6px" }}>
                          <span
                            style={{
                              background: "#1a2730",
                              color: W.muted,
                              borderRadius: 8,
                              padding: "4px 14px",
                              fontSize: 12,
                            }}
                          >
                            {formatFullDate(m.created_at)}
                          </span>
                        </div>
                      )}
                      <MessageBubble msg={m} />
                    </div>
                  );
                })
              )}
              <div ref={threadEndRef} />
            </div>

            {/* Input footer */}
            <div
              style={{
                background: W.bgHeader,
                padding: "8px 12px",
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {sendError && (
                <div
                  style={{
                    background: "rgba(229,57,53,0.15)",
                    borderRadius: 8,
                    padding: "5px 12px",
                    fontSize: 12,
                    color: "#ef5350",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  ⚠ {sendError}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                {/* Left decorative icons */}
                <div style={{ display: "flex", gap: 2, paddingBottom: 9 }}>
                  {/* Emoji */}
                  <button
                    type="button"
                    title="Emoji"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 5 }}
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={W.muted} strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2" strokeLinecap="round" />
                      <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="2.5" strokeLinecap="round" />
                      <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </button>
                  {/* Attach */}
                  <button
                    type="button"
                    title="Anexar"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 5 }}
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={W.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                </div>

                {/* Text input */}
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 4000))}
                  rows={1}
                  placeholder="Digite uma mensagem"
                  disabled={sending}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  className="placeholder:text-[#8696a0]"
                  style={{
                    flex: 1,
                    minHeight: 42,
                    maxHeight: 130,
                    background: W.bgInput,
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 14px",
                    fontSize: 14.5,
                    color: W.text,
                    outline: "none",
                    resize: "none",
                    fontFamily: "inherit",
                    lineHeight: 1.4,
                  }}
                />

                {/* Send button */}
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || !draft.trim()}
                  aria-label="Enviar"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: W.green,
                    border: "none",
                    cursor: draft.trim() && !sending ? "pointer" : "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    opacity: sending || !draft.trim() ? 0.45 : 1,
                    transition: "opacity 0.2s",
                    paddingBottom: 9,
                  }}
                >
                  {sending ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  )}
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 10, color: W.bgBorder, textAlign: "right" }}>
                {draft.length > 0 ? `${draft.length}/4000` : ""}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
