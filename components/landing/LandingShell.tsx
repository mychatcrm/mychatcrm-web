"use client";

/**
 * Cursor circular (desktop, ponteiro fino): posição = transform direto no mousemove,
 * sem lerp, sem rAF para movimento, sem transition em transform. Hover = só w/h/opacity no anel.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const CURSOR_HOVER_ROOT = "a, button, [role='button'], input, textarea, select, [data-cursor-expand]";

export function LandingShell({ children, className }: { children: React.ReactNode; className?: string }) {
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (!reduce && !coarse) setEnabled(true);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const ring = ringRef.current;
    const dot = dotRef.current;
    if (!ring || !dot) return;

    let lastHover = false;

    const move = (e: MouseEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      const tf = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      ring.style.transform = tf;
      dot.style.transform = tf;

      const under = document.elementFromPoint(x, y);
      const isHover = !!(under && under instanceof Element && under.closest(CURSOR_HOVER_ROOT));
      if (isHover !== lastHover) {
        lastHover = isHover;
        ring.classList.toggle("landing-cursor-ring--hover", isHover);
      }
    };

    window.addEventListener("mousemove", move, { passive: true });
    return () => window.removeEventListener("mousemove", move);
  }, [enabled]);

  return (
    <div className={cn("relative", className, enabled && "landing-hide-cursor")}>
      {enabled ? (
        <>
          <div
            ref={ringRef}
            className="landing-cursor-ring pointer-events-none fixed left-0 top-0 z-[99999] mix-blend-screen rounded-full border border-primary/40 will-change-transform"
            aria-hidden
          />
          <div
            ref={dotRef}
            className="pointer-events-none fixed left-0 top-0 z-[100000] h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_rgba(242,68,0,0.8)] will-change-transform"
            aria-hidden
          />
        </>
      ) : null}
      {children}
    </div>
  );
}
