"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Headphones, Image as ImageIcon, Mic, Volume2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Altura da área de mensagens (conversa longa: dá para rolar e ler do início ao fim). */
const CHAT_VIEWPORT_H = 300;

const DEMO_STOCK_PHOTO =
  "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=640&h=480&q=82";

type DemoMsg =
  | { id: string; side: "user"; kind: "text"; body: string }
  | { id: string; side: "bot"; kind: "text"; body: string }
  | { id: string; side: "bot"; kind: "typing" }
  | { id: string; side: "user"; kind: "image"; caption: string }
  | { id: string; side: "user"; kind: "voice"; duration: string }
  | { id: string; side: "bot"; kind: "listening" }
  | { id: string; side: "bot"; kind: "voice_reply"; headline: string; transcript: string };

/** Conversa longa (~20 trocas), do primeiro “oi” ao encerramento — animação para no fim (sem loop). */
const script: DemoMsg[] = [
  { id: "u1", side: "user", kind: "text", body: "oiii, boa tarde" },
  { id: "u2", side: "user", kind: "text", body: "tu consegue olhar foto e ouvir áudio? to na correria hoje" },
  { id: "t1", side: "bot", kind: "typing" },
  { id: "b1", side: "bot", kind: "text", body: "Oi! Boa tarde 🙂 Consigo sim, manda quando der." },
  { id: "u3", side: "user", kind: "text", body: "pedi um armário e veio a cor errada, ja abri chamado mas ninguém responde" },
  { id: "u4", side: "user", kind: "text", body: "pedido #45821, chegou ontem" },
  { id: "t2", side: "bot", kind: "typing" },
  {
    id: "b2",
    side: "bot",
    kind: "text",
    body: "Entendi, obrigada pelos dados. Vou checar o #45821 aqui no sistema agora.",
  },
  { id: "b3", side: "bot", kind: "text", body: "Consta entrega em Curitiba, kit «Linho cinza». Você tinha pedido outra cor mesmo?" },
  { id: "u5", side: "user", kind: "text", body: "era branco gelo, veio cinza escuro" },
  { id: "u6", side: "user", kind: "image", caption: "etiqueta na caixa + cor ao lado da parede" },
  { id: "t3", side: "bot", kind: "typing" },
  { id: "b4", side: "bot", kind: "text", body: "Foto nítida, valeu. Bate com o que você descreveu — erro de separação no CD." },
  { id: "u7", side: "user", kind: "voice", duration: "0:18" },
  { id: "b5", side: "bot", kind: "listening" },
  {
    id: "b6",
    side: "bot",
    kind: "voice_reply",
    headline: "Áudio · 0:14",
    transcript:
      "Tranquilo: você prefere troca do kit inteiro ou só as portas? Se for troca completa, agendo coleta pra amanhã cedo.",
  },
  { id: "u8", side: "user", kind: "text", body: "troca completa pf, nao quero remendo" },
  { id: "t4", side: "bot", kind: "typing" },
  {
    id: "b7",
    side: "bot",
    kind: "text",
    body: "Perfeito. Abri a OS-9921: coleta gratuita entre 8h–12h, você recebe SMS com link do rastreio.",
  },
  {
    id: "b8",
    side: "bot",
    kind: "text",
    body: "O kit branco gelo sai do CD quinta; previsão de nova entrega sexta antes do almoço. Cupom 10% na próxima compra já tá na sua conta.",
  },
  { id: "u9", side: "user", kind: "text", body: "nossa muito obrigada, salvou minha semana" },
  { id: "t5", side: "bot", kind: "typing" },
  {
    id: "b9",
    side: "bot",
    kind: "text",
    body: "Imagina! Qualquer coisa é só chamar por aqui. Boa tarde e obrigada pela paciência 💚",
  },
];

/** Tempo antes de aparecer cada passo (ritmo de conversa humana). */
const delayBeforeStepMs: number[] = [
  800, 1200, 1000, 1500, 1100, 900, 1200, 1600, 1400, 1000, 800, 1100, 1500, 1200, 1400, 1800, 1000, 1200, 1700, 1900,
  900, 1100, 1400,
];

function VoiceWaveBars({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-4 items-end gap-0.5", className)} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          className="block w-0.5 rounded-full bg-current opacity-80"
          initial={{ height: 4 }}
          animate={{ height: [4, 14, 6, 16, 8, 4] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.08, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

function TypingBubble() {
  return (
    <div className="mr-auto inline-flex max-w-[72%] items-center gap-1 rounded-2xl rounded-bl-sm border border-line/70 bg-surface-card/90 px-4 py-3 shadow-sm">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-2 w-2 rounded-full bg-content-muted"
          animate={{ y: [0, -4, 0], opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function MessageBubble({ msg }: { msg: DemoMsg }) {
  const userShell =
    "ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-white shadow-sm";
  const botShell =
    "mr-auto max-w-[92%] rounded-2xl rounded-bl-sm border border-line/80 bg-surface-card px-3 py-2 text-sm text-content-secondary shadow-sm";

  if (msg.side === "user" && msg.kind === "text") {
    return <div className={cn(userShell, "leading-snug")}>{msg.body}</div>;
  }

  if (msg.side === "bot" && msg.kind === "text") {
    return <div className={cn(botShell, "leading-relaxed text-content")}>{msg.body}</div>;
  }

  if (msg.side === "bot" && msg.kind === "typing") {
    return <TypingBubble />;
  }

  if (msg.side === "user" && msg.kind === "image") {
    return (
      <div className={cn(userShell, "space-y-2 p-2")}>
        <div className="overflow-hidden rounded-xl border border-white/20 bg-black/20">
          <div className="relative aspect-[4/3] w-full max-w-[240px] sm:max-w-[260px]">
            <Image
              src={DEMO_STOCK_PHOTO}
              alt={msg.caption}
              fill
              className="object-cover"
              sizes="260px"
              priority={false}
            />
          </div>
        </div>
        <p className="text-[11px] leading-snug text-white/90">{msg.caption}</p>
      </div>
    );
  }

  if (msg.side === "user" && msg.kind === "voice") {
    return (
      <div className={cn(userShell, "flex items-center gap-3 pr-4")}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
          <Mic className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-white/95">Áudio</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/80">
            <VoiceWaveBars className="text-white" />
            <span className="tabular-nums">{msg.duration}</span>
          </div>
        </div>
      </div>
    );
  }

  if (msg.side === "bot" && msg.kind === "listening") {
    return (
      <div className={cn(botShell, "flex items-center gap-2 border-dashed border-line/80 bg-surface-elevated/40 py-2.5")}>
        <Headphones className="h-4 w-4 shrink-0 text-content-muted" strokeWidth={1.75} aria-hidden />
        <span className="text-content">Tô ouvindo aqui…</span>
      </div>
    );
  }

  if (msg.side === "bot" && msg.kind === "voice_reply") {
    return (
      <div className={cn(botShell, "space-y-2")}>
        <div className="flex items-center gap-2 text-[11px] font-medium text-content-muted">
          <Volume2 className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
          {msg.headline}
        </div>
        <p className="text-[13px] leading-relaxed text-content">{msg.transcript}</p>
      </div>
    );
  }

  return null;
}

export function WhatsAppDemo() {
  const [visibleCount, setVisibleCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (visibleCount >= script.length) return;

    const stepDelay = delayBeforeStepMs[visibleCount] ?? 2200;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      setVisibleCount((c) => Math.min(c + 1, script.length));
    }, stepDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [visibleCount]);

  /** «Digitando…» some assim que a resposta do bot seguinte no roteiro já entrou na lista. */
  const visible = useMemo(() => {
    const out: DemoMsg[] = [];
    for (let i = 0; i < visibleCount; i++) {
      const msg = script[i];
      if (msg.side === "bot" && msg.kind === "typing" && i + 1 < visibleCount) {
        continue;
      }
      out.push(msg);
    }
    return out;
  }, [visibleCount]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: visibleCount <= 1 ? "auto" : "smooth" });
  }, [visibleCount]);

  return (
    <div
      className="relative mx-auto flex h-[416px] w-full max-w-md flex-col rounded-[28px] border border-line bg-surface-deep p-4 shadow-2xl shadow-black/50"
      aria-label="Demonstração de conversa natural no WhatsApp com o assistente MyChatCRM"
    >
      <div className="mb-3 shrink-0 flex items-center gap-3 border-b border-line pb-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-primary text-sm font-bold text-white">
          M
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-content">Marina · MyChatCRM</p>
          <p className="text-xs text-success">online</p>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 w-full shrink-0 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]"
        style={{ height: CHAT_VIEWPORT_H }}
      >
        <div className="flex min-h-full flex-col justify-end gap-1.5 px-0.5 py-1">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
                transition={{ type: "spring", stiffness: 520, damping: 34 }}
              >
                <MessageBubble msg={m} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <p className="mt-3 shrink-0 text-center text-[10px] text-content-muted">
        Simulação visual — não envia mensagens reais.
      </p>
    </div>
  );
}
