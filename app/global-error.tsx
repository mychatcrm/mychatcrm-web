"use client";

import { useEffect } from "react";

export default function GlobalError({
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
    <html lang="pt-BR">
      <body style={{ backgroundColor: "#F2F2F2", color: "#09090b", fontFamily: "Inter, system-ui, sans-serif" }}>
        <div style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>Erro crítico ao carregar o app</h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.75, marginBottom: "1.5rem" }}>
            Limpe o cache do Next (<code style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: "0.15rem 0.4rem", borderRadius: 4 }}>npm run clean</code>) e confira se a URL
            bate com a porta do terminal (ex.: <code style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: "0.15rem 0.4rem", borderRadius: 4 }}>localhost:3000</code> vs{" "}
            <code style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: "0.15rem 0.4rem", borderRadius: 4 }}>3001</code>).
          </p>
          {error?.message ? (
            <p
              style={{
                fontSize: "0.75rem",
                opacity: 0.85,
                marginBottom: "1.25rem",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {error.message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: "1px solid #e2e8f0",
              background: "#F24400",
              color: "#ffffff",
              padding: "0.5rem 1.25rem",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
