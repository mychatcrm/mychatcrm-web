"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { useLocale } from "next-intl";
import { Eye, EyeOff, Star } from "lucide-react";
import { DsButton } from "@/components/ds/Button";
import { DsInput } from "@/components/ds/Input";
import { BRAND_LOGO } from "@/lib/brand";
import { safeAppInternalPath } from "@/lib/safe-redirect";
import { defaultLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/* ─── Google icon ─── */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

/* ─── Chat mockup (left brand panel) ─── */
function ChatMockup() {
  return (
    <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-mc-base border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F24400]/20 text-xs font-bold text-[#F24400]">
          IA
        </div>
        <div>
          <p className="text-[11px] font-semibold text-white">Assistente MyChatCRM</p>
          <p className="text-[10px] text-white/50">• online agora</p>
        </div>
      </div>
      <div className="space-y-2">
        {/* AI bubble */}
        <div className="max-w-[85%] rounded-mc-base rounded-tl-sm bg-white/10 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-white/90">
            Olá! Posso ajudar com informações sobre nossos planos 😊
          </p>
        </div>
        {/* User bubble (WhatsApp green — intencional) */}
        <div className="ml-auto max-w-[80%] rounded-mc-base rounded-tr-sm bg-[#25D366] px-3 py-2">
          <p className="text-[11px] leading-relaxed text-white">Quero o plano Equipa</p>
        </div>
        {/* AI bubble */}
        <div className="max-w-[85%] rounded-mc-base rounded-tl-sm bg-white/10 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-white/90">
            Ótimo! Vou te enviar o link de acesso agora ✅
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Left brand panel ─── */
function BrandPanel() {
  return (
    <aside
      className="hidden lg:flex lg:w-[420px] xl:w-[480px] flex-col justify-between px-10 py-12 xl:px-14"
      style={{ backgroundColor: "var(--color-coal)" }}
      aria-hidden
    >
      {/* Logo */}
      <Link href="/" className="inline-flex items-center gap-2.5" tabIndex={-1}>
        <Image src={BRAND_LOGO.default} alt="" width={36} height={36} className="shrink-0" />
        <span className="font-sans text-lg font-bold tracking-tight text-white">
          <span className="text-[#F24400]">My</span>ChatCRM
        </span>
      </Link>

      {/* Headline + chat mockup */}
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold leading-snug tracking-tight text-white xl:text-3xl">
            Sua operação comercial atende sozinha,{" "}
            <span className="text-[#F24400]">24h por dia</span>
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            IA + CRM Kanban + WhatsApp — tudo integrado para vender mais sem contratar mais.
          </p>
        </div>
        <ChatMockup />
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-6 border-t border-white/10 pt-8">
        {[
          { value: "+1.200", label: "clientes" },
          { value: "4,9", label: "avaliação", icon: <Star size={11} fill="currentColor" className="text-amber-400" /> },
          { value: "99,9%", label: "uptime" },
        ].map((s) => (
          <div key={s.label}>
            <p className="flex items-center gap-1 text-lg font-bold text-white">
              {s.value}
              {s.icon}
            </p>
            <p className="text-[11px] text-white/50">{s.label}</p>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ─── Main LoginForm ─── */
export default function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const locale = useLocale();
  const forgotHref = locale === defaultLocale ? "/forgot-password" : `/${locale}/forgot-password`;

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailId = useId();
  const passwordId = useId();
  const nameId = useId();

  /* ─── Login handler (preserves existing logic) ─── */
  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
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
        if (response.status === 503) {
          setError(
            payload?.error ??
              "Serviço de autenticação indisponível. Confirme a configuração do servidor ou tente novamente.",
          );
          return;
        }
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

  /* ─── Signup handler ─── */
  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "").trim();
    if (!name || !email || !password) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/client/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, password }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; redirectedTo?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Não foi possível criar a conta. Tente novamente.");
        return;
      }

      const dest = safeAppInternalPath(
        typeof payload?.redirectedTo === "string" ? payload.redirectedTo : null,
        "/dashboard",
      );
      router.replace(dest);
    } catch {
      setError("Falha ao criar conta. Tente novamente em instantes.");
    } finally {
      setLoading(false);
    }
  };

  const isLogin = mode === "login";

  return (
    <div className="flex min-h-dvh bg-mc-bg font-sans text-mc-text">
      <BrandPanel />

      {/* Right panel — form */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-8">
        {/* Mobile logo */}
        <Link href="/" className="mb-10 flex items-center gap-2.5 lg:hidden">
          <Image src={BRAND_LOGO.default} alt="MyChatCRM" width={32} height={32} />
          <span className="font-sans text-base font-bold tracking-tight text-mc-text">
            <span className="text-[#F24400]">My</span>ChatCRM
          </span>
        </Link>

        <div className="w-full max-w-[380px]">
          {/* Tabs */}
          <div className="mb-8 flex rounded-mc-base border border-mc-border bg-mc-surface-2 p-1">
            {(["login", "signup"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => { setMode(tab); setError(null); }}
                className={cn(
                  "flex-1 rounded-[10px] py-2 text-sm font-medium transition-colors",
                  mode === tab
                    ? "bg-mc-surface text-mc-text"
                    : "text-mc-muted hover:text-mc-text",
                )}
              >
                {tab === "login" ? "Entrar" : "Criar conta"}
              </button>
            ))}
          </div>

          {/* Form */}
          <form
            key={mode}
            onSubmit={isLogin ? handleLogin : handleSignup}
            className="space-y-4"
            noValidate
          >
            {/* Name — signup only */}
            {!isLogin && (
              <div>
                <label htmlFor={nameId} className="mb-1.5 block text-sm font-medium text-mc-text">
                  Nome
                </label>
                <DsInput
                  id={nameId}
                  name="name"
                  type="text"
                  required
                  autoComplete="name"
                  placeholder="Seu nome completo"
                  autoFocus
                />
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium text-mc-text">
                E-mail
              </label>
              <DsInput
                id={emailId}
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="voce@empresa.com.br"
                autoFocus={isLogin}
              />
            </div>

            {/* Password */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor={passwordId} className="text-sm font-medium text-mc-text">
                  Senha
                </label>
                {isLogin && (
                  <Link
                    href={forgotHref}
                    className="text-xs font-medium text-[#F24400] transition hover:text-[#B22A00]"
                  >
                    Esqueci a senha
                  </Link>
                )}
              </div>
              <div className="relative">
                <DsInput
                  id={passwordId}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-mc-muted transition-colors hover:text-mc-text"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p
                className="rounded-mc-base border border-mc-border bg-mc-surface-2 px-3 py-2.5 text-sm leading-snug text-mc-text"
                role="alert"
              >
                {error}
              </p>
            )}

            {/* Submit */}
            <DsButton type="submit" size="lg" className="w-full" isLoading={loading}>
              {isLogin ? "Entrar" : "Criar conta"}
            </DsButton>
          </form>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-mc-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-mc-bg px-3 text-xs text-mc-muted">ou</span>
            </div>
          </div>

          {/* Google */}
          <DsButton
            type="button"
            variant="secondary"
            size="lg"
            className="w-full gap-3"
            onClick={() => setError("Login com Google em breve.")}
          >
            <GoogleIcon />
            Continuar com Google
          </DsButton>

          {/* Mode toggle */}
          <p className="mt-6 text-center text-sm text-mc-muted">
            {isLogin ? "Não tem conta? " : "Já tem conta? "}
            <button
              type="button"
              onClick={() => { setMode(isLogin ? "signup" : "login"); setError(null); }}
              className="font-medium text-[#F24400] transition hover:text-[#B22A00]"
            >
              {isLogin ? "Criar conta" : "Entrar"}
            </button>
          </p>

          {/* Footer */}
          <p className="mt-8 text-center text-xs leading-relaxed text-mc-muted">
            Ao continuar, você concorda com os{" "}
            <Link href="/termos" className="underline-offset-2 hover:text-mc-text hover:underline">
              Termos
            </Link>{" "}
            e a{" "}
            <Link href="/privacidade" className="underline-offset-2 hover:text-mc-text hover:underline">
              Política de Privacidade
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
