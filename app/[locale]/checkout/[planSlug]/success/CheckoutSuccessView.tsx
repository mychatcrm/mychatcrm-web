"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LinkButton } from "@/components/ui/LinkButton";

type State =
  | { phase: "loading" }
  | { phase: "set-password"; email: string; token: string }
  | { phase: "done"; email: string }
  | { phase: "error"; message: string };

export function CheckoutSuccessView({
  planName,
  sessionId,
}: {
  planName: string;
  sessionId: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setState({ phase: "error", message: "Sessão de pagamento não encontrada." });
      return;
    }

    let cancelled = false;
    const poll = async (attempts = 0) => {
      try {
        const res = await fetch(`/api/stripe/activate?session_id=${sessionId}`);
        const data = (await res.json()) as {
          ok?: boolean;
          email?: string;
          activationToken?: string;
          message?: string;
        };

        if (cancelled) return;

        if (res.ok && data.ok && data.activationToken) {
          setState({
            phase: "set-password",
            email: data.email ?? "",
            token: data.activationToken,
          });
          return;
        }

        // Pagamento ainda processando — tenta até 5x com intervalo de 3s
        if (res.status === 402 && attempts < 5) {
          setTimeout(() => poll(attempts + 1), 3000);
          return;
        }

        setState({
          phase: "error",
          message: data.message ?? "Não foi possível confirmar seu pagamento.",
        });
      } catch {
        if (!cancelled) {
          setState({ phase: "error", message: "Erro de rede. Tente recarregar a página." });
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);

    if (password.length < 8) {
      setPwError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setPwError("As senhas não coincidem.");
      return;
    }

    if (state.phase !== "set-password") return;

    setSaving(true);
    try {
      const res = await fetch("/api/stripe/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: state.token, password }),
      });
      const data = (await res.json()) as { ok?: boolean; email?: string; message?: string };

      if (!res.ok || !data.ok) {
        setPwError(data.message ?? "Não foi possível salvar a senha.");
        return;
      }

      setState({ phase: "done", email: data.email ?? state.email });
    } catch {
      setPwError("Erro inesperado. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  if (state.phase === "loading") {
    return (
      <div className="mx-auto w-full max-w-lg rounded-3xl border border-line bg-surface-card px-5 py-10 text-center shadow-card-hover-glow sm:px-8 sm:py-12">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        <p className="mt-6 text-sm text-content-muted">Confirmando seu pagamento…</p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="mx-auto w-full max-w-lg rounded-3xl border border-line bg-surface-card px-5 py-10 text-center shadow-card-hover-glow sm:px-8 sm:py-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10 text-3xl text-rose-500">
          ✕
        </div>
        <h2 className="mt-6 font-display text-2xl font-bold text-content">Ops, algo correu mal</h2>
        <p className="mt-3 text-sm text-content-muted">{state.message}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            size="lg"
            variant="gradient"
            className="w-full sm:w-auto"
            onClick={() => router.refresh()}
          >
            Tentar novamente
          </Button>
          <LinkButton href="/planos" size="lg" variant="secondary" className="w-full sm:w-auto">
            Ver planos
          </LinkButton>
        </div>
      </div>
    );
  }

  if (state.phase === "done") {
    return (
      <div className="mx-auto w-full max-w-lg rounded-3xl border border-line bg-surface-card px-5 py-10 text-center shadow-card-hover-glow sm:px-8 sm:py-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-3xl text-success">
          ✓
        </div>
        <h2 className="mt-6 font-display text-2xl font-bold text-content">
          Conta criada com sucesso!
        </h2>
        <p className="mt-3 text-sm text-content-muted">
          Bem-vindo ao plano <strong className="text-content-secondary">{planName}</strong>. Já
          pode entrar com o e-mail{" "}
          <span className="font-mono text-content-secondary">{state.email}</span> e a senha que
          acabou de definir.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <LinkButton href="/login" size="lg" variant="gradient" className="w-full sm:w-auto">
            Entrar agora
          </LinkButton>
        </div>
      </div>
    );
  }

  // phase === "set-password"
  return (
    <div className="mx-auto w-full max-w-lg rounded-3xl border border-line bg-surface-card px-5 py-10 shadow-card-hover-glow sm:px-8 sm:py-12">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-3xl text-success">
          ✓
        </div>
        <h2 className="mt-6 font-display text-2xl font-bold text-content">
          Pagamento confirmado!
        </h2>
        <p className="mt-2 text-sm text-content-muted">
          Crie agora a senha para o seu acesso ao plano{" "}
          <strong className="text-content-secondary">{planName}</strong>.
        </p>
        <p className="mt-1 font-mono text-sm text-content-secondary">{state.email}</p>
      </div>

      <form className="mt-8 space-y-5" onSubmit={(e) => void handleSetPassword(e)}>
        <div>
          <label htmlFor="password" className="text-sm font-medium text-content-secondary">
            Criar senha
          </label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5"
            placeholder="Mínimo 8 caracteres"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label htmlFor="confirm" className="text-sm font-medium text-content-secondary">
            Confirmar senha
          </label>
          <Input
            id="confirm"
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1.5"
            placeholder="Repita a senha"
            autoComplete="new-password"
          />
        </div>

        {pwError ? <p className="text-sm text-rose-500">{pwError}</p> : null}

        <Button type="submit" size="lg" variant="gradient" className="w-full" isLoading={saving}>
          Criar conta e entrar
        </Button>
      </form>
    </div>
  );
}
