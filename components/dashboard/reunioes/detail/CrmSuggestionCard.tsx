"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { PanelButton } from "@/components/panel/ui/PanelButton";
import { Badge } from "@/components/ui/Badge";

type Suggestion = {
  field: string;
  label: string;
  currentValue: string | null;
  suggestedValue: string;
  kind: "fill" | "replace";
  defaultChecked: boolean;
};

/**
 * Diff do que a IA identificou sobre o lead.
 *
 * Nada é aplicado sem clique. Sugestão que SUBSTITUI um valor existente vem
 * desmarcada: sobrescrever o que alguém digitou é mais grave que deixar de
 * preencher um campo vazio.
 */
export function CrmSuggestionCard({ meetingId }: { meetingId: string }) {
  const [leadName, setLeadName] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/client/reunioes/${encodeURIComponent(meetingId)}/crm-sugestoes`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!body?.suggestions?.length) return;
        const list = body.suggestions as Suggestion[];
        setLeadName(body.leadName ?? null);
        setSuggestions(list);
        setChecked(
          new Set(list.filter((item) => item.defaultChecked).map((item) => item.field)),
        );
      })
      .catch(() => undefined);
  }, [meetingId]);

  const apply = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/client/reunioes/${encodeURIComponent(meetingId)}/crm-sugestoes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: Array.from(checked) }),
        },
      );
      if (!response.ok) {
        setError("Não foi possível atualizar o lead.");
        return;
      }
      setApplied(true);
    } catch {
      setError("Não foi possível atualizar o lead.");
    } finally {
      setBusy(false);
    }
  }, [checked, meetingId]);

  if (dismissed || suggestions.length === 0) return null;

  if (applied) {
    return (
      <div className="rounded-panel-2xl border border-success/30 bg-success/[0.06] px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-content">
          <Check className="h-4 w-4 text-success" aria-hidden />
          Lead atualizado.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-panel-2xl border border-primary/30 bg-primary/[0.05] p-4">
      <h3 className="text-sm font-semibold text-content">
        A IA identificou informações novas{leadName ? ` sobre ${leadName}` : ""}
      </h3>
      <p className="mt-0.5 text-xs text-content-muted">
        Confira antes de aplicar. Nada é salvo sem o seu clique.
      </p>

      <ul className="mt-3 space-y-1.5">
        {suggestions.map((suggestion) => (
          <li key={suggestion.field}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-panel-lg px-2 py-1.5 hover:bg-surface-elevated/40">
              <input
                type="checkbox"
                className="mt-1"
                checked={checked.has(suggestion.field)}
                onChange={(event) =>
                  setChecked((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(suggestion.field);
                    else next.delete(suggestion.field);
                    return next;
                  })
                }
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-content">{suggestion.label}</span>
                  {suggestion.kind === "replace" ? (
                    <Badge variant="warning">substitui valor atual</Badge>
                  ) : null}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-content-faint line-through">
                    {suggestion.currentValue ?? "—"}
                  </span>
                  <ArrowRight className="h-3 w-3 text-content-faint" aria-hidden />
                  <span className="text-content-secondary">{suggestion.suggestedValue}</span>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {error ? <p className="mt-2 text-xs text-error">{error}</p> : null}

      <div className="mt-3 flex justify-end gap-2">
        <PanelButton variant="ghost" size="sm" onClick={() => setDismissed(true)} disabled={busy}>
          Ignorar
        </PanelButton>
        <PanelButton size="sm" onClick={apply} disabled={busy || checked.size === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Atualizar lead
        </PanelButton>
      </div>
    </div>
  );
}
