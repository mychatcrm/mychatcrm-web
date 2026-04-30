"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ADMIN_DEMO_EMAIL_PLACEHOLDER } from "@/lib/admin-credentials";
import { safeAdminPostLoginPath, safeAppInternalPath } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";

function EyeIcon({ off }: { off?: boolean }) {
  if (off) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="text-content-muted">
        <path
          d="M3 3l18 18M10.5 10.5a3 3 0 004 4M9.9 5.1A10.4 10.4 0 0112 5c4 0 7.5 2.5 10 7-1 1.8-2.2 3.3-3.5 4.5M6.3 6.3C4.5 7.9 3 10 2 12c2.5 4.5 6 7 10 7 1.2 0 2.4-.2 3.5-.6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="text-content-muted">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function AdminLoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "")
      .trim()
      .toLowerCase();
    const pass = String(fd.get("password") || "");
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pass }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; redirectedTo?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "E-mail ou senha incorretos.");
        return;
      }

      const fallback = safeAppInternalPath(
        typeof payload?.redirectedTo === "string" ? payload.redirectedTo : null,
        "/admin",
      );
      const dest = safeAdminPostLoginPath(search?.get("from"), fallback);
      router.replace(dest);
    } catch {
      setError("Falha ao autenticar no painel administrativo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitLayout
      variant="admin"
      eyebrow="Área restrita"
      title="Acesso administrativo"
      subtitle="Somente contas autorizadas da equipe MyChatCRM. Nesta demonstração, as credenciais abaixo entram como Super Admin."
      headerAction={{ href: "/", label: "Site institucional" }}
    >
      {process.env.NEXT_PUBLIC_VERCEL_BUILT === "1" ? (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-xs leading-relaxed text-content-secondary">
          <span className="font-medium text-amber-200">Hospedagem Vercel:</span> o admin usa senha demo controlada por
          env. Defina{" "}
          <code className="rounded bg-surface-deep px-1 py-0.5 text-content">ALLOW_DEMO_PASSWORD_AUTH=1</code> e{" "}
          <code className="rounded bg-surface-deep px-1 py-0.5 text-content">DEMO_ADMIN_PASSWORD</code> (Production) e
          faça redeploy.
        </p>
      ) : null}
      <form className="space-y-5" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor={emailId} className="text-sm font-medium text-content-secondary">
            E-mail
          </label>
          <div className="relative mt-1.5">
            <Input
              id={emailId}
              name="email"
              type="email"
              required
              autoComplete="username"
              defaultValue={ADMIN_DEMO_EMAIL_PLACEHOLDER}
              placeholder="admin@empresa.com.br"
              className="pr-11"
            />
            <span
              className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-content-faint"
              aria-hidden
            >
              @
            </span>
          </div>
        </div>

        <div>
          <label htmlFor={passwordId} className="text-sm font-medium text-content-secondary">
            Senha
          </label>
          <div className="relative mt-1.5">
            <Input
              id={passwordId}
              name="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className={cn(
                "absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg",
                "text-content-muted outline-none transition hover:text-content-secondary",
                "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-deep",
              )}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-error" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" variant="gradient" className="w-full" isLoading={loading}>
          Entrar no painel
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-content-faint">
        Problema para acessar? Entre em contato com o responsável técnico da sua organização.
      </p>
    </AuthSplitLayout>
  );
}
