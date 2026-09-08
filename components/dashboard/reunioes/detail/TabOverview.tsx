"use client";

import { ArrowRight, Lightbulb, ListChecks, MapPin, Target } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatClock } from "../meeting-format";
import { CrmSuggestionCard } from "./CrmSuggestionCard";
import type { MeetingDetail } from "@/lib/server/meeting-detail";

type AnchoredItem = { text: string; atMs: number };

function anchoredList(payload: Record<string, unknown>, key: string): AnchoredItem[] {
  const list = payload[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const text = String(item.text ?? "").trim();
    if (!text) return [];
    return [{ text, atMs: Number(item.atMs ?? 0) }];
  });
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-panel-2xl border border-line/45 bg-surface-card/60 p-4">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Item clicável que leva o áudio ao momento citado — a prova de cada afirmação. */
function AnchorButton({ item, onSeek }: { item: AnchoredItem; onSeek: (ms: number) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSeek(item.atMs)}
        className="flex w-full items-start gap-2 rounded-panel-lg px-1.5 py-1 text-left hover:bg-surface-elevated/40"
      >
        <span className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-primary">
          {formatClock(item.atMs)}
        </span>
        <span className="text-sm leading-relaxed text-content-secondary">{item.text}</span>
      </button>
    </li>
  );
}

export function TabOverview({
  detail,
  onSeek,
}: {
  detail: MeetingDetail;
  onSeek: (ms: number) => void;
}) {
  const payload = detail.analysis?.payload ?? {};
  const highlights = anchoredList(payload, "highlights");
  const nextSteps = anchoredList(payload, "nextSteps");
  const openQuestions = anchoredList(payload, "openQuestions");

  if (!detail.analysis) {
    return (
      <div className="rounded-panel-2xl border border-line/45 bg-surface-card/60 px-4 py-6 text-center">
        <p className="text-sm text-content-secondary">
          {detail.meeting.status === "partial"
            ? "A transcrição está pronta, mas o resumo não pôde ser gerado."
            : "O resumo ainda está sendo gerado."}
        </p>
        {detail.meeting.status === "partial" ? (
          <p className="mt-1 text-xs text-content-muted">
            Você pode ouvir o áudio e ler a transcrição normalmente.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Section icon={<Lightbulb className="h-3.5 w-3.5" aria-hidden />} title="Resumo">
        <p className="text-sm font-medium leading-relaxed text-content">
          {detail.analysis.summaryShort}
        </p>
        {detail.analysis.summaryLong ? (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-content-secondary">
            {detail.analysis.summaryLong}
          </p>
        ) : null}
      </Section>

      {detail.meeting.leadId ? <CrmSuggestionCard meetingId={detail.meeting.id} /> : null}

      {detail.chapters.length > 0 ? (
        <Section icon={<MapPin className="h-3.5 w-3.5" aria-hidden />} title="Linha do tempo">
          <ul className="space-y-0.5">
            {detail.chapters.map((chapter) => (
              <li key={`${chapter.startMs}-${chapter.title}`}>
                <button
                  type="button"
                  onClick={() => onSeek(chapter.startMs)}
                  className="flex w-full items-baseline gap-2 rounded-panel-lg px-1.5 py-1 text-left hover:bg-surface-elevated/40"
                >
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-primary">
                    {formatClock(chapter.startMs)}
                  </span>
                  <span className="text-sm text-content-secondary">{chapter.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {highlights.length > 0 ? (
          <Section icon={<Target className="h-3.5 w-3.5" aria-hidden />} title="Pontos importantes">
            <ul className="space-y-0.5">
              {highlights.map((item, index) => (
                <AnchorButton key={`${item.atMs}-${index}`} item={item} onSeek={onSeek} />
              ))}
            </ul>
          </Section>
        ) : null}

        {nextSteps.length > 0 ? (
          <Section icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden />} title="Próximos passos">
            <ul className="space-y-0.5">
              {nextSteps.map((item, index) => (
                <AnchorButton key={`${item.atMs}-${index}`} item={item} onSeek={onSeek} />
              ))}
            </ul>
          </Section>
        ) : null}
      </div>

      {openQuestions.length > 0 ? (
        <Section icon={<ListChecks className="h-3.5 w-3.5" aria-hidden />} title="Ficou em aberto">
          <ul className="space-y-0.5">
            {openQuestions.map((item, index) => (
              <AnchorButton key={`${item.atMs}-${index}`} item={item} onSeek={onSeek} />
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.speakers.length > 0 ? (
        <Section icon={<Target className="h-3.5 w-3.5" aria-hidden />} title="Participação">
          <div className="flex flex-wrap gap-2">
            {detail.speakers.map((speaker) => (
              <Badge key={speaker.label}>
                {speaker.displayName?.trim() || `Falante ${speaker.label}`}
                {speaker.talkTimeMs > 0 ? ` · ${Math.round(speaker.talkTimeMs / 60_000)} min` : ""}
              </Badge>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
