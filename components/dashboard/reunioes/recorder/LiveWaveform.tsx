"use client";

import { useEffect, useRef } from "react";

/**
 * Forma de onda ao vivo.
 *
 * Não é enfeite: é a única confirmação visual de que o microfone está captando
 * som de verdade. Um cronômetro correndo com o microfone mudo parece idêntico a
 * uma gravação boa — e o usuário só descobre no fim.
 */
export function LiveWaveform({ level, active }: { level: number; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<number[]>([]);
  const levelRef = useRef(level);
  const activeRef = useRef(active);

  useEffect(() => {
    levelRef.current = level;
    activeRef.current = active;
  }, [level, active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let raf = 0;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        context.scale(ratio, ratio);
      }

      // ~20 amostras por segundo bastam para a onda parecer viva sem consumir
      // bateria à toa numa gravação de uma hora.
      frame += 1;
      if (frame % 3 === 0) {
        historyRef.current.push(activeRef.current ? levelRef.current : 0);
        if (historyRef.current.length > 96) historyRef.current.shift();
      }

      context.clearRect(0, 0, width, height);
      const bars = historyRef.current;
      const barWidth = 3;
      const gap = 2;
      const totalWidth = bars.length * (barWidth + gap);
      const startX = Math.max(0, width - totalWidth);

      for (let index = 0; index < bars.length; index += 1) {
        const value = bars[index] ?? 0;
        const barHeight = Math.max(2, value * height * 0.9);
        const x = startX + index * (barWidth + gap);
        const y = (height - barHeight) / 2;
        context.fillStyle = activeRef.current ? "#F24400" : "rgba(113,113,122,0.4)";
        context.fillRect(x, y, barWidth, barHeight);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-20 w-full"
      role="img"
      aria-label={active ? "Nível do microfone durante a gravação" : "Gravação pausada"}
    />
  );
}
