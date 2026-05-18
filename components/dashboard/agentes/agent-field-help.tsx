"use client";

import { HelpCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FieldHelp({ content, className }: { content: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className={cn("relative inline-flex shrink-0 align-middle", className)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Ajuda sobre este campo"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-content-faint transition hover:text-content-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onMouseEnter={() => setOpen(true)}
      >
        <HelpCircle className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </button>
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute left-1/2 top-[calc(100%+6px)] z-[200] w-[min(280px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-line bg-surface-elevated px-3 py-2 text-xs leading-relaxed text-content-secondary shadow-lg"
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

export function FieldLabel({
  label,
  help,
  htmlFor,
  className,
}: {
  label: string;
  help?: string;
  htmlFor?: string;
  className?: string;
}) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <Tag htmlFor={htmlFor} className={cn("mb-1 flex items-center gap-1.5 text-xs text-content-faint", className)}>
      {label}
      {help ? <FieldHelp content={help} /> : null}
    </Tag>
  );
}

export function FieldTitle({
  title,
  help,
  className,
  as: Tag = "p",
}: {
  title: string;
  help?: string;
  className?: string;
  as?: "p" | "h4" | "span";
}) {
  return (
    <Tag className={cn("flex flex-wrap items-center gap-1.5 text-sm font-semibold text-content", className)}>
      {title}
      {help ? <FieldHelp content={help} /> : null}
    </Tag>
  );
}

export function WizardSectionHeading({
  title,
  help,
  className,
}: {
  title: string;
  help?: string;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-content-secondary",
        className,
      )}
    >
      {title}
      {help ? <FieldHelp content={help} /> : null}
    </h3>
  );
}

export function InlineFieldTitle({
  title,
  help,
  className,
  children,
}: {
  title: string;
  help?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="text-sm font-medium text-content">{title}</span>
      {help ? <FieldHelp content={help} /> : null}
      {children}
    </div>
  );
}
