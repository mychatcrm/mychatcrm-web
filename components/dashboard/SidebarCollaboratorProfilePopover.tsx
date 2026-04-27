"use client";

import { useCallback, useEffect, useId, useState, type ChangeEvent } from "react";
import type { ClientSession } from "@/lib/client-auth";
import { clientDemoReauthPassword } from "@/lib/client-demo-password";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";
import { ProfileAvatar, profileAvatarPresets, useDashboardProfileAvatar } from "./ProfileAvatar";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

type Anchor = { left: number; top: number; width: number };

export function SidebarCollaboratorProfilePopover({
  session,
  open,
  onClose,
  anchor,
  panelId,
  titleId,
}: {
  session: ClientSession;
  open: boolean;
  onClose: () => void;
  anchor: Anchor | null;
  panelId: string;
  titleId: string;
}) {
  const { isLight } = usePanelAppearance();
  const baseId = useId();
  const { avatar, setPresetAvatar, setUploadedAvatar, setInitialsAvatar } = useDashboardProfileAvatar(
    session.initials,
    session.displayName,
  );

  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [emailNew, setEmailNew] = useState("");
  const [emailNew2, setEmailNew2] = useState("");
  const [emailCurrentPass, setEmailCurrentPass] = useState("");
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdNew2, setPwdNew2] = useState("");

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setEmailNew("");
    setEmailNew2("");
    setEmailCurrentPass("");
    setPwdCurrent("");
    setPwdNew("");
    setPwdNew2("");
  }, [open]);

  const onPickPhoto = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !file.type.startsWith("image/")) {
        setMsg({ type: "err", text: "Escolhe uma imagem (JPG ou PNG)." });
        return;
      }
      if (file.size > 1_500_000) {
        setMsg({ type: "err", text: "Imagem demasiado grande (máx. ~1,5 MB nesta demo)." });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl) {
          setMsg({ type: "err", text: "Não foi possível ler o ficheiro." });
          return;
        }
        setUploadedAvatar(dataUrl);
        setMsg({ type: "ok", text: "Foto de perfil atualizada neste dispositivo." });
      };
      reader.onerror = () => setMsg({ type: "err", text: "Erro ao ler o ficheiro." });
      reader.readAsDataURL(file);
    },
    [setUploadedAvatar],
  );

  const submitEmail = useCallback(() => {
    setMsg(null);
    if (!emailCurrentPass.trim()) {
      setMsg({ type: "err", text: "Indica a palavra-passe atual para alterar o e-mail." });
      return;
    }
    if (emailCurrentPass !== clientDemoReauthPassword()) {
      setMsg({ type: "err", text: "Palavra-passe atual incorreta." });
      return;
    }
    const next = emailNew.trim().toLowerCase();
    if (!next || !next.includes("@")) {
      setMsg({ type: "err", text: "Indica um e-mail válido." });
      return;
    }
    if (next !== emailNew2.trim().toLowerCase()) {
      setMsg({ type: "err", text: "Os e-mails novos não coincidem." });
      return;
    }
    if (next === session.email.toLowerCase()) {
      setMsg({ type: "err", text: "O e-mail novo é igual ao atual." });
      return;
    }
    setMsg({
      type: "ok",
      text: "Pedido registado (simulação). Em produção enviaríamos confirmação por e-mail e atualizaríamos a sessão.",
    });
  }, [emailCurrentPass, emailNew, emailNew2, session.email]);

  const submitPassword = useCallback(() => {
    setMsg(null);
    if (!pwdCurrent.trim()) {
      setMsg({ type: "err", text: "Indica a palavra-passe atual." });
      return;
    }
    if (pwdCurrent !== clientDemoReauthPassword()) {
      setMsg({ type: "err", text: "Palavra-passe atual incorreta." });
      return;
    }
    if (pwdNew.length < 6) {
      setMsg({ type: "err", text: "A nova palavra-passe deve ter pelo menos 6 caracteres." });
      return;
    }
    if (pwdNew !== pwdNew2) {
      setMsg({ type: "err", text: "A confirmação não coincide." });
      return;
    }
    if (pwdNew === clientDemoReauthPassword()) {
      setMsg({ type: "err", text: "A nova palavra-passe deve ser diferente da atual de demo." });
      return;
    }
    setMsg({ type: "ok", text: "Palavra-passe atualizada (simulação). Em produção isto refletia na base de dados." });
    setPwdCurrent("");
    setPwdNew("");
    setPwdNew2("");
  }, [pwdCurrent, pwdNew, pwdNew2]);

  if (!open || !anchor) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const popW = Math.min(320, vw - 24);
  const centerX = anchor.left + anchor.width / 2;
  const left = Math.max(12, Math.min(centerX - popW / 2, vw - 12 - popW));

  return (
    <div
      id={panelId}
      role="dialog"
      aria-labelledby={titleId}
      className="fixed z-[120] max-h-[min(72vh,520px)] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface-card p-3 text-content"
      style={{
        left,
        top: anchor.top - 8,
        width: popW,
        transform: "translateY(-100%)",
      }}
    >
      <p id={titleId} className={cn(typography.ui.overline, "text-content-faint")}>
        A tua conta
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-content-muted">
        Altera avatar, e-mail e palavra-passe neste dispositivo.
        {process.env.NEXT_PUBLIC_SHOW_DEMO_LOGIN_HELP === "1" ? (
          <>
            {" "}
            Demo: a palavra-passe atual segue{" "}
            <span className="font-mono text-[10px] text-content-secondary">NEXT_PUBLIC_DEMO_REAUTH_PASSWORD</span> ou o
            valor por defeito em desenvolvimento.
          </>
        ) : null}
      </p>

      {msg ? (
        <p
          className={cn(
            "mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug",
            msg.type === "ok"
              ? cn("border-emerald-500/35 bg-emerald-500/10", isLight ? "text-emerald-900" : "text-emerald-100")
              : cn("border-rose-500/35 bg-rose-500/10", isLight ? "text-rose-900" : "text-rose-100"),
          )}
          role="status"
        >
          {msg.text}
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-content-muted">Avatar</p>
        <div className="flex items-center gap-2">
          <ProfileAvatar avatar={avatar} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1">
              {profileAvatarPresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.label}
                  onClick={() => {
                    setPresetAvatar(p.id);
                    setMsg({ type: "ok", text: `Avatar «${p.label}» aplicado neste dispositivo.` });
                  }}
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line/80 transition hover:border-primary/40 hover:ring-1 hover:ring-primary/20",
                    p.className,
                  )}
                  aria-label={`Usar avatar ${p.label}`}
                >
                  <p.Icon className="h-3.5 w-3.5 text-white/95" strokeWidth={1.85} aria-hidden />
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <label className="cursor-pointer">
                <span className="inline-flex min-h-[32px] items-center rounded-lg border border-line bg-surface-deep/60 px-2.5 text-[11px] font-medium text-content-secondary transition hover:border-primary/35 hover:text-content">
                  Carregar foto
                </span>
                <input type="file" accept="image/*" className="sr-only" onChange={onPickPhoto} />
              </label>
              <button
                type="button"
                className="text-[11px] font-medium text-content-muted underline decoration-line/60 underline-offset-2 hover:text-primary"
                onClick={() => {
                  setInitialsAvatar();
                  setMsg({ type: "ok", text: "Avatar reposto para as iniciais." });
                }}
              >
                Usar iniciais
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t border-line/70 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-content-muted">E-mail de acesso</p>
        <p className="text-[10px] text-content-faint">Atual: {session.email}</p>
        <Input
          id={`${baseId}-em1`}
          type="email"
          autoComplete="email"
          placeholder="Novo e-mail"
          value={emailNew}
          onChange={(e) => setEmailNew(e.target.value)}
          className="min-h-[40px] text-[13px]"
        />
        <Input
          id={`${baseId}-em2`}
          type="email"
          autoComplete="email"
          placeholder="Confirmar novo e-mail"
          value={emailNew2}
          onChange={(e) => setEmailNew2(e.target.value)}
          className="min-h-[40px] text-[13px]"
        />
        <Input
          id={`${baseId}-empw`}
          type="password"
          autoComplete="current-password"
          placeholder="Palavra-passe atual"
          value={emailCurrentPass}
          onChange={(e) => setEmailCurrentPass(e.target.value)}
          className="min-h-[40px] text-[13px]"
        />
        <Button type="button" size="sm" className="w-full" onClick={submitEmail}>
          Guardar e-mail (simulação)
        </Button>
      </div>

      <div className="mt-4 space-y-2 border-t border-line/70 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-content-muted">Palavra-passe</p>
        <Input
          id={`${baseId}-pw0`}
          type="password"
          autoComplete="current-password"
          placeholder="Palavra-passe atual"
          value={pwdCurrent}
          onChange={(e) => setPwdCurrent(e.target.value)}
          className="min-h-[40px] text-[13px]"
        />
        <Input
          id={`${baseId}-pw1`}
          type="password"
          autoComplete="new-password"
          placeholder="Nova palavra-passe"
          value={pwdNew}
          onChange={(e) => setPwdNew(e.target.value)}
          className="min-h-[40px] text-[13px]"
        />
        <Input
          id={`${baseId}-pw2`}
          type="password"
          autoComplete="new-password"
          placeholder="Confirmar nova palavra-passe"
          value={pwdNew2}
          onChange={(e) => setPwdNew2(e.target.value)}
          className="min-h-[40px] text-[13px]"
        />
        <Button type="button" size="sm" className="w-full" onClick={submitPassword}>
          Atualizar palavra-passe (simulação)
        </Button>
      </div>

      <div className="mt-3 flex justify-end border-t border-line/60 pt-2">
        <button
          type="button"
          className="text-[11px] font-medium text-content-muted hover:text-content"
          onClick={onClose}
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
