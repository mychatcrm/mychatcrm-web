"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import type { ClientSession } from "@/lib/client-auth";

// ── Emoji picker (data + react component) ────────────────────────────────────
// Antes usávamos `require("@emoji-mart/data")` no top-level, que em Next.js
// 14 client-side podia retornar `{ default: {...} }` (CJS interop) — o
// emoji-mart core esperava o objeto direto e a chamada `data.categories.unshift`
// dentro de `init()` falhava silenciosamente em uma Promise sem catch,
// deixando o shadow root vazio e o picker invisível.
// Agora carregamos data + react picker juntos via dynamic import, garantindo
// que ambos rodem só no client (`ssr: false`) e tratamos o default-wrap.
const EmojiPicker = dynamic(
  async () => {
    const [pickerMod, dataMod] = await Promise.all([
      import("@emoji-mart/react"),
      import("@emoji-mart/data"),
    ]);
    const Picker = (pickerMod as { default: React.ComponentType<Record<string, unknown>> }).default;
    const rawData = dataMod as { default?: unknown } & Record<string, unknown>;
    const data: unknown = rawData.default ?? rawData;
    // Wrapper que injeta `data` por padrão; o caller só passa configs visuais.
    const Wrapped: React.FC<Record<string, unknown>> = (props) => {
      return <Picker data={data} {...props} />;
    };
    Wrapped.displayName = "EmojiPickerWithData";
    return Wrapped;
  },
  { ssr: false },
);

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

async function apiDeleteConversation(remoteJid: string): Promise<void> {
  const enc = encodeURIComponent(remoteJid);
  const res = await fetch(`/api/client/conversas/${enc}/messages`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`DELETE conversation ${res.status}`);
}

async function apiDeleteAllConversations(): Promise<void> {
  const res = await fetch("/api/client/conversas/all", {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`DELETE all conversations ${res.status}`);
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

function conversationWithMessages(conv: WaConversation, messages: WaMessage[]): WaConversation | null {
  if (messages.length === 0) return null;
  const last = messages[messages.length - 1]!;
  return {
    ...conv,
    lastContent: last.content,
    lastKind: last.kind,
    lastDirection: last.direction,
    lastAt: last.created_at,
    messages,
    messagesLoaded: true,
  };
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

// ── Highlight matching text in a string (case-insensitive) ──────────────────
function highlightText(text: string, term: string): ReactNode {
  if (!term.trim()) return text;
  const termLower = term.toLowerCase();
  const textLower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let idx = textLower.indexOf(termLower, lastIndex);
  while (idx !== -1) {
    if (idx > lastIndex) parts.push(text.slice(lastIndex, idx));
    parts.push(
      <mark
        key={idx}
        style={{
          background: "#f0c842",
          color: "#111",
          borderRadius: 2,
          padding: "0 1px",
        }}
      >
        {text.slice(idx, idx + term.length)}
      </mark>,
    );
    lastIndex = idx + term.length;
    idx = textLower.indexOf(termLower, lastIndex);
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
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

      {/* Download button */}
      <a
        href={src}
        download={`audio-${msgId}.ogg`}
        target="_blank"
        rel="noreferrer"
        title="Baixar áudio"
        onClick={(e) => e.stopPropagation()}
        style={{
          color: W.green,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginLeft: 2,
          opacity: 0.8,
          textDecoration: "none",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={W.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </a>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ImageBubble — thumbnail + fullscreen overlay
// ─────────────────────────────────────────────────────────────────────────────
function ImageBubble({ src, caption }: { src: string; caption: string }) {
  const [fullscreen, setFullscreen] = useState(false);

  // Fecha o fullscreen ao pressionar Escape
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fullscreen]);

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
function MessageBubble({
  msg,
  highlight,
}: {
  msg: WaMessage;
  highlight?: string;
}) {
  const out = msg.direction === "outbound";
  const caption = msg.content.replace(/\[Imagem\]/g, "").trim();

  // ── Spacer dinâmico para a técnica WhatsApp ──────────────────────────────
  // O spacer invisível no final do texto reserva espaço para o timestamp
  // sobreposto via float. Valores fixos (64/46px) só cobrem "HH:MM" + tick,
  // mas formatShortTime devolve "DD de MMM" (~10 chars, +60% mais largo)
  // para mensagens de outros dias — e o timestamp transbordava o spacer,
  // sobrepondo o texto em balões curtos ("Oi"). Calculamos a largura real
  // aproximada baseado em chars × ~6px (font 11px) + extras.
  const tsText = formatShortTime(msg.created_at);
  const showsIA = Boolean(out && msg.agent_id && msg.agent_id !== "human");
  const charW = 6;              // largura média de caractere em font 11px
  const tickW = out ? 20 : 0;   // svg 16px + gap 4px
  const iaW = showsIA ? 18 : 0; // "IA" 14px + gap 4px
  const spacerWidth = Math.ceil(tsText.length * charW + tickW + iaW + 12); // +12 buffer

  // Timestamp row — shared by all bubble types
  const TimestampRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
      {showsIA && (
        <span style={{ fontSize: 10, color: W.muted, opacity: 0.8 }}>IA</span>
      )}
      <span style={{ fontSize: 11, color: W.muted, whiteSpace: "nowrap" }}>
        {tsText}
      </span>
      {out && (
        // Double tick ✓✓
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <path d="M1 5.5 4.5 9 10 1" stroke={W.green} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 5.5 8.5 9 15 1" stroke={W.green} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", width: "100%", justifyContent: out ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "85%",
          background: out ? W.bubbleOut : W.bubbleIn,
          borderRadius: out ? "8px 8px 0 8px" : "8px 8px 8px 0",
          padding: msg.kind === "image" && msg.media_url ? "4px 4px 0 4px" : "7px 10px 5px 10px",
          boxShadow: "0 1px 1px rgba(0,0,0,0.25)",
          position: "relative",
        }}
      >
        {/* ── Content ── */}
        {msg.kind === "audio" ? (
          <>
            {msg.media_url ? (
              <AudioPlayer src={msg.media_url} msgId={msg.id} isOut={out} />
            ) : (
              <span style={{ color: W.muted, fontSize: 13 }}>🎵 Áudio</span>
            )}
            {/* Timestamp below audio player */}
            <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 3, paddingBottom: 1 }}>
              {TimestampRow}
            </div>
          </>
        ) : msg.kind === "image" ? (
          <>
            {msg.media_url ? (
              <ImageBubble src={msg.media_url} caption={caption} />
            ) : (
              <span style={{ color: W.muted, fontSize: 13 }}>📷 Imagem</span>
            )}
            {/* Timestamp below image */}
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "3px 4px 2px" }}>
              {TimestampRow}
            </div>
          </>
        ) : (
          /*
           * Text bubble — WhatsApp spacer technique:
           *
           * An invisible inline <span> at the end of the text pushes the last
           * line so it never overlaps the timestamp. The timestamp is floated
           * right with a negative margin-top equal to the spacer height, so it
           * "rises" to sit beside the spacer on that last line.
           *
           * Spacer width = spacerWidth (calculado acima, baseado no tsText
           * real para acomodar tanto "HH:MM" quanto "DD de MMM").
           */
          <>
            <p
              style={{
                margin: 0,
                fontSize: 14.2,
                lineHeight: 1.55,
                color: W.text,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {highlight ? highlightText(msg.content, highlight) : msg.content}
              {/* Invisible spacer — reserves the last-line slot for the timestamp */}
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: spacerWidth,
                  height: 15,
                  verticalAlign: "bottom",
                }}
              />
            </p>
            {/* Timestamp floated right, rises up next to the spacer */}
            <div
              style={{
                float: "right",
                marginTop: -15,
                display: "flex",
                alignItems: "center",
                gap: 4,
                paddingBottom: 1,
              }}
            >
              {TimestampRow}
            </div>
            {/* Clears the float so the bubble grows to contain it */}
            <div style={{ clear: "both" }} />
          </>
        )}
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
  photoUrl,
  name,
  onPhotoClick,
}: {
  conv: WaConversation;
  selected: boolean;
  onSelect: () => void;
  photoUrl?: string | null;
  name?: string | null;
  onPhotoClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const phone = jidToPhone(conv.remoteJid);
  const initials = jidToInitials(conv.remoteJid);
  const bg = avatarColor(conv.remoteJid);
  const showPhoto = photoUrl && !imgError;
  const displayName = name ?? phone;

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
      {/* Avatar — clique na foto abre fullscreen (sem propagar select) */}
      <div
        onClick={onPhotoClick ? (e) => { e.stopPropagation(); onPhotoClick(); } : undefined}
        style={{
          width: 49, height: 49, borderRadius: "50%",
          background: bg, display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0,
          color: "white", fontSize: 17, fontWeight: 600,
          userSelect: "none", overflow: "hidden",
          cursor: onPhotoClick ? "zoom-in" : "pointer",
        }}
      >
        {showPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={displayName}
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
          />
        ) : initials}
      </div>

      {/* Text content */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
        {/* Row 1: nome (ou número) + timestamp */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span style={{
            color: W.text, fontSize: 16.5, fontWeight: 500,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {displayName}
          </span>
          <span style={{ color: conv.unreadCount > 0 ? W.green : W.muted, fontSize: 12, flexShrink: 0 }}>
            {formatShortTime(conv.lastAt)}
          </span>
        </div>

        {/* Row 1.5: número abaixo do nome (só quando há nome) */}
        {name && (
          <span style={{
            color: "#8696a0", fontSize: 12,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {phone}
          </span>
        )}

        {/* Row 2: preview da última mensagem + badge de não lidas */}
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
// SidebarPanel — width driven by JS to bypass Tailwind JIT cache issues
// breakpoints: <768 hidden, 768–1024 240px, 1024–1280 320px, 1280–1536 380px, 1536+ 420px
// ─────────────────────────────────────────────────────────────────────────────
function getDesktopSidebarWidth(w: number): number {
  // Returns fixed px for desktop breakpoints; 0 means "mobile mode"
  if (w < 768) return 0;
  if (w < 1024) return 240;
  if (w < 1280) return 320;
  if (w < 1536) return 380;
  return 420;
}

function SidebarPanel({
  mobileThread,
  children,
}: {
  mobileThread: boolean;
  children: ReactNode;
}) {
  const [winWidth, setWinWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );

  useEffect(() => {
    const update = () => setWinWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const isMobile = winWidth < 768;
  const desktopWidth = getDesktopSidebarWidth(winWidth);

  // On mobile: show sidebar only when no chat is open (mobileThread === false)
  // On desktop: always show sidebar with computed fixed width
  const isHidden = isMobile && mobileThread;

  return (
    <div
      style={{
        display: isHidden ? "none" : "flex",
        flexDirection: "column",
        // Mobile: full width; Desktop: fixed breakpoint width
        width: isMobile ? "100%" : desktopWidth,
        flexShrink: 0,
        background: W.bgSidebar,
        borderRight: `1px solid ${W.bgBorder}`,
      }}
    >
      {children}
    </div>
  );
}

function ConfirmDeleteModal({
  title,
  description,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.62)",
        padding: 18,
      }}
      onClick={busy ? undefined : onCancel}
    >
      <div
        style={{
          width: "min(430px, 100%)",
          borderRadius: 14,
          background: W.bgHeader,
          border: `1px solid ${W.bgBorder}`,
          boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ margin: 0, color: W.text, fontSize: 18, fontWeight: 650 }}>{title}</p>
        <p style={{ margin: "10px 0 0", color: W.muted, fontSize: 14, lineHeight: 1.55 }}>
          {description}
        </p>
        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              border: `1px solid ${W.bgBorder}`,
              background: "transparent",
              color: W.text,
              borderRadius: 999,
              padding: "9px 14px",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.55 : 1,
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              border: "none",
              background: "#d64d4d",
              color: "white",
              borderRadius: 999,
              padding: "9px 15px",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
              fontWeight: 650,
            }}
          >
            {busy ? "Apagando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export function OperacaoConversasHub({ session }: { session: ClientSession }) {
  const tenantId = session.tenantId;

  const [conversations,  setConversations]  = useState<WaConversation[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [selectedJid,    setSelectedJid]    = useState<string | null>(null);
  const [query,          setQuery]          = useState("");
  const [draft,          setDraft]          = useState("");
  const [sendError,      setSendError]      = useState("");
  const [sending,        setSending]        = useState(false);
  const [mobileThread,   setMobileThread]   = useState(false);
  const [chatMenuOpen,   setChatMenuOpen]   = useState(false);
  const [sidebarMenuOpen,setSidebarMenuOpen]= useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState<"conversation" | "all" | null>(null);
  const [deleteBusy,     setDeleteBusy]     = useState(false);
  // Mapa JID → URL da foto (null = não tem foto, undefined = ainda não buscou)
  const [contactPhotos,  setContactPhotos]  = useState<Record<string, string | null>>({});
  // Mapa JID → nome do contato (null = sem nome)
  const [contactNames,   setContactNames]   = useState<Record<string, string | null>>({});
  // Overlay de foto fullscreen (null = fechado)
  const [photoOverlay,   setPhotoOverlay]   = useState<string | null>(null);

  // ── In-conversation search state ─────────────────────────────────────────
  const [inConvSearch,   setInConvSearch]   = useState(false);
  const [inConvQuery,    setInConvQuery]    = useState("");
  const [inConvMatchIdx, setInConvMatchIdx] = useState(0);

  // ── Scroll state ──────────────────────────────────────────────────────────
  // isScrollable: true when there's enough content to scroll (shows nav buttons)
  const [isScrollable,   setIsScrollable]   = useState(false);

  // ── Emoji picker ──────────────────────────────────────────────────────────
  const [emojiOpen,      setEmojiOpen]      = useState(false);

  // ── File attachment state ─────────────────────────────────────────────────
  type AttachmentKind = "image" | "audio" | "video" | "document";
  type AttachmentState = { file: File; previewUrl: string; kind: AttachmentKind };
  const [attachment,     setAttachment]     = useState<AttachmentState | null>(null);
  const [uploading,      setUploading]      = useState(false);

  // Cache em ref para evitar fetches duplicados concorrentes
  const photoCacheRef    = useRef<Set<string>>(new Set());
  const nameCacheRef     = useRef<Set<string>>(new Set());
  // Ref para saber se o usuário está perto do final (< 150px do bottom)
  const isNearBottomRef  = useRef(true);
  // Ref para evitar flicker ao atualizar isScrollable
  const isScrollableRef  = useRef(false);

  const threadEndRef     = useRef<HTMLDivElement>(null);
  const msgContainerRef  = useRef<HTMLDivElement>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);
  const emojiPickerRef   = useRef<HTMLDivElement>(null);
  // Ref no próprio toggle button — necessário para que o outside-click handler
  // ignore cliques no botão (caso contrário ele fecha o picker no mesmo tick
  // em que o onClick está tentando abri-lo, anulando o toggle).
  const emojiButtonRef   = useRef<HTMLButtonElement>(null);
  // Ref no botão de anexo — mesmo motivo (não relevante hoje, mas mantém
  // simetria caso adicionemos um popover de attachment no futuro).
  const attachButtonRef  = useRef<HTMLButtonElement>(null);
  // Wrapper interno cujo tamanho é observado por ResizeObserver para
  // re-pinning do scroll quando imagens/áudios completam o load.
  const msgInnerRef      = useRef<HTMLDivElement>(null);
  // True enquanto o initial-scroll está activo (logo após abrir a conversa).
  // Desliga ao primeiro scroll manual do usuário para não brigar com ele.
  const initialPinRef    = useRef(false);
  const inConvSearchRef  = useRef<HTMLInputElement>(null);

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

  // ── Fetch contact photo (cached) ─────────────────────────────────────────
  const fetchPhoto = useCallback((jid: string) => {
    if (photoCacheRef.current.has(jid)) return;
    photoCacheRef.current.add(jid);
    const url = `/api/client/conversas/contact-photo?jid=${encodeURIComponent(jid)}`;
    setContactPhotos((prev) => ({ ...prev, [jid]: url }));
  }, []);

  // ── Fetch contact name (cached) ───────────────────────────────────────────
  const fetchName = useCallback(async (jid: string) => {
    if (nameCacheRef.current.has(jid)) return;
    nameCacheRef.current.add(jid);
    try {
      const res = await fetch(`/api/client/conversas/contact-name?jid=${encodeURIComponent(jid)}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { name: string | null };
        if (data.name) setContactNames((prev) => ({ ...prev, [jid]: data.name }));
      }
    } catch { /* silencioso */ }
  }, []);

  // ── Scroll handler for messages container ────────────────────────────────
  const handleMsgScroll = useCallback(() => {
    const el = msgContainerRef.current;
    if (!el) return;
    // Distance from bottom — usado para decidir auto-scroll em novas mensagens
    // e para desligar o initial-pin assim que o user rola para longe.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 150;
    // Se o user rolou pra fora do fim durante a janela de initial-pin,
    // libera o pin para que ResizeObserver não force o scroll de volta.
    if (initialPinRef.current && distanceFromBottom > 80) {
      initialPinRef.current = false;
    }
    // Scrollable: enough content to need navigation
    const scrollable = el.scrollHeight > el.clientHeight + 100;
    if (scrollable !== isScrollableRef.current) {
      isScrollableRef.current = scrollable;
      setIsScrollable(scrollable);
    }
  }, []);

  // ── Update scrollable after messages change (e.g. after load) ───────────
  useEffect(() => {
    // Use rAF to wait for DOM paint
    const id = requestAnimationFrame(() => {
      const el = msgContainerRef.current;
      if (!el) return;
      const scrollable = el.scrollHeight > el.clientHeight + 100;
      if (scrollable !== isScrollableRef.current) {
        isScrollableRef.current = scrollable;
        setIsScrollable(scrollable);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [selectedJid, conversations]);

  // ── Select conversation ───────────────────────────────────────────────────
  const handleSelect = useCallback(
    async (jid: string) => {
      setSelectedJid(jid);
      setMobileThread(true);
      setSendError("");
      setDraft("");
      // Reset search when switching conversations
      setInConvSearch(false);
      setInConvQuery("");
      setInConvMatchIdx(0);
      setChatMenuOpen(false);
      // Reset near-bottom so new conversation always scrolls to bottom
      isNearBottomRef.current = true;
      setConversations((prev) => prev.map((c) => (c.remoteJid === jid ? { ...c, unreadCount: 0 } : c)));

      // Busca foto e nome do contato (não bloqueia a abertura da conversa)
      void fetchPhoto(jid);
      void fetchName(jid);

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
    [conversations, fetchPhoto, fetchName],
  );

  // Conversa actualmente aberta — derivada de conversations + selectedJid.
  // Declarada aqui (antes dos effects que dependem de `active?.messagesLoaded`)
  // para evitar "used before declaration" em TypeScript strict.
  const active = useMemo(
    () => conversations.find((c) => c.remoteJid === selectedJid) ?? null,
    [conversations, selectedJid],
  );

  const handleDeleteConversation = useCallback(() => {
    if (!active || deleteBusy) return;
    const jid = active.remoteJid;
    setDeleteBusy(true);
    setConversations((prev) => prev.filter((c) => c.remoteJid !== jid));
    setSelectedJid(null);
    setMobileThread(false);
    void apiDeleteConversation(jid)
      .catch((e) => {
        setSendError(e instanceof Error ? e.message : "Erro ao apagar conversa.");
      })
      .finally(() => {
        setDeleteBusy(false);
        setConfirmDelete(null);
      });
  }, [active, deleteBusy]);

  const handleDeleteAllConversations = useCallback(() => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setConversations([]);
    setSelectedJid(null);
    setMobileThread(false);
    void apiDeleteAllConversations()
      .catch((e) => {
        setSendError(e instanceof Error ? e.message : "Erro ao limpar conversas.");
      })
      .finally(() => {
        setDeleteBusy(false);
        setConfirmDelete(null);
      });
  }, [deleteBusy]);

  // ── Initial scroll: instant jump to bottom when conversation opens ────────
  // Fires when selectedJid changes OR when messagesLoaded flips to true.
  // Estratégia: pin imediato + ResizeObserver no wrapper interno para
  // re-pinning enquanto mídias (imagens/áudios) ainda inflam o layout.
  // O double-rAF anterior falhava porque imagens grandes só chegam ao DOM
  // ~100-500ms depois do paint inicial — o scrollHeight ainda crescia e
  // o scrollTop ficava congelado num ponto intermediário.
  useEffect(() => {
    const el = msgContainerRef.current;
    const inner = msgInnerRef.current;
    if (!el || !inner || !active?.messagesLoaded) return;

    const pinToBottom = () => {
      el.scrollTop = el.scrollHeight;
    };

    // Ativa a janela de initial-pin: handleMsgScroll desliga se user rolar.
    initialPinRef.current = true;
    pinToBottom();
    isNearBottomRef.current = true;

    // Re-pin sempre que o conteúdo crescer (imagem carregou, áudio expandiu,
    // mensagem nova chegou via realtime, etc.) — desde que o usuário não
    // tenha rolado para longe.
    const observer = new ResizeObserver(() => {
      if (!initialPinRef.current) return;
      pinToBottom();
    });
    observer.observe(inner);

    // Defensivo: também ouve `load` em <img> dentro do inner. Algumas imagens
    // podem disparar load com tamanho estável após o ResizeObserver já ter
    // perdido relevância — esse listener pega o último frame.
    const onImgLoad = () => {
      if (!initialPinRef.current) return;
      pinToBottom();
    };
    const imgs = inner.querySelectorAll("img");
    imgs.forEach((img) => {
      if (!img.complete) img.addEventListener("load", onImgLoad, { once: true });
    });

    // Libera o pin após 2s — janela suficiente para a maioria das mídias.
    // Depois disso, qualquer crescimento (ex.: mensagem nova) usa o effect
    // separado de auto-scroll baseado em isNearBottomRef.
    const releaseId = window.setTimeout(() => {
      initialPinRef.current = false;
      observer.disconnect();
    }, 2000);

    return () => {
      initialPinRef.current = false;
      observer.disconnect();
      window.clearTimeout(releaseId);
      imgs.forEach((img) => img.removeEventListener("load", onImgLoad));
    };
  // active?.messagesLoaded changes independently of conversations object ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJid, active?.messagesLoaded]);

  // ── Auto-scroll for new messages arriving in the open conversation ─────────
  // Smooth scroll — only when user is already near the bottom.
  // Does not run on conversation switch (handled by the effect above).
  useEffect(() => {
    if (!isNearBottomRef.current) return;
    const raf = requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [conversations]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!selectedJid || !draft.trim() || sending) return;
    setSendError("");
    const text = draft.trim();
    setDraft("");
    setSending(true);
    // When user sends a message, we want to scroll to bottom
    isNearBottomRef.current = true;

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

  // ── Emoji insert at cursor ────────────────────────────────────────────────
  const handleEmojiSelect = useCallback((emoji: { native?: string; unified?: string }) => {
    const native = emoji.native ?? (emoji.unified ? String.fromCodePoint(...emoji.unified.split("-").map((u) => parseInt(u, 16))) : "");
    if (!native) return;
    const ta = draftTextareaRef.current;
    if (!ta) {
      setDraft((d) => (d + native).slice(0, 4000));
      return;
    }
    const start = ta.selectionStart ?? draft.length;
    const end   = ta.selectionEnd   ?? draft.length;
    const next  = (draft.slice(0, start) + native + draft.slice(end)).slice(0, 4000);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.selectionStart = start + native.length;
      ta.selectionEnd   = start + native.length;
      ta.focus();
    });
  }, [draft]);

  // ── File attachment select ────────────────────────────────────────────────
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mime = file.type.toLowerCase();
    let kind: AttachmentKind;
    if (mime.startsWith("image/")) kind = "image";
    else if (mime.startsWith("audio/")) kind = "audio";
    else if (mime.startsWith("video/")) kind = "video";
    else kind = "document";
    const previewUrl = kind === "image" ? URL.createObjectURL(file) : "";
    setAttachment({ file, previewUrl, kind });
    e.target.value = "";
  }, []);

  // Revoke object URL when attachment changes to avoid memory leaks
  useEffect(() => {
    return () => {
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment?.previewUrl]);

  // ── Send media ────────────────────────────────────────────────────────────
  const handleSendMedia = useCallback(async () => {
    if (!attachment || !selectedJid || uploading) return;
    setUploading(true);
    setSendError("");
    isNearBottomRef.current = true;
    try {
      const fd = new FormData();
      fd.append("file", attachment.file);
      fd.append("remoteJid", selectedJid);
      const res = await fetch("/api/client/conversas/send-media", { method: "POST", body: fd });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Erro ${res.status}`);
      }
      const data = (await res.json()) as { message?: WaMessage | null };
      if (data.message) {
        const msg = data.message;
        setConversations((prev) =>
          prev.map((c) =>
            c.remoteJid !== selectedJid ? c :
            { ...c, messages: [...c.messages, msg], lastContent: msg.content, lastAt: msg.created_at },
          ),
        );
      }
      setAttachment(null);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Erro ao enviar arquivo.");
    } finally {
      setUploading(false);
    }
  }, [attachment, selectedJid, uploading]);

  // ── Scroll helpers (first / last message navigation) ─────────────────────
  const scrollToTop = useCallback(() => {
    const el = msgContainerRef.current;
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollToBottom = useCallback(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    isNearBottomRef.current = true;
  }, []);

  // ── In-conversation search matches ────────────────────────────────────────
  const inConvMatches = useMemo<string[]>(() => {
    if (!inConvSearch || !inConvQuery.trim()) return [];
    const q = inConvQuery.trim().toLowerCase();
    const conv = conversations.find((c) => c.remoteJid === selectedJid);
    if (!conv) return [];
    return conv.messages
      .filter((m) => m.kind === "text" && m.content.toLowerCase().includes(q))
      .map((m) => m.id);
  }, [inConvSearch, inConvQuery, conversations, selectedJid]);

  // When matches change, jump to the first result
  useEffect(() => {
    setInConvMatchIdx(0);
  }, [inConvMatches.length, inConvQuery]);

  // Scroll to current match
  useEffect(() => {
    if (!inConvMatches.length) return;
    const id = inConvMatches[inConvMatchIdx];
    if (!id) return;
    const el = msgContainerRef.current?.querySelector(`[data-msg-id="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [inConvMatches, inConvMatchIdx]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      // Número: compara só dígitos (ignora @s.whatsapp.net, +, espaços)
      const digits = (c.remoteJid.split("@")[0] ?? "").replace(/\D/g, "");
      if (digits.includes(q.replace(/\D/g, ""))) return true;
      // Nome cacheado (pushName/name)
      const name = contactNames[c.remoteJid];
      if (name && name.toLowerCase().includes(q)) return true;
      // Conteúdo da última mensagem
      if (c.lastContent.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [conversations, query, contactNames]);

  // ── ESC fecha overlay de foto, emoji picker e busca interna ────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (photoOverlay) { setPhotoOverlay(null); return; }
        if (emojiOpen) { setEmojiOpen(false); return; }
        if (attachment) { setAttachment(null); return; }
        if (inConvSearch) { setInConvSearch(false); setInConvQuery(""); }
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [photoOverlay, emojiOpen, attachment, inConvSearch]);

  // ── Click outside fecha o emoji picker ────────────────────────────────────
  // CRÍTICO: o handler precisa ignorar cliques no próprio toggle button.
  // Sem isso, ao clicar no botão para fechar o picker, o mousedown global é
  // executado ANTES do onClick (mousedown vem antes de click), chama
  // setEmojiOpen(false), e em seguida o onClick chama setEmojiOpen(v => !v)
  // que abre de novo — fica preso no estado aberto e o usuário percebe que
  // o botão "não funciona". Excluir o botão do handler resolve essa race.
  useEffect(() => {
    if (!emojiOpen) return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (emojiPickerRef.current?.contains(target)) return;
      if (emojiButtonRef.current?.contains(target)) return;
      setEmojiOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [emojiOpen]);

  // Focus search input when it opens
  useEffect(() => {
    if (inConvSearch) {
      requestAnimationFrame(() => inConvSearchRef.current?.focus());
    }
  }, [inConvSearch]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: "fixed",
        top: "var(--mc-header-h, 48px)",
        left: "var(--mc-sidebar-w, 240px)",
        right: 0,
        bottom: 0,
        display: "flex",
        background: W.bgApp,
        overflow: "hidden",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        zIndex: 1,
      }}
    >
      {/* ── Overlay fullscreen de foto do contato ── */}
      {photoOverlay && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPhotoOverlay(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.88)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoOverlay}
            alt="Foto do contato"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "min(400px, 90vw)", maxHeight: "min(400px, 90vh)",
              borderRadius: "50%", objectFit: "cover",
              boxShadow: "0 8px 40px rgba(0,0,0,0.8)",
            }}
          />
          <button
            type="button"
            onClick={() => setPhotoOverlay(null)}
            aria-label="Fechar foto"
            style={{
              position: "absolute", top: 16, right: 20,
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(255,255,255,0.8)", fontSize: 32, lineHeight: 1,
            }}
          >×</button>
        </div>
      )}

      {confirmDelete === "conversation" && (
        <ConfirmDeleteModal
          title="Apagar conversa"
          description="Apagar todas as mensagens desta conversa? Os dados do contato no CRM serão mantidos."
          confirmLabel="Apagar conversa"
          busy={deleteBusy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleDeleteConversation}
        />
      )}

      {confirmDelete === "all" && (
        <ConfirmDeleteModal
          title="Limpar todas as conversas"
          description="Isso apagará TODAS as mensagens de TODAS as conversas. Os contatos no CRM não serão afetados."
          confirmLabel="Limpar tudo"
          busy={deleteBusy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleDeleteAllConversations}
        />
      )}

      {/* ─────────────── LEFT SIDEBAR ─────────────── */}
      <SidebarPanel mobileThread={mobileThread}>

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
          <div style={{ position: "relative" }}>
            <button
              type="button"
              aria-label="Opções das conversas"
              title="Opções"
              onClick={() => setSidebarMenuOpen((v) => !v)}
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: "none",
                background: sidebarMenuOpen ? "rgba(255,255,255,0.08)" : "transparent",
                color: W.muted,
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
              }}
            >
              ⋯
            </button>
            {sidebarMenuOpen && (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  top: 38,
                  right: 0,
                  zIndex: 30,
                  minWidth: 214,
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#233138",
                  border: `1px solid ${W.bgBorder}`,
                  boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSidebarMenuOpen(false);
                    setConfirmDelete("all");
                  }}
                  disabled={conversations.length === 0}
                  style={{
                    width: "100%",
                    border: "none",
                    background: "transparent",
                    color: conversations.length ? "#ffb4b4" : W.muted,
                    cursor: conversations.length ? "pointer" : "not-allowed",
                    padding: "11px 13px",
                    textAlign: "left",
                    fontSize: 13,
                    opacity: conversations.length ? 1 : 0.55,
                  }}
                >
                  Limpar todas as conversas
                </button>
              </div>
            )}
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
            filtered.map((c) => {
              // Pré-carrega foto e nome dos itens visíveis na sidebar
              fetchPhoto(c.remoteJid);
              void fetchName(c.remoteJid);
              return (
                <ConversationItem
                  key={c.remoteJid}
                  conv={c}
                  selected={c.remoteJid === selectedJid}
                  onSelect={() => void handleSelect(c.remoteJid)}
                  photoUrl={contactPhotos[c.remoteJid]}
                  name={contactNames[c.remoteJid]}
                  onPhotoClick={contactPhotos[c.remoteJid]
                    ? () => setPhotoOverlay(contactPhotos[c.remoteJid]!)
                    : undefined}
                />
              );
            })
          )}
        </div>
      </SidebarPanel>

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
              {(() => {
                const hasPhoto = Boolean(contactPhotos[active.remoteJid]);
                return (
                  <div
                    onClick={hasPhoto ? () => setPhotoOverlay(contactPhotos[active.remoteJid]!) : undefined}
                    style={{
                      width: 40, height: 40, borderRadius: "50%",
                      background: avatarColor(active.remoteJid),
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "white", fontSize: 14, fontWeight: 600, flexShrink: 0,
                      userSelect: "none", overflow: "hidden",
                      cursor: hasPhoto ? "zoom-in" : "default",
                    }}
                  >
                    {hasPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={contactPhotos[active.remoteJid]!}
                        alt={contactNames[active.remoteJid] ?? jidToPhone(active.remoteJid)}
                        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : jidToInitials(active.remoteJid)}
                  </div>
                );
              })()}

              {/* Contact info */}
              {(() => {
                const phone = jidToPhone(active.remoteJid);
                const name = contactNames[active.remoteJid];
                const waNumber = (active.remoteJid.split("@")[0] ?? "").replace(/\D/g, "");
                const waUrl = `https://wa.me/${waNumber}`;
                return (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir no WhatsApp"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        color: W.text, textDecoration: "none",
                        fontSize: 16, fontWeight: 600,
                        overflow: "hidden", maxWidth: "100%",
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {name ?? phone}
                      </span>
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="#25D366" style={{ flexShrink: 0, opacity: 0.85 }}>
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.122.558 4.116 1.535 5.845L.057 23.57a.75.75 0 0 0 .92.92l5.725-1.478A11.955 11.955 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.93 0-3.732-.51-5.29-1.4l-.38-.22-3.945 1.018 1.018-3.946-.22-.38A9.956 9.956 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                      </svg>
                    </a>
                    {name && (
                      <p style={{ margin: 0, fontSize: 12, color: "#8696a0" }}>{phone}</p>
                    )}
                  </div>
                );
              })()}

              {/* Header action: lupa para busca interna */}
              <button
                type="button"
                aria-label="Buscar na conversa"
                title="Buscar na conversa"
                onClick={() => {
                  setInConvSearch((v) => !v);
                  setInConvQuery("");
                  setInConvMatchIdx(0);
                }}
                style={{
                  background: inConvSearch ? "rgba(255,255,255,0.1)" : "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 6,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: inConvSearch ? W.text : W.muted,
                  flexShrink: 0,
                }}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </button>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <button
                  type="button"
                  aria-label="Opções da conversa"
                  title="Opções da conversa"
                  onClick={() => {
                    setChatMenuOpen((v) => !v);
                    setSidebarMenuOpen(false);
                  }}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    border: "none",
                    background: chatMenuOpen ? "rgba(255,255,255,0.08)" : "transparent",
                    color: W.muted,
                    cursor: "pointer",
                    fontSize: 20,
                    lineHeight: 1,
                  }}
                >
                  ⋯
                </button>
                {chatMenuOpen && (
                  <div
                    role="menu"
                    style={{
                      position: "absolute",
                      top: 38,
                      right: 0,
                      zIndex: 30,
                      minWidth: 188,
                      borderRadius: 8,
                      overflow: "hidden",
                      background: "#233138",
                      border: `1px solid ${W.bgBorder}`,
                      boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setChatMenuOpen(false);
                        setConfirmDelete("conversation");
                      }}
                      style={{
                        width: "100%",
                        border: "none",
                        background: "transparent",
                        color: "#ffb4b4",
                        cursor: "pointer",
                        padding: "11px 13px",
                        textAlign: "left",
                        fontSize: 13,
                      }}
                    >
                      Apagar conversa
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* In-conversation search bar */}
            {inConvSearch && (
              <div
                style={{
                  background: W.bgHeader,
                  borderBottom: `1px solid ${W.bgBorder}`,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexShrink: 0,
                }}
              >
                {/* Search input */}
                <div style={{ position: "relative", flex: 1 }}>
                  <svg
                    viewBox="0 0 24 24" width="14" height="14" fill="none"
                    stroke={W.muted} strokeWidth="2" strokeLinecap="round"
                    style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                  >
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                  <input
                    ref={inConvSearchRef}
                    value={inConvQuery}
                    onChange={(e) => setInConvQuery(e.target.value)}
                    placeholder="Buscar na conversa…"
                    style={{
                      width: "100%", height: 33,
                      background: W.bgInput, border: "none", borderRadius: 6,
                      paddingLeft: 30, paddingRight: 10,
                      fontSize: 13.5, color: W.text, outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Results counter */}
                <span style={{ fontSize: 12, color: W.muted, whiteSpace: "nowrap", minWidth: 70, textAlign: "center" }}>
                  {inConvMatches.length === 0
                    ? (inConvQuery.trim() ? "Sem resultados" : "")
                    : `${inConvMatchIdx + 1} de ${inConvMatches.length}`}
                </span>

                {/* Prev result */}
                <button
                  type="button"
                  aria-label="Resultado anterior"
                  disabled={inConvMatches.length === 0}
                  onClick={() => setInConvMatchIdx((i) => (i - 1 + inConvMatches.length) % inConvMatches.length)}
                  style={{
                    background: "none", border: "none", cursor: inConvMatches.length ? "pointer" : "default",
                    padding: 4, color: inConvMatches.length ? W.text : W.muted, display: "flex",
                    opacity: inConvMatches.length ? 1 : 0.4,
                  }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>

                {/* Next result */}
                <button
                  type="button"
                  aria-label="Próximo resultado"
                  disabled={inConvMatches.length === 0}
                  onClick={() => setInConvMatchIdx((i) => (i + 1) % inConvMatches.length)}
                  style={{
                    background: "none", border: "none", cursor: inConvMatches.length ? "pointer" : "default",
                    padding: 4, color: inConvMatches.length ? W.text : W.muted, display: "flex",
                    opacity: inConvMatches.length ? 1 : 0.4,
                  }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* Close search */}
                <button
                  type="button"
                  aria-label="Fechar busca"
                  onClick={() => { setInConvSearch(false); setInConvQuery(""); setInConvMatchIdx(0); }}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: 4, color: W.muted, display: "flex",
                  }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}

            {/* Messages thread — wrapped in position:relative for floating buttons */}
            <div style={{ flex: 1, position: "relative", minHeight: 0, display: "flex", flexDirection: "column" }}>
              {/* Outer: scroll container (overflow only). Inner: medido pelo
                  ResizeObserver para re-pinning quando mídias inflam o layout. */}
              <div
                ref={msgContainerRef}
                onScroll={handleMsgScroll}
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  ...CHAT_BG_STYLE,
                }}
              >
              <div
                ref={msgInnerRef}
                style={{
                  padding: "12px 5%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  // Garante que o inner ocupe ao menos a altura do outer
                  // (mensagens começam alinhadas em cima quando há poucas).
                  minHeight: "100%",
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
                    const showDateSep = !prev || !sameCalendarDay(prev.created_at, m.created_at);
                    const isCurrentMatch =
                      inConvSearch && inConvMatches.length > 0 && inConvMatches[inConvMatchIdx] === m.id;
                    return (
                      <div
                        key={m.id}
                        data-msg-id={m.id}
                        style={
                          isCurrentMatch
                            ? {
                                borderRadius: 8,
                                outline: "2px solid rgba(240,200,66,0.45)",
                                outlineOffset: 3,
                              }
                            : undefined
                        }
                      >
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
                        <MessageBubble
                          msg={m}
                          highlight={inConvSearch && inConvQuery.trim() ? inConvQuery.trim() : undefined}
                        />
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>
              </div>

              {/* Floating navigation buttons — only when scrollable */}
              {isScrollable && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 14,
                    right: 18,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    zIndex: 10,
                  }}
                >
                  {/* ↑ First message */}
                  <button
                    type="button"
                    aria-label="Ir para a primeira mensagem"
                    title="Primeira mensagem"
                    onClick={scrollToTop}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: "50%",
                      background: "#202c33",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
                      color: W.text,
                      transition: "opacity 0.15s",
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>

                  {/* ↓ Last message */}
                  <button
                    type="button"
                    aria-label="Ir para a última mensagem"
                    title="Última mensagem"
                    onClick={scrollToBottom}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: "50%",
                      background: "#202c33",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
                      color: W.text,
                      transition: "opacity 0.15s",
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>
              )}
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
                position: "relative",
              }}
            >
              {/* ── Emoji Picker (opens above footer) ── */}
              {emojiOpen && (
                <div
                  ref={emojiPickerRef}
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: 0,
                    zIndex: 50,
                    marginBottom: 4,
                  }}
                >
                  <EmojiPicker
                    onEmojiSelect={handleEmojiSelect}
                    theme="dark"
                    locale="pt"
                    previewPosition="none"
                    skinTonePosition="none"
                    set="native"
                  />
                </div>
              )}

              {/* ── File attachment preview ── */}
              {attachment && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: W.bgInput,
                    borderRadius: 10,
                    padding: "8px 12px",
                  }}
                >
                  {/* Preview thumbnail (image only) */}
                  {attachment.kind === "image" && attachment.previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attachment.previewUrl}
                      alt="preview"
                      style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
                    />
                  )}
                  {/* Icon for non-image types */}
                  {attachment.kind !== "image" && (
                    <div style={{
                      width: 40, height: 40, borderRadius: 8, background: W.bgBorder,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      {attachment.kind === "audio" && (
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={W.muted} strokeWidth="1.5">
                          <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                        </svg>
                      )}
                      {attachment.kind === "video" && (
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={W.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
                        </svg>
                      )}
                      {attachment.kind === "document" && (
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={W.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      )}
                    </div>
                  )}
                  {/* Filename */}
                  <span style={{ flex: 1, fontSize: 13, color: W.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {attachment.file.name}
                    <span style={{ color: W.muted, marginLeft: 6, fontSize: 11 }}>
                      ({(attachment.file.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </span>
                  {/* Send media button */}
                  <button
                    type="button"
                    onClick={() => void handleSendMedia()}
                    disabled={uploading}
                    aria-label="Enviar arquivo"
                    style={{
                      width: 36, height: 36, borderRadius: "50%", background: W.green,
                      border: "none", cursor: uploading ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, opacity: uploading ? 0.55 : 1, transition: "opacity 0.2s",
                    }}
                  >
                    {uploading ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="white">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                      </svg>
                    )}
                  </button>
                  {/* Cancel attachment */}
                  <button
                    type="button"
                    onClick={() => setAttachment(null)}
                    disabled={uploading}
                    aria-label="Cancelar arquivo"
                    style={{
                      background: "none", border: "none", cursor: uploading ? "not-allowed" : "pointer",
                      padding: 4, color: W.muted, display: "flex", flexShrink: 0,
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}

              {/* ── Send error ── */}
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

              {/* ── Main input row (only when no attachment pending) ── */}
              {!attachment && (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                  {/* Left icons */}
                  <div style={{ display: "flex", gap: 2, paddingBottom: 9 }}>
                    {/* Emoji button */}
                    <button
                      ref={emojiButtonRef}
                      type="button"
                      title="Emoji"
                      aria-label="Abrir painel de emojis"
                      onMouseDown={(e) => {
                        // Impede que o mousedown global do outside-click handler
                        // veja este clique antes do onClick disparar o toggle.
                        e.stopPropagation();
                      }}
                      onClick={() => setEmojiOpen((v) => !v)}
                      style={{
                        background: emojiOpen ? "rgba(255,255,255,0.08)" : "none",
                        border: "none", cursor: "pointer", padding: 5, borderRadius: 6,
                        color: emojiOpen ? W.text : W.muted,
                        display: "flex", alignItems: "center",
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" strokeLinecap="round" />
                        <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="2.5" strokeLinecap="round" />
                        <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                    </button>
                    {/* Attach button */}
                    <button
                      ref={attachButtonRef}
                      type="button"
                      title="Anexar arquivo"
                      aria-label="Anexar arquivo"
                      onClick={() => {
                        // Reset value antes do click para permitir selecionar
                        // o mesmo arquivo duas vezes em sequência (onChange só
                        // dispara se o value mudar).
                        const input = fileInputRef.current;
                        if (!input) return;
                        input.value = "";
                        input.click();
                      }}
                      style={{
                        background: "none", border: "none", cursor: "pointer", padding: 5, borderRadius: 6,
                        display: "flex", alignItems: "center",
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={W.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                    </button>
                    {/*
                     * Hidden file input.
                     *
                     * Importante: NÃO usar `display: none` aqui. Em alguns
                     * navegadores (especialmente WebKit antigo e ambientes
                     * embarcados/headless), input com `display: none` pode
                     * ignorar chamadas programáticas a `.click()`. Usamos
                     * a técnica clássica de "visually hidden but in tree":
                     * position absolute, 1×1 px, opacity 0, pointer-events
                     * desabilitados — o input permanece "renderizado" no
                     * layout tree e responde ao .click() do botão de anexo.
                     */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      aria-hidden
                      tabIndex={-1}
                      accept="image/jpeg,image/png,image/gif,image/webp,audio/mpeg,audio/ogg,audio/mp4,audio/x-m4a,audio/opus,audio/webm,video/mp4,application/pdf"
                      style={{
                        position: "absolute",
                        width: 1,
                        height: 1,
                        opacity: 0,
                        pointerEvents: "none",
                        clip: "rect(0 0 0 0)",
                        overflow: "hidden",
                      }}
                      onChange={handleFileSelect}
                    />
                  </div>

                  {/* Text input */}
                  <textarea
                    ref={draftTextareaRef}
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
              )}
              <p style={{ margin: 0, fontSize: 10, color: W.bgBorder, textAlign: "right" }}>
                {!attachment && draft.length > 0 ? `${draft.length}/4000` : ""}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
