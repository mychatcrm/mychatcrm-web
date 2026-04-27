"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Loader2, Plus, Shield } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";
import type { EnterpriseProvisionLimits } from "@/lib/enterprise-provision-types";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";

type Row = {
  id: string;
  tenantId: string;
  organizationName: string;
  ownerEmail: string;
  ownerName: string;
  createdAt: string;
  notes?: string;
  limits: EnterpriseProvisionLimits;
};

type LimitKey = keyof EnterpriseProvisionLimits;

const LIMIT_LABELS: Record<LimitKey, string> = {
  maxDirectors: "Diretores (máx.)",
  maxManagers: "Gerentes (máx.)",
  maxSellers: "Vendedores (máx.)",
  includedAgents: "Agentes IA incluídos",
  maxSalesFunnels: "Funis de vendas (máx.)",
  monthlyAttendedLeadsCap: "Leads atendidos / mês",
  includedWhatsAppLines: "Linhas WhatsApp incluídas",
};

function formatLimit(v: number | null) {
  return v === null ? "Sem limite" : v.toLocaleString("pt-BR");
}

export function AdminEnterpriseWorkspace() {
  const { isLight } = usePanelAppearance();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [unl, setUnl] = useState<Record<LimitKey, boolean>>({
    maxDirectors: false,
    maxManagers: false,
    maxSellers: false,
    includedAgents: false,
    maxSalesFunnels: false,
    monthlyAttendedLeadsCap: false,
    includedWhatsAppLines: false,
  });
  const [nums, setNums] = useState<Record<LimitKey, string>>({
    maxDirectors: "2",
    maxManagers: "5",
    maxSellers: "40",
    includedAgents: "15",
    maxSalesFunnels: "30",
    monthlyAttendedLeadsCap: "50000",
    includedWhatsAppLines: "1",
  });
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/enterprise-provisions", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { provisions?: Row[]; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || "Falha ao carregar.");
      setRows(data?.provisions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const limitsPayload = useMemo((): EnterpriseProvisionLimits => {
    const pick = (k: LimitKey): number | null => {
      if (unl[k]) return null;
      const n = Number(String(nums[k]).replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.floor(n);
    };
    return {
      maxDirectors: pick("maxDirectors"),
      maxManagers: pick("maxManagers"),
      maxSellers: pick("maxSellers"),
      includedAgents: pick("includedAgents"),
      maxSalesFunnels: pick("maxSalesFunnels"),
      monthlyAttendedLeadsCap: pick("monthlyAttendedLeadsCap"),
      includedWhatsAppLines: pick("includedWhatsAppLines"),
    };
  }, [nums, unl]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setToast(null);
    try {
      const res = await fetch("/api/admin/enterprise-provisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: orgName,
          ownerName,
          ownerEmail,
          initialPassword: password,
          notes,
          limits: limitsPayload,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.error || "Não foi possível criar.");
      setToast(data?.message ?? "Conta Enterprise criada.");
      setModalOpen(false);
      setOrgName("");
      setOwnerName("");
      setOwnerEmail("");
      setPassword("");
      setNotes("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border p-6 sm:p-8",
          isLight
            ? "border-slate-200 bg-gradient-to-br from-slate-50 via-white to-orange-50/40"
            : "border-line bg-gradient-to-br from-surface-deep via-surface-card to-surface-deep/80",
        )}
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              <Shield className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              Provisionamento
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
              Contas Enterprise
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-content-muted">
              Cada cliente recebe um <span className="font-medium text-content-secondary">tenant isolado</span>, login
              próprio e limites operacionais definidos aqui. Nada disto aparece na vitrine pública — o pacote comercial
              continua sob consulta.
            </p>
          </div>
          <Button type="button" variant="primary" className="shrink-0 gap-2" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
            Nova conta
          </Button>
        </div>
      </div>

      {toast ? (
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
            isLight ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
          )}
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" strokeWidth={2} aria-hidden />
          <span>{toast}</span>
        </div>
      ) : null}

      {error && !modalOpen ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className={cn(typography.ui.overline, "text-content-faint")}>Organizações</h2>
            <p className="mt-1 text-lg font-semibold text-content">Contas criadas ({rows.length})</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Atualizar lista
          </Button>
        </div>

        {loading ? (
          <div className="flex min-h-[200px] items-center justify-center text-content-muted">
            <Loader2 className="h-8 w-8 animate-spin" strokeWidth={1.5} aria-hidden />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line py-16 text-center">
            <Building2 className="h-10 w-10 text-content-faint" strokeWidth={1.25} aria-hidden />
            <p className="max-w-md text-sm text-content-muted">
              Ainda não existem contas Enterprise provisionadas. Use «Nova conta» para criar o primeiro tenant com limites
              personalizados.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wide text-content-faint">
                  <th className="py-3 pr-3">Organização</th>
                  <th className="py-3 pr-3">Tenant</th>
                  <th className="py-3 pr-3">Titular</th>
                  <th className="py-3 pr-3">Criada</th>
                  <th className="py-3">Limites (resumo)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-surface-elevated/30">
                    <td className="py-3 pr-3 font-medium text-content">{r.organizationName}</td>
                    <td className="py-3 pr-3 font-mono text-xs text-content-muted">{r.tenantId}</td>
                    <td className="py-3 pr-3 text-content-secondary">
                      <div>{r.ownerName}</div>
                      <div className="text-xs text-content-muted">{r.ownerEmail}</div>
                    </td>
                    <td className="py-3 pr-3 text-xs text-content-muted">
                      {new Date(r.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="py-3 text-xs text-content-muted">
                      Dir {formatLimit(r.limits.maxDirectors)} · Ger {formatLimit(r.limits.maxManagers)} · Vend{" "}
                      {formatLimit(r.limits.maxSellers)} · Agentes {formatLimit(r.limits.includedAgents)} · Funis{" "}
                      {formatLimit(r.limits.maxSalesFunnels)} · Leads/mês {formatLimit(r.limits.monthlyAttendedLeadsCap)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={modalOpen} onClose={() => !saving && setModalOpen(false)} title="Nova conta Enterprise">
        <form onSubmit={onCreate} className="space-y-5">
          {error ? <p className="text-sm text-error">{error}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={cn(typography.label.subtle)}>Nome da organização</label>
              <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Ex.: Grupo Médico Alfa" required className="mt-1" />
            </div>
            <div>
              <label className={cn(typography.label.subtle)}>Nome do titular</label>
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Nome completo" required className="mt-1" />
            </div>
            <div>
              <label className={cn(typography.label.subtle)}>E-mail de acesso</label>
              <Input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="titular@empresa.com"
                required
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={cn(typography.label.subtle)}>Senha inicial (mín. 8 caracteres)</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="O titular usa esta senha em /login"
                required
                minLength={8}
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={cn(typography.label.subtle)}>Notas internas (opcional)</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referência do contrato, CS responsável…" className="mt-1" />
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface-elevated/30 p-4">
            <p className={cn(typography.label.default)}>Limites operacionais</p>
            <p className="mt-1 text-xs text-content-muted">
              Marque «Sem limite» para ignorar o teto neste eixo (valor interno alto). Os números aplicam-se ao painel e
              regras de equipa.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(Object.keys(LIMIT_LABELS) as LimitKey[]).map((k) => (
                <div key={k} className="rounded-lg border border-line/80 bg-surface-card/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-content-secondary">{LIMIT_LABELS[k]}</span>
                    <label className="flex items-center gap-1.5 text-[11px] text-content-muted">
                      <input
                        type="checkbox"
                        checked={unl[k]}
                        onChange={(e) => setUnl((p) => ({ ...p, [k]: e.target.checked }))}
                        className="rounded border-line"
                      />
                      Sem limite
                    </label>
                  </div>
                  {!unl[k] ? (
                    <Input
                      value={nums[k]}
                      onChange={(e) => setNums((p) => ({ ...p, [k]: e.target.value }))}
                      className="mt-2"
                      inputMode="numeric"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving} isLoading={saving}>
              Criar tenant e titular
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
