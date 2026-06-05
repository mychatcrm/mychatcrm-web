"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Status = {
  enabled: boolean;
  message?: string;
  estimatedReturnAt?: string;
};

export function MaintenancePublicClient({ locale }: { locale: string }) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/maintenance/status", { cache: "no-store" });
        const j = (await res.json()) as Status;
        if (!cancelled) setStatus(j);
      } catch {
        if (!cancelled) setStatus({ enabled: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status && !status.enabled) {
    return (
      <div className="mt-8 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
        <p>O sistema voltou ao normal.</p>
        <Link
          href="/"
          className="mt-2 inline-block font-medium text-primary underline-offset-2 hover:text-primary-hover hover:underline"
        >
          Ir para o site
        </Link>
      </div>
    );
  }

  if (!status) return <p className="mt-6 text-xs text-content-faint">A carregar detalhes…</p>;

  return (
    <div className="mt-8 space-y-3 text-left text-sm text-content-muted">
      {status.message ? (
        <p className="rounded-xl border border-line bg-surface-card/60 px-4 py-3 leading-relaxed text-content">
          {status.message}
        </p>
      ) : null}
      {status.estimatedReturnAt ? (
        <p className="text-xs text-content-faint">
          <span className="font-medium text-content-secondary">Previsão:</span> {status.estimatedReturnAt}
        </p>
      ) : null}
    </div>
  );
}
