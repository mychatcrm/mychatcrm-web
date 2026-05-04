"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
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

export default function ResetPasswordForm() {
  const router = useRouter();
  const search = useSearchParams();
  const token = useMemo(() => search.get("token")?.trim() ?? "", [search]);

  const pwId = useId();
  const pw2Id = useId();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const weak = password.length > 0 && password.length < 8;
  const mismatch = password2.length > 0 && password !== password2;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("Link inválido. Solicite uma nova recuperação de palavra-passe.");
      return;
    }
    if (password.length < 8) {
      setError("A palavra-passe deve ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== password2) {
      setError("As palavras-passe não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        setError(data?.message ?? "Não foi possível atualizar a palavra-passe.");
        return;
      }
      setDone(true);
      setTimeout(() => router.replace("/login"), 2500);
    } catch {
      setError("Falha de rede. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  if (!token && !done) {
    return (
      <AuthSplitLayout
        variant="client"
        eyebrow="Recuperação"
        title="Link inválido"
        subtitle="Abra o link enviado por e-mail ou solicite uma nova recuperação de palavra-passe."
        headerAction={{ href: "/", label: "Site" }}
      >
        <p className="text-sm text-content-muted">
          <Link href="/forgot-password" className="font-medium text-primary hover:text-primary-hover">
            Pedir novo link
          </Link>{" "}
          ·{" "}
          <Link href="/admin/forgot-password" className="font-medium text-primary hover:text-primary-hover">
            Recuperação admin
          </Link>
        </p>
      </AuthSplitLayout>
    );
  }

  return (
    <AuthSplitLayout
      variant="client"
      eyebrow="Recuperação"
      title={done ? "Palavra-passe atualizada" : "Nova palavra-passe"}
      subtitle={
        done
          ? "A redirecionar para o início de sessão…"
          : "Escolha uma palavra-passe forte (mínimo 8 caracteres). Não reutilize palavras-passe de outros serviços."
      }
      headerAction={{ href: "/", label: "Site" }}
    >
      {done ? (
        <p className="text-sm text-content-secondary">
          Pode iniciar sessão com a nova palavra-passe. Se não for redirecionado,{" "}
          <Link href="/login" className="font-medium text-primary hover:text-primary-hover">
            clique aqui
          </Link>
          .
        </p>
      ) : (
        <form className="space-y-5" onSubmit={onSubmit} noValidate>
          <div>
            <label htmlFor={pwId} className="text-sm font-medium text-content-secondary">
              Nova palavra-passe
            </label>
            <div className="relative mt-1.5">
              <Input
                id={pwId}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn("pr-12", weak && "border-red-500/60")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-content-muted outline-none transition hover:text-content-secondary focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>
            {weak ? <p className="mt-1 text-xs text-red-600">Mínimo de 8 caracteres.</p> : null}
          </div>

          <div>
            <label htmlFor={pw2Id} className="text-sm font-medium text-content-secondary">
              Confirmar palavra-passe
            </label>
            <Input
              id={pw2Id}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              className={cn("mt-1.5", mismatch && "border-red-500/60")}
            />
            {mismatch ? <p className="mt-1 text-xs text-red-600">As palavras-passe não coincidem.</p> : null}
          </div>

          {error ? (
            <p className="rounded-lg border border-line bg-surface-deep/90 px-3 py-2.5 text-sm text-content-secondary" role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" variant="gradient" className="w-full" isLoading={loading}>
            Guardar palavra-passe
          </Button>
        </form>
      )}
    </AuthSplitLayout>
  );
}
