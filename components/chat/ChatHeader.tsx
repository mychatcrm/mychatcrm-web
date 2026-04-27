"use client";

import { Bot, X } from "lucide-react";

type ChatHeaderProps = {
  assistantName: string;
  onClose: () => void;
};

export function ChatHeader({ assistantName, onClose }: ChatHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3 bg-gradient-primary px-4 py-3 text-white">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/15">
          <Bot className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{assistantName}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/90">
            <span className="inline-flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-emerald-300" />
            <span className="min-w-0">IA • Responde em segundos</span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-black/10 transition hover:bg-black/20"
        aria-label="Minimizar chat"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
    </header>
  );
}
