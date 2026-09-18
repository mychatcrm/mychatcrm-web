"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";

export type MultiSelectOption = { value: string; label: string; count?: number };

/**
 * Filtro de várias escolhas com busca dentro.
 *
 * O painel antigo usava `<select>` simples: dava para ver uma campanha de cada
 * vez e a lista saía dos leads já carregados. Aqui as opções chegam do servidor
 * com contagem, e comparar três campanhas é uma seleção só.
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  placeholder = "Todos",
  disabled,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { isLight } = usePanelAppearance();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocument = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(() => {
    const query = term.trim().toLowerCase();
    const list = query
      ? options.filter((option) => option.label.toLowerCase().includes(query))
      : options;
    // Escolhidos primeiro: com 200 campanhas, o que está ligado não pode sumir
    // no meio da lista só porque tem menos leads.
    return [...list].sort((a, b) => {
      const aOn = selectedSet.has(a.value) ? 0 : 1;
      const bOn = selectedSet.has(b.value) ? 0 : 1;
      return aOn - bOn;
    });
  }, [options, term, selectedSet]);

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((option) => option.value === selected[0])?.label ?? "1 selecionado")
        : `${selected.length} selecionados`;

  const toggle = (value: string) => {
    onChange(selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-content-muted">
        {label}
      </label>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-2.5 text-left text-xs transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-50",
          selected.length > 0
            ? "border-primary/50 bg-primary/[0.07] text-content"
            : isLight
              ? "border-slate-200 bg-white text-content"
              : "border-line bg-surface-card text-content",
        )}
      >
        <span className="truncate">{summary}</span>
        <span className="flex shrink-0 items-center gap-1">
          {selected.length > 0 ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Limpar ${label}`}
              className="rounded p-0.5 text-content-muted hover:text-content"
              onClick={(event) => {
                event.stopPropagation();
                onChange([]);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                  onChange([]);
                }
              }}
            >
              <X className="h-3 w-3" aria-hidden />
            </span>
          ) : null}
          <ChevronDown className="h-3.5 w-3.5 text-content-muted" aria-hidden />
        </span>
      </button>

      {open ? (
        <div
          className={cn(
            "absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-hidden rounded-lg border shadow-lg",
            isLight ? "border-slate-200 bg-white" : "border-line bg-surface-elevated",
          )}
        >
          <div className={cn("flex items-center gap-2 border-b px-2.5 py-2", isLight ? "border-slate-100" : "border-line/60")}>
            <Search className="h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden />
            <input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Buscar…"
              className="h-6 w-full bg-transparent text-xs text-content outline-none placeholder:text-content-faint"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {visible.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-content-muted">Nada encontrado.</p>
            ) : (
              visible.map((option) => {
                const active = selectedSet.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggle(option.value)}
                    className={cn(
                      "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors",
                      active ? "text-content" : "text-content-secondary",
                      isLight ? "hover:bg-slate-50" : "hover:bg-surface-card/70",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                        active ? "border-primary bg-primary text-white" : "border-line",
                      )}
                    >
                      {active ? <Check className="h-2.5 w-2.5" aria-hidden /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {typeof option.count === "number" ? (
                      <span className="shrink-0 text-[10px] tabular-nums text-content-muted">{option.count}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
