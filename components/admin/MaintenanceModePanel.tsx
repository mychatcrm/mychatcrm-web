"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Toggle } from "@/components/ui/Toggle";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";

type StatePayload = {
  enabled: boolean;
  message: string;
  estimatedReturnAt: string;
  updatedAt: string;
  updatedByAdminEmail: string;
};

export function MaintenanceModePanel() {
  const { isLight } = usePanelAppearance();
  const msgId = useId();
  const etaId = useId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StatePayload | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [etaDraft, setEtaDraft] = useState("");

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/maintenance", { credentials: "include", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as StatePayload & { error?: string } | null;
      if (!res.ok) {
        setError(j?.error ?? "Não foi possível carregar o estado.");
        setData(null);
        return;
      }
      if (!j) {
        setData(null);
        return;
      }
      setData({
        enabled: j.enabled,
        message: j.message ?? "",
        estimatedReturnAt: j.estimatedReturnAt ?? "",
        updatedAt: j.updatedAt ?? "",
        updatedByAdminEmail: j.updatedByAdminEmail ?? "",
      });
      setMessageDraft(j.message ?? "");
      setEtaDraft(j.estimatedReturnAt ?? "");
    } catch {
      setError("Falha de rede ao carregar manutenção.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/maintenance", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          message: messageDraft.trim(),
          estimatedReturnAt: etaDraft.trim(),
        }),
      });
      const j = (await res.json().catch(() => null)) as StatePayload & { error?: string } | null;
      if (!res.ok) {
        setError(j?.error ?? "Não foi possível guardar.");
        return;
      }
      if (j && "enabled" in j) {
        setData({
          enabled: j.enabled,
          message: j.message ?? "",
          estimatedReturnAt: j.estimatedReturnAt ?? "",
          updatedAt: j.updatedAt ?? "",
          updatedByAdminEmail: j.updatedByAdminEmail ?? "",
        });
      }
      await load();
    } catch {
      setError("Falha de rede ao guardar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className={cn(
        "rounded-xl border p-5 sm:p-6",
        isLight
          ? "border-slate-200/80 bg-surface-deep text-content"
          : "border-line/80 bg-surface-card text-content",
      )}
    >
      <div className="mb-5">
        <h2 className="text-[17px] font-semibold text-content sm:text-xl">Modo manutenção global</h2>
        <p className={cn("mt-1.5 text-[13px] leading-relaxed", isLight ? "text-slate-600" : "text-content-muted")}>
          Quando ativo, visitantes e clientes não acedem ao site nem às APIs públicas. Administradores com sessão
          válida mantêm acesso total para operar e para desativar aqui.
        </p>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading || !data ? (
        <p className={cn(typography.ui.caption, "text-content-muted")}>A carregar estado…</p>
      ) : (
        <div className="space-y-5">
          <Toggle
            id="maintenance-global"
            checked={data.enabled}
            disabled={saving}
            onChange={(v) => void persist(v)}
            label={data.enabled ? "Manutenção ativa" : "Manutenção desligada"}
            description={
              data.enabled
                ? "O público vê a página de manutenção; APIs de cliente respondem 503."
                : "O sistema público funciona normalmente."
            }
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={msgId} className={cn(typography.ui.overline, "text-content-muted")}>
                Mensagem pública (opcional)
              </label>
              <Input
                id={msgId}
                value={messageDraft}
                disabled={saving}
                onChange={(e) => setMessageDraft(e.target.value)}
                placeholder="Ex.: Atualização de infraestrutura. Voltamos em breve."
                className="mt-1.5"
              />
            </div>
            <div>
              <label htmlFor={etaId} className={cn(typography.ui.overline, "text-content-muted")}>
                Previsão de retorno (texto curto, opcional)
              </label>
              <Input
                id={etaId}
                value={etaDraft}
                disabled={saving}
                onChange={(e) => setEtaDraft(e.target.value)}
                placeholder="Ex.: 26/04/2026 às 22h (UTC−3)"
                className="mt-1.5"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void persist(data.enabled)}>
              Guardar texto / previsão
            </Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => void load()}>
              Recarregar
            </Button>
          </div>

          {data.updatedAt ? (
            <p className="text-xs text-content-faint">
              Última alteração: {data.updatedAt}
              {data.updatedByAdminEmail ? ` · ${data.updatedByAdminEmail}` : ""}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
