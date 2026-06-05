"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const TOOLTIP_GAP = 8;
const TOOLTIP_VIEWPORT_PADDING = 16;

function splitFieldHelpContent(content: string) {
  const [description, ...exampleParts] = content.split(/\s+Ex\.:\s*/);
  const example = exampleParts.join(" Ex.: ").trim();
  return {
    description: description.trim(),
    example: example.length > 0 ? example : null,
  };
}

export function FieldHelp({ content, className }: { content: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const { description, example } = splitFieldHelpContent(content);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const updateTooltipPosition = () => {
      const trigger = wrapRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;

      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const triggerCenter = triggerRect.left + triggerRect.width / 2;
      const belowTop = triggerRect.bottom + TOOLTIP_GAP;
      const aboveTop = triggerRect.top - tooltipRect.height - TOOLTIP_GAP;
      const shouldOpenAbove = belowTop + tooltipRect.height + TOOLTIP_VIEWPORT_PADDING > viewportHeight && aboveTop >= TOOLTIP_VIEWPORT_PADDING;
      const nextTop = shouldOpenAbove ? aboveTop : Math.min(belowTop, viewportHeight - tooltipRect.height - TOOLTIP_VIEWPORT_PADDING);
      const unclampedLeft = triggerCenter - tooltipRect.width / 2;
      const nextLeft = Math.min(
        Math.max(unclampedLeft, TOOLTIP_VIEWPORT_PADDING),
        viewportWidth - tooltipRect.width - TOOLTIP_VIEWPORT_PADDING,
      );

      setPlacement(shouldOpenAbove ? "top" : "bottom");
      setTooltipStyle({
        left: nextLeft,
        top: Math.max(nextTop, TOOLTIP_VIEWPORT_PADDING),
        "--field-help-arrow-left": `${triggerCenter - nextLeft}px`,
      } as CSSProperties);
    };

    const frame = window.requestAnimationFrame(updateTooltipPosition);
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [open, content]);

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
        className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-primary text-[9px] font-bold leading-none text-white transition-colors duration-150 hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onMouseEnter={() => setOpen(true)}
      >
        ?
      </button>
      {open ? (
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          data-placement={placement}
          className="field-help-tooltip fixed z-[200] max-w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line/80 bg-surface-card px-4 py-3.5 opacity-0"
          style={tooltipStyle ?? { left: -9999, top: -9999 }}
        >
          {/* accent bar */}
          <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-primary" />
          <span className="block text-[12.5px] leading-relaxed text-content">{description}</span>
          {example ? (
            <span className="mt-2.5 block border-t border-line/70 pt-2">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-primary/80">Exemplo</span>
              <span className="mt-0.5 block text-[11.5px] leading-[1.5] text-content-muted">{example}</span>
            </span>
          ) : null}
        </span>
      ) : null}
      <style jsx>{`
        .field-help-tooltip {
          animation: field-help-fade-slide 160ms ease-out forwards;
        }

        .field-help-tooltip::before,
        .field-help-tooltip::after {
          content: "";
          position: absolute;
          left: var(--field-help-arrow-left, 50%);
          transform: translateX(-50%);
          width: 0;
          height: 0;
        }

        .field-help-tooltip[data-placement="bottom"]::before {
          top: -7px;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-bottom: 6px solid rgba(255, 255, 255, 0.08);
        }

        .field-help-tooltip[data-placement="bottom"]::after {
          top: -5px;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-bottom: 5px solid #1c1c1c;
        }

        .field-help-tooltip[data-placement="top"]::before {
          bottom: -7px;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 6px solid rgba(255, 255, 255, 0.08);
        }

        .field-help-tooltip[data-placement="top"]::after {
          bottom: -5px;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-top: 5px solid #1c1c1c;
        }

        @keyframes field-help-fade-slide {
          from {
            opacity: 0;
            transform: translateY(5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
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
