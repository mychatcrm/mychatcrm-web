"use client";

import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { CircleHelp } from "lucide-react";
import { PanelAppearancePortalBridge } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";

const TOOLTIP_GAP = 10;
const VIEWPORT_PADDING = 16;
const CLOSE_DELAY_MS = 120;

export type PanelHelpContent = {
  title?: string;
  summary: string;
  items?: readonly string[];
  example?: string;
};

export function PanelHelp({
  content,
  className,
  ariaLabel,
}: {
  content: PanelHelpContent;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  const cancelScheduledClose = () => {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const showTooltip = () => {
    cancelScheduledClose();
    setOpen(true);
  };

  const scheduleClose = () => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  useEffect(() => {
    return () => cancelScheduledClose();
  }, []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !tooltipRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setTooltipStyle(null);
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;

      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const availableWidth = Math.max(
        0,
        window.innerWidth - VIEWPORT_PADDING * 2,
      );
      const tooltipWidth = Math.min(tooltipRect.width, availableWidth);
      const triggerCenter = triggerRect.left + triggerRect.width / 2;
      const preferredLeft = triggerCenter - tooltipWidth / 2;
      const left = Math.min(
        Math.max(preferredLeft, VIEWPORT_PADDING),
        window.innerWidth - tooltipWidth - VIEWPORT_PADDING,
      );
      const belowTop = triggerRect.bottom + TOOLTIP_GAP;
      const aboveTop = triggerRect.top - tooltipRect.height - TOOLTIP_GAP;
      const openAbove =
        belowTop + tooltipRect.height + VIEWPORT_PADDING > window.innerHeight &&
        aboveTop >= VIEWPORT_PADDING;

      setTooltipStyle({
        left,
        top: openAbove
          ? aboveTop
          : Math.min(
              belowTop,
              window.innerHeight - tooltipRect.height - VIEWPORT_PADDING,
            ),
        width: tooltipWidth,
      });
    };

    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [content, open]);

  return (
    <span
      className={cn("inline-flex shrink-0 align-middle", className)}
      onMouseEnter={showTooltip}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel ?? `Ajuda sobre ${content.title ?? "esta opção"}`}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        className={cn(
          "inline-flex h-[18px] w-[18px] items-center justify-center rounded-full",
          "text-content-faint transition duration-150 ease-out",
          "hover:bg-primary/10 hover:text-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onFocus={showTooltip}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (!tooltipRef.current?.contains(nextTarget)) scheduleClose();
        }}
      >
        <CircleHelp className="h-4 w-4" strokeWidth={1.9} aria-hidden />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <PanelAppearancePortalBridge>
              <div
                ref={tooltipRef}
                id={tooltipId}
                role="tooltip"
                className={cn(
                  "fixed z-[300] w-[min(21rem,calc(100vw-2rem))] overflow-hidden",
                  "rounded-xl border border-line/70 bg-surface-card px-4 py-3.5",
                  "text-left opacity-0 transition duration-150 ease-out motion-reduce:transition-none",
                  tooltipStyle && "opacity-100",
                )}
                style={tooltipStyle ?? { left: -9999, top: -9999 }}
                onMouseEnter={showTooltip}
                onMouseLeave={scheduleClose}
              >
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-0.5 bg-primary"
                />
                {content.title ? (
                  <strong className="block text-xs font-semibold text-content">
                    {content.title}
                  </strong>
                ) : null}
                <p
                  className={cn(
                    "text-[12px] leading-relaxed text-content-secondary",
                    content.title && "mt-1.5",
                  )}
                >
                  {content.summary}
                </p>
                {content.items?.length ? (
                  <ul className="mt-2.5 space-y-1.5 border-t border-line/55 pt-2.5">
                    {content.items.map((item) => (
                      <li
                        key={item}
                        className="flex gap-2 text-[11.5px] leading-relaxed text-content-muted"
                      >
                        <span
                          aria-hidden
                          className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-primary"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {content.example ? (
                  <p className="mt-2.5 rounded-lg bg-surface-deep/45 px-3 py-2 text-[11px] leading-relaxed text-content-muted">
                    <span className="font-semibold text-primary">Exemplo: </span>
                    {content.example}
                  </p>
                ) : null}
              </div>
            </PanelAppearancePortalBridge>,
            document.body,
          )
        : null}
    </span>
  );
}
