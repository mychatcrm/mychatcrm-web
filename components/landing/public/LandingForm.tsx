"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatWhatsapp } from "@/lib/brazil-whatsapp";
import type { LandingFormBlock, LandingFormField } from "@/lib/landing/types";

/**
 * O formulário — a única parte interativa da página.
 *
 * Tudo o resto é HTML servido pelo servidor. Isso não é purismo: a página vive
 * de tráfego pago, e o Índice de Qualidade do Google leva em conta a velocidade
 * de carregamento para calcular o custo por clique. Página leve custa menos por
 * clique, e esse é um argumento comercial que se mede.
 */
export function LandingForm({
  block,
  fields,
  accent,
  radius,
}: {
  block: LandingFormBlock;
  fields: LandingFormField[];
  accent: string;
  radius: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const attribution = useRef<Record<string, string>>({});

  /**
   * Os parâmetros do clique são lidos uma vez, na montagem, e guardados.
   * Se a pessoa navegar dentro da página antes de enviar, a query pode sumir da
   * barra — e com ela o `gclid` que liga este lead à campanha que o pagou.
   */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const captured: Record<string, string> = {};
      for (const key of [
        "gclid", "wbraid", "gbraid", "fbclid", "msclkid",
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      ]) {
        const value = params.get(key);
        if (value) captured[key] = value;
      }
      attribution.current = captured;
    } catch {
      attribution.current = {};
    }
  }, []);

  const requiredMissing = useMemo(() => {
    return fields.some((field) => field.required && !String(values[field.key] ?? "").trim());
  }, [fields, values]);

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setErrors({});

    try {
      const response = await fetch("/api/public/landing/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fields: values,
          consent,
          attribution: attribution.current,
          referrer: typeof document !== "undefined" ? document.referrer : "",
          website: "",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        errors?: Record<string, string>;
      };

      if (!response.ok) {
        setErrors(payload.errors ?? {});
        setMessage(payload.error ?? "Não foi possível enviar. Tente novamente.");
        setState("error");
        return;
      }

      setMessage(payload.message ?? block.successMessage);
      setState("done");
    } catch {
      setMessage("Não foi possível enviar. Verifique a ligação e tente novamente.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="mcl-form mcl-form--done" role="status" aria-live="polite">
        <p className="mcl-form__success">{message}</p>
      </div>
    );
  }

  return (
    <form className="mcl-form" onSubmit={submit} noValidate>
      {fields.map((field) => (
        <label key={field.key} className="mcl-field">
          <span className="mcl-field__label">
            {field.label}
            {field.required ? <span aria-hidden="true"> *</span> : null}
          </span>

          {field.kind === "textarea" ? (
            <textarea
              className="mcl-input"
              rows={4}
              value={values[field.key] ?? ""}
              placeholder={field.placeholder}
              onChange={(event) => setValue(field.key, event.target.value)}
              aria-invalid={Boolean(errors[field.key])}
            />
          ) : field.kind === "select" ? (
            <select
              className="mcl-input"
              value={values[field.key] ?? ""}
              onChange={(event) => setValue(field.key, event.target.value)}
              aria-invalid={Boolean(errors[field.key])}
            >
              <option value="">Selecione</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="mcl-input"
              type={field.kind === "email" ? "email" : field.kind === "phone" ? "tel" : "text"}
              inputMode={field.kind === "phone" ? "tel" : undefined}
              autoComplete={
                field.kind === "email" ? "email" : field.kind === "phone" ? "tel" : field.kind === "name" ? "name" : "off"
              }
              value={values[field.key] ?? ""}
              placeholder={field.placeholder}
              onChange={(event) =>
                setValue(
                  field.key,
                  field.kind === "phone" ? formatWhatsapp(event.target.value) : event.target.value,
                )
              }
              aria-invalid={Boolean(errors[field.key])}
            />
          )}

          {errors[field.key] ? <span className="mcl-field__error">{errors[field.key]}</span> : null}
        </label>
      ))}

      {/* Armadilha para robô. Escondida de quem vê e de quem ouve. */}
      <div className="mcl-hp" aria-hidden="true">
        <label>
          Não preencha
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label className="mcl-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>{block.consentText}</span>
      </label>
      {errors.consent ? <span className="mcl-field__error">{errors.consent}</span> : null}

      <button
        type="submit"
        className="mcl-submit"
        style={{ background: accent, borderRadius: radius }}
        disabled={state === "sending" || requiredMissing || !consent}
      >
        {state === "sending" ? "A enviar…" : block.submitLabel}
      </button>

      {state === "error" && message ? (
        <p className="mcl-form__error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
