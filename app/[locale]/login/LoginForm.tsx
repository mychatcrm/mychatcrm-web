"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { safeAppInternalPath } from "@/lib/safe-redirect";

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

export default function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const passwordId = useId();

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "").trim();
    if (!email || !password) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/client/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; redirectedTo?: string; status?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Não foi possível entrar agora.");
        return;
      }

      if (payload?.status === "cancelada") {
        router.replace("/planos?erro=plano-cancelado");
        return;
      }

      const fallback = safeAppInternalPath(
        typeof payload?.redirectedTo === "string" ? payload.redirectedTo : null,
        "/dashboard",
      );
      const dest = safeAppInternalPath(search?.get("from"), fallback);
      router.replace(dest);
    } catch {
      setError("Falha ao autenticar. Tente novamente em instantes.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitLayout
      variant="client"
      eyebrow="Painel do cliente"
      title="Bem-vindo de volta"
      subtitle={
        process.env.NEXT_PUBLIC_SHOW_DEMO_LOGIN_HELP === "1"
          ? "Demonstração: conta Master abaixo; ou qualquer e-mail com a senha demo (plano Profissional), exceto e-mails já em Colaboradores. Diretor/gerente/vendedor: use a senha definida na equipa ou as contas demo listadas ao fundo."
          : "Entre com o e-mail e a palavra-passe da sua organização. Em caso de dúvida, contacte o administrador."
      }
      headerAction={{ href: "/", label: "Ver site" }}
    >
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
              autoComplete="email"
              defaultValue=""
              placeholder="voce@empresa.com.br"
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
              placeholder="••••••••"
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

        <div className="flex items-center gap-2 pt-0.5">
          <input
            id="remember-client"
            name="remember"
            type="checkbox"
            className="h-4 w-4 shrink-0 rounded border-line bg-surface-deep accent-primary focus:ring-2 focus:ring-primary/30"
          />
          <label htmlFor="remember-client" className="text-sm text-content-muted">
            Lembrar-me neste dispositivo
          </label>
        </div>

        {error ? (
          <p
            className="rounded-lg border border-line bg-surface-deep/90 px-3 py-2.5 text-sm leading-snug text-content-secondary"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" variant="gradient" className="w-full" isLoading={loading}>
          Entrar
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-content-muted">
        Quer conhecer antes?{" "}
        <Link href="/planos" className="font-medium text-primary transition hover:text-primary-hover">
          Ver planos e preços
        </Link>
      </p>

      <p className="mt-6 text-center text-xs leading-relaxed text-content-faint">
        Ao continuar, você concorda com os{" "}
        <Link href="/termos" className="underline-offset-2 hover:text-primary hover:underline">
          Termos
        </Link>{" "}
        e a{" "}
        <Link href="/privacidade" className="underline-offset-2 hover:text-primary hover:underline">
          Política de Privacidade
        </Link>{" "}
        do MyChatCRM.
      </p>
    </AuthSplitLayout>
  );
}
