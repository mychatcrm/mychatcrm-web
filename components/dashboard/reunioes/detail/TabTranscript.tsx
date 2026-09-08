"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { PanelInput } from "@/components/panel/ui/PanelInput";
import { cn } from "@/lib/utils";
import { formatClock, speakerColor, speakerDisplayName } from "../meeting-format";
import type { MeetingSpeaker, MeetingTranscriptSegment } from "@/lib/server/meeting-detail";

/**
 * Transcrição sincronizada com o áudio.
 *
 * Dois sentidos: o trecho em reprodução se destaca sozinho, e clicar em
 * qualquer linha leva o áudio até ali. É o gesto que transforma uma parede de
 * texto em algo navegável.
 */
export function TabTranscript({
  segments,
  speakers,
  currentMs,
  onSeek,
}: {
  segments: MeetingTranscriptSegment[];
  speakers: MeetingSpeaker[];
  currentMs: number;
  onSeek: (ms: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const activeRef = useRef<HTMLButtonElement>(null);

  const activeIdx = useMemo(() => {
    // Último segmento que já começou. Busca linear serve: mesmo 3 h de reunião
    // dão poucos milhares de itens, e isso roda no timeupdate do áudio (~4/s).
    let found = -1;
    for (const segment of segments) {
      if (segment.startMs <= currentMs) found = segment.idx;
      else break;
    }
    return found;
  }, [currentMs, segments]);

  useEffect(() => {
    if (!autoScroll) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIdx, autoScroll]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return segments;
    return segments.filter((segment) => segment.text.toLowerCase().includes(term));
  }, [query, segments]);

  if (segments.length === 0) {
    return (
      <p className="rounded-panel-2xl border border-line/45 bg-surface-card/60 px-4 py-6 text-center text-sm text-content-muted">
        A transcrição ainda não está pronta.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint"
            aria-hidden
          />
          <PanelInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar na transcrição…"
            aria-label="Buscar na transcrição"
            className="pl-9"
          />
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-content-muted">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => setAutoScroll(event.target.checked)}
          />
          Acompanhar
        </label>
      </div>

      {query.trim() && filtered.length === 0 ? (
        <p className="px-1 text-xs text-content-muted">Nenhum trecho encontrado.</p>
      ) : null}

      <div className="space-y-2">
        {filtered.map((segment) => {
          const active = segment.idx === activeIdx && !query.trim();
          const name = speakerDisplayName(segment.speakerLabel, speakers);
          const color = speakerColor(segment.speakerLabel);

          return (
            <button
              key={segment.idx}
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => onSeek(segment.startMs)}
              className={cn(
                "flex w-full gap-3 rounded-panel-xl border border-transparent px-3 py-2 text-left transition-colors",
                "hover:bg-surface-elevated/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                active && "border-l-2 border-l-primary bg-primary/[0.07]",
              )}
              aria-current={active ? "true" : undefined}
            >
              <span className="w-14 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-content-faint">
                {formatClock(segment.startMs)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mb-0.5 block text-[11px] font-semibold" style={{ color }}>
                  {name}
                </span>
                <span className="block text-sm leading-relaxed text-content-secondary">
                  {segment.text}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
