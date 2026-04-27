"use client";

export function ChatTypingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
        IA
      </div>
      <div className="inline-flex items-center gap-1 rounded-2xl border border-line bg-surface-card px-3 py-2">
        <span className="h-2 w-2 animate-bounce rounded-full bg-content-muted [animation-delay:-0.2s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-content-muted [animation-delay:-0.1s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-content-muted" />
      </div>
    </div>
  );
}
