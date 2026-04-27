"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-xl font-semibold text-content">Algo saiu do esperado</h1>
      <p className="text-sm text-content-muted">
        Se o problema persistir, pare o servidor, rode <code className="rounded bg-white/10 px-1.5 py-0.5">npm run clean</code> e inicie de novo com{" "}
        <code className="rounded bg-white/10 px-1.5 py-0.5">npm run dev</code>.
      </p>
      {error?.message ? (
        <p className="w-full max-w-md rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-left text-xs leading-relaxed text-rose-100">
          <span className="font-semibold text-rose-200">Detalhe: </span>
          <span className="break-words font-mono text-[11px] text-rose-50/95">{error.message}</span>
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm font-medium text-content hover:bg-white/10"
      >
        Tentar novamente
      </button>
    </div>
  );
}
