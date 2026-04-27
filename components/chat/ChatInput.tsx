"use client";

import { Send } from "lucide-react";

type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
};

const MAX_LENGTH = 500;

export function ChatInput({ value, onChange, onSend, disabled }: ChatInputProps) {
  return (
    <div className="border-t border-line bg-surface-deep px-4 py-3">
      <div className="rounded-2xl border border-line bg-surface-card p-2 focus-within:border-primary">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_LENGTH))}
          rows={2}
          maxLength={MAX_LENGTH}
          placeholder="Digite sua mensagem..."
          className="max-h-32 min-h-[52px] w-full resize-none bg-transparent px-2 py-1 text-sm text-content outline-none placeholder:text-content-faint"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          aria-label="Digite sua mensagem"
          disabled={disabled}
        />

        <div className="mt-2 flex items-center justify-between gap-3 px-2 pb-1">
          <span className="text-[11px] text-content-faint">{value.length}/500</span>
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || !value.trim()}
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-primary transition hover:bg-primary/10 disabled:opacity-40"
            aria-label="Enviar mensagem"
          >
            <Send className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
