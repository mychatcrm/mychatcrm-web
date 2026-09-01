"use client";

import { useState } from "react";

type Props = {
  open: boolean;
  source: "contact" | "buy" | null;
  onClose: () => void;
};

const inputClass =
  "mt-1 w-full rounded-mc-base border border-mc-border bg-mc-surface-2 px-3.5 py-2.5 text-[14px] text-mc-text outline-none focus:border-[#F24400]";

export function PreLaunchLeadModal({ open, source, onClose }: Props) {
  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [website, setWebsite] = useState(""); // campo-armadilha, invisível
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  if (!open) return null;

  const reset = () => {
    setFullName(""); setWhatsapp(""); setEmail(""); setBusinessDescription(""); setWebsite("");
    setError(""); setDone(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pre-launch-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, whatsapp, email, businessDescription, website, source }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Não foi possível enviar. Tente de novo.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao enviar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-[18px] border border-mc-border bg-mc-surface p-6 sm:p-7"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Fechar"
          className="absolute right-4 top-4 text-[18px] text-mc-muted hover:text-mc-text"
        >
          ✕
        </button>

        {done ? (
          <div className="py-4 text-center">
            <p className="text-[22px]">🎉</p>
            <h2 className="mt-3 text-[20px] font-bold text-mc-text">Prontinho!</h2>
            <p className="mt-2 text-[14.5px] leading-6 text-mc-muted">
              Assim que o MyChatCRM estiver disponível pra todo mundo, a gente avisa você por WhatsApp ou e-mail.
            </p>
            <button
              type="button"
              onClick={close}
              className="mt-6 w-full rounded-mc-base px-6 py-3 text-[15px] font-bold text-white active:scale-[0.98]"
              style={{ background: "#F24400" }}
            >
              Fechar
            </button>
          </div>
        ) : (
          <>
            <h2 className="pr-6 text-[20px] font-bold text-mc-text">O MyChatCRM ainda está em fase final de testes 🚧</h2>
            <p className="mt-2 text-[14px] leading-6 text-mc-muted">
              Estamos ajustando os últimos detalhes antes de abrir pra todo mundo. Deixa seus dados que avisamos assim que estiver pronto!
            </p>

            <div className="mt-5 space-y-3">
              <label className="block text-[13px] font-medium text-mc-text">Nome completo
                <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
              </label>
              <label className="block text-[13px] font-medium text-mc-text">WhatsApp (com DDD)
                <input className={inputClass} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(62) 99999-9999" autoComplete="tel" inputMode="tel" />
              </label>
              <label className="block text-[13px] font-medium text-mc-text">E-mail
                <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </label>
              <label className="block text-[13px] font-medium text-mc-text">O que você faz? (conte rapidamente sobre seu negócio)
                <textarea className={`${inputClass} min-h-[70px] resize-none`} value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} placeholder="ex.: tenho uma imobiliária, uma loja de roupas..." />
              </label>
              {/* Campo-armadilha: fora da tela, só bot preenche. */}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="absolute left-[-9999px] h-0 w-0 opacity-0"
                aria-hidden="true"
              />
            </div>

            {error ? <p className="mt-3 text-[13px] text-red-600">{error}</p> : null}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="mt-5 w-full rounded-mc-base px-6 py-3 text-[15px] font-bold text-white transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              style={{ background: "#F24400" }}
            >
              {busy ? "Enviando…" : "Quero ser avisado"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
