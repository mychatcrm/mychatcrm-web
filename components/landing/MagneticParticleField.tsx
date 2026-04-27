"use client";

/**
 * Campo de partículas magnéticas (canvas): partículas próximas ao cursor são atraídas,
 * ligações finas entre vizinhos e até ao cursor. Mobile / prefers-reduced-motion: camada CSS.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const PRIMARY = "242, 68, 0";
const PRIMARY_HOVER = "255, 106, 0";

type Particle = {
  bx: number;
  by: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export function MagneticParticleField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999, active: false });
  const rafRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const [useCanvas, setUseCanvas] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.innerWidth < 768;
    setUseCanvas(!reduce && !coarse && !narrow);
  }, []);

  useEffect(() => {
    if (!useCanvas) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const root = container;
    const cv = canvas;
    const c2 = ctx;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;

    function initParticles() {
      const count = Math.min(110, Math.floor((w * h) / 9000) + 40);
      const list: Particle[] = [];
      for (let i = 0; i < count; i++) {
        const bx = Math.random() * w;
        const by = Math.random() * h;
        list.push({ bx, by, x: bx, y: by, vx: 0, vy: 0 });
      }
      particlesRef.current = list;
    }

    function resize() {
      const rect = root.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
      initParticles();
    }

    const ro = new ResizeObserver(() => resize());
    ro.observe(root);
    resize();

    /** Janela inteira: o cursor pode estar sobre os cards (z-index acima) e ainda influenciar o campo. */
    const onWinMove = (e: MouseEvent) => {
      const rect = root.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) {
        mouseRef.current.active = false;
        return;
      }
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      };
    };

    window.addEventListener("mousemove", onWinMove);

    const attractR = 150;
    const repelR = 320;
    const lineMax = 80;
    const lineCursorMax = 120;

    const tick = () => {
      const { x: mx, y: my, active } = mouseRef.current;
      const parts = particlesRef.current;
      c2.clearRect(0, 0, w, h);

      for (const p of parts) {
        let ax = 0;
        let ay = 0;
        const dx = p.x - p.bx;
        const dy = p.y - p.by;
        ax -= dx * 0.04;
        ay -= dy * 0.04;

        if (active) {
          const cx = mx - p.x;
          const cy = my - p.y;
          const d = Math.hypot(cx, cy) || 0.0001;
          if (d < attractR) {
            const f = (1 - d / attractR) * 0.35;
            ax += (cx / d) * f * 8;
            ay += (cy / d) * f * 8;
          } else if (d < repelR) {
            const f = (1 - (d - attractR) / (repelR - attractR)) * 0.06;
            ax -= (cx / d) * f * 4;
            ay -= (cy / d) * f * 4;
          }
        }

        p.vx = (p.vx + ax) * 0.88;
        p.vy = (p.vy + ay) * 0.88;
        p.x += p.vx;
        p.y += p.vy;
      }

      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i];
          const b = parts[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < lineMax && d > 0) {
            const alpha = (1 - d / lineMax) * 0.22;
            c2.strokeStyle = `rgba(${PRIMARY},${alpha})`;
            c2.lineWidth = 1;
            c2.beginPath();
            c2.moveTo(a.x, a.y);
            c2.lineTo(b.x, b.y);
            c2.stroke();
          }
        }
      }

      if (active) {
        for (const p of parts) {
          const d = Math.hypot(mx - p.x, my - p.y);
          if (d < lineCursorMax && d > 0) {
            const alpha = (1 - d / lineCursorMax) * 0.35;
            c2.strokeStyle = `rgba(${PRIMARY_HOVER},${alpha})`;
            c2.beginPath();
            c2.moveTo(p.x, p.y);
            c2.lineTo(mx, my);
            c2.stroke();
          }
        }
      }

      for (const p of parts) {
        c2.fillStyle = `rgba(${PRIMARY},0.58)`;
        c2.beginPath();
        c2.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        c2.fill();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("mousemove", onWinMove);
    };
  }, [useCanvas]);

  return (
    <div
      ref={containerRef}
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-500 motion-reduce:opacity-0",
          useCanvas ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-500 motion-reduce:opacity-100",
          useCanvas ? "opacity-0" : "opacity-100",
        )}
      >
        <div className="animate-landing-float-slow absolute -left-1/4 top-0 h-[120%] w-1/2 rounded-full bg-primary/[0.08] blur-3xl motion-reduce:animate-none" />
        <div className="animate-landing-float-slower absolute -right-1/4 bottom-0 h-[100%] w-1/2 rounded-full bg-primary-hover/[0.07] blur-3xl motion-reduce:animate-none" />
      </div>
    </div>
  );
}
