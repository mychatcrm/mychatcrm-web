"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { AuthSplitLayout, type AuthSplitVariant } from "@/components/auth/AuthSplitLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Scope = "admin" | "member";

type Props = {
  variant: AuthSplitVariant;
  scope: Scope;
  title: string;
  subtitle: string;
  loginHref: string;
  loginLabel: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_SECONDS = 60;

export function ForgotPasswordForm({ variant, scope, title, subtitle, loginHref, loginLabel }: Props) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown() {
    setCooldownLeft(COOLDOWN_SECONDS);
    const iv = setInterval(() => {
      setCooldownLeft((v) => {
        if (v <= 1) {
          clearInterval(iv);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    cooldownRef.current = iv;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Indique um endereço de e-mail válido.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, scope }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        setError(data?.message ?? "Não foi possível enviar o pedido. Tente novamente.");
        return;
      }
      setMessage(data?.message ?? "Verifique o seu e-mail.");
      setEmail("");
      startCooldown();
    } catch {
      setError("Falha de rede. Tente novamente em instantes.");
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || cooldownLeft > 0;

  return (
    <AuthSplitLayout
      variant={variant}
      eyebrow="Recuperação de acesso"
      title={title}
      subtitle={subtitle}
      headerAction={{ href: "/", label: "Site" }}
    >
      <form className="space-y-5" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor={emailId} className="text-sm font-medium text-content-secondary">
            E-mail da conta
          </label>
          <Input
            id={emailId}
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={variant === "admin" ? "admin@empresa.com.br" : "voce@empresa.com.br"}
            className="mt-1.5"
            disabled={disabled}
            aria-describedby={error ? `${emailId}-err` : message ? `${emailId}-msg` : undefined}
          />
        </div>

        {error ? (
          <p
            id={`${emailId}-err`}
            className="rounded-lg border border-line bg-surface-deep/90 px-3 py-2.5 text-sm leading-snug text-content-secondary"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </p>
        ) : null}

        {message ? (
          <p
            id={`${emailId}-msg`}
            className="rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5 text-sm leading-snug text-content-secondary"
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          variant="gradient"
          className="w-full"
          isLoading={loading}
          disabled={disabled}
        >
          {cooldownLeft > 0
            ? `Reenviar em ${cooldownLeft}s`
            : "Enviar instruções"}
        </Button>

        <p className="text-center text-sm text-content-muted">
          <Link href={loginHref} className="font-medium text-primary transition hover:text-primary-hover">
            ← {loginLabel}
          </Link>
        </p>
      </form>
    </AuthSplitLayout>
  );
}
