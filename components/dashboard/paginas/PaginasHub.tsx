"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DsBadge, DsButton, DsInput } from "@/components/ds";
import type { ClientSession } from "@/lib/client-auth";
import { CREDIT_ACTION_COST } from "@/lib/credits/pricing";
import { slugifyLandingName } from "@/lib/landing/slug";
import type { LandingDnsRecord } from "@/lib/landing/domain";
import type { LandingDomainRecord, LandingPageRecord } from "@/lib/landing/types";

type TemplateSummary = { id: string; name: string; summary: string; bestFor: string };

type Allowance = { included: number; extra: number; cap: number; published: number; remaining: number };

type Wallet = { balance: number; lifetimeGranted: number; lifetimeSpent: number; available: boolean };

type PageWithUrl = LandingPageRecord & { publicUrl: string | null };

type ListPayload = {
  configured: boolean;
  platformSubdomainEnabled: boolean;
  pagesDomain: string | null;
  canManage: boolean;
  available: boolean;
  allowance: Allowance;
  wallet: Wallet;
  templates: TemplateSummary[];
  domains: LandingDomainRecord[];
  pages: PageWithUrl[];
};

type DomainWithRecords = LandingDomainRecord & { records: LandingDnsRecord[] };

type LeadRuleSummary = { id: string; name: string; source: string; active?: boolean };

type DetailPayload = {
  page: LandingPageRecord;
  canManage: boolean;
  publicUrl: string | null;
  platformUrl: string | null;
  draft: { id: string; versionNo: number } | null;
  published: { id: string; versionNo: number } | null;
  versions: Array<{ id: string; versionNo: number; generatedBy: string; variantLabel: string | null; createdAt: string }>;
  domains: DomainWithRecords[];
  submissions: {
    total: number;
    last7Days: number;
    leadsCreated: number;
    byChannel: Record<string, number>;
    channelSampleSize?: number;
  };
};

const CHANNEL_LABEL: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  microsoft_ads: "Microsoft Ads",
  organic: "Orgânico",
  referral: "Referência",
  direct: "Direto",
};

export function PaginasHub({ session }: { session: ClientSession }) {
  const [data, setData] = useState<ListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/client/landing-pages", { cache: "no-store" });
      const payload = (await response.json()) as ListPayload & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Não foi possível carregar.");
        return;
      }
      setData(payload);
      setError(null);
    } catch {
      setError("Não foi possível carregar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <p className="text-sm text-mc-muted">A carregar…</p>;
  }

  if (error) {
    return <p className="text-sm text-error">{error}</p>;
  }

  if (!data) return null;

  if (!data.available) {
    return (
      <SetupNotice
        title="Módulo ainda não migrado"
        body="As tabelas das páginas de captura ainda não existem neste banco. Aplique a migração 20260918100000_landing_pages_credits_domains_v1.sql no Supabase e recarregue."
      />
    );
  }

  if (selectedId) {
    return (
      <PageDetail
        pageId={selectedId}
        pagesDomain={data.pagesDomain}
        templates={data.templates}
        onBack={() => {
          setSelectedId(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {!data.configured ? (
        <SetupNotice
          title="Endereço por configurar"
          body="Defina LANDING_PAGES_DOMAIN (endereço grátis, precisa de wildcard) ou LANDING_CUSTOM_DOMAINS_ENABLED=true (domínio do próprio cliente, funciona em qualquer plano). Sem um dos dois, dá para criar e gerar, mas não para colocar no ar."
        />
      ) : !data.platformSubdomainEnabled ? (
        <SetupNotice
          title="Só com domínio próprio"
          body="O endereço grátis da plataforma está desligado. Cada página precisa de um domínio do cliente ligado e verificado para ficar no ar."
        />
      ) : null}

      {notice ? <p className="rounded-mc-base bg-mc-surface-2 px-4 py-3 text-sm text-mc-text">{notice}</p> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Páginas publicadas"
          value={`${data.allowance.published} / ${data.allowance.cap}`}
          hint={
            data.allowance.remaining > 0
              ? `Pode publicar mais ${data.allowance.remaining}.`
              : "Limite do plano atingido."
          }
        />
        <StatCard
          label="Créditos"
          value={data.wallet.available ? String(data.wallet.balance) : "—"}
          hint={`Gerar uma página custa ${CREDIT_ACTION_COST.landing_generate_page}.`}
        />
        <StatCard
          label="Endereço"
          value={data.pagesDomain ? `*.${data.pagesDomain}` : "Domínio próprio"}
          hint={
            data.platformSubdomainEnabled
              ? "Cada página nasce com um endereço pronto."
              : "Ligue o domínio do cliente na aba de domínios da página."
          }
        />
      </div>

      {data.canManage ? (
        <CreatePageForm
          templates={data.templates}
          pagesDomain={data.platformSubdomainEnabled ? data.pagesDomain : null}
          defaultName={session.companyName ?? ""}
          onCreated={(pageId, message) => {
            setNotice(message);
            setSelectedId(pageId);
          }}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-mc-text">Suas páginas</h3>
        {data.pages.length === 0 ? (
          <p className="text-sm text-mc-muted">
            Ainda nenhuma página. Crie a primeira acima — leva menos de um minuto.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.pages.map((page) => (
              <li
                key={page.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-mc-base border border-mc-border bg-mc-surface px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-mc-text">{page.name}</span>
                    <DsBadge variant={page.status === "published" ? "success" : "neutral"}>
                      {page.status === "published" ? "No ar" : page.status === "draft" ? "Rascunho" : "Arquivada"}
                    </DsBadge>
                  </div>
                  <p className="truncate text-xs text-mc-muted">
                    {page.publicUrl ?? `${page.slug}.${data.pagesDomain ?? "—"}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {page.publicUrl && page.status === "published" ? (
                    <a
                      className="text-xs font-semibold text-mc-brand underline-offset-4 hover:underline"
                      href={page.publicUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Abrir
                    </a>
                  ) : null}
                  <DsButton variant="secondary" size="sm" onClick={() => setSelectedId(page.id)}>
                    Gerir
                  </DsButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-mc-base border border-mc-border bg-mc-surface px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-mc-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-mc-text">{value}</p>
      <p className="mt-1 text-xs text-mc-muted">{hint}</p>
    </div>
  );
}

function SetupNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-mc-base border border-warning/40 bg-warning/10 px-4 py-3">
      <p className="text-sm font-semibold text-mc-text">{title}</p>
      <p className="mt-1 text-sm text-mc-muted">{body}</p>
    </div>
  );
}

function CreatePageForm({
  templates,
  pagesDomain,
  defaultName,
  onCreated,
}: {
  templates: TemplateSummary[];
  pagesDomain: string | null;
  defaultName: string;
  onCreated: (pageId: string, message: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "direto");
  const [proposition, setProposition] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const slugPreview = useMemo(() => slugifyLandingName(name), [name]);

  async function create() {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch("/api/client/landing-pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, templateId, proposition, city, businessName: name }),
      });
      const payload = (await response.json()) as {
        page?: LandingPageRecord;
        slugChanged?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.page) {
        setFormError(payload.error ?? "Não foi possível criar.");
        return;
      }
      onCreated(
        payload.page.id,
        payload.slugChanged
          ? `Página criada. O endereço pedido já estava em uso, então ficou "${payload.page.slug}".`
          : "Página criada.",
      );
    } catch {
      setFormError("Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-mc-base border border-mc-border bg-mc-surface p-4">
      <h3 className="text-sm font-semibold text-mc-text">Nova página</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-mc-muted">Nome da página</span>
          <DsInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Campanha Google — Consultoria"
          />
          {slugPreview && pagesDomain ? (
            <span className="text-xs text-mc-muted">
              Endereço: {slugPreview}.{pagesDomain}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-mc-muted">Cidade (opcional)</span>
          <DsInput value={city} onChange={(event) => setCity(event.target.value)} placeholder="Ex.: Goiânia" />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-mc-muted">O que o negócio faz, em uma linha</span>
        <DsInput
          value={proposition}
          onChange={(event) => setProposition(event.target.value)}
          placeholder="Ex.: Avaliação gratuita e proposta no mesmo dia."
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-mc-muted">Modelo</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {templates.map((template) => (
            <label
              key={template.id}
              className={`cursor-pointer rounded-mc-base border p-3 text-left transition-colors ${
                templateId === template.id
                  ? "border-mc-brand bg-mc-surface-2"
                  : "border-mc-border hover:border-mc-muted"
              }`}
            >
              <input
                type="radio"
                name="template"
                className="sr-only"
                checked={templateId === template.id}
                onChange={() => setTemplateId(template.id)}
              />
              <span className="block text-sm font-semibold text-mc-text">{template.name}</span>
              <span className="mt-1 block text-xs text-mc-muted">{template.bestFor}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {formError ? <p className="text-sm text-error">{formError}</p> : null}

      <div>
        <DsButton onClick={create} isLoading={busy} disabled={busy || name.trim().length < 2}>
          Criar página
        </DsButton>
      </div>
    </div>
  );
}

function PageDetail({
  pageId,
  pagesDomain,
  templates,
  onBack,
}: {
  pageId: string;
  pagesDomain: string | null;
  templates: TemplateSummary[];
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "direto");
  const [brief, setBrief] = useState("");
  const [host, setHost] = useState("");
  /**
   * Muda a cada tentativa falhada. Sem isto, uma geração que falhou e devolveu
   * o crédito ficava presa: a repetição reutilizava a mesma chave de
   * idempotência e o servidor respondia "já foi feita" para sempre.
   */
  const [retryNonce, setRetryNonce] = useState(0);
  const [rules, setRules] = useState<LeadRuleSummary[]>([]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/client/landing-pages/${pageId}`, { cache: "no-store" });
    const payload = (await response.json()) as DetailPayload & { error?: string };
    if (!response.ok) {
      setProblem(payload.error ?? "Não foi possível carregar.");
      return;
    }
    setDetail(payload);
    setProblem(null);
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/client/lead-rules", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { rules?: LeadRuleSummary[] };
        if (!cancelled) setRules(payload.rules ?? []);
      } catch {
        // Sem regras carregadas o seletor some; a página continua a funcionar.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(
    key: string,
    url: string,
    init: RequestInit,
    onOk: (payload: Record<string, unknown>) => string,
  ) {
    if (busy) return;
    setBusy(key);
    setProblem(null);
    setMessage(null);
    try {
      const response = await fetch(url, init);
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setProblem(String(payload.error ?? "Não foi possível concluir."));
        setRetryNonce((value) => value + 1);
        return;
      }
      setMessage(onOk(payload));
      await load();
    } catch {
      setProblem("Não foi possível concluir.");
      setRetryNonce((value) => value + 1);
    } finally {
      setBusy(null);
    }
  }

  if (problem && !detail) return <p className="text-sm text-error">{problem}</p>;
  if (!detail) return <p className="text-sm text-mc-muted">A carregar…</p>;

  const { page, submissions } = detail;
  /**
   * Token estável por página + versão: dois cliques no mesmo botão reutilizam
   * a mesma chave e não são cobrados duas vezes.
   */
  const attemptToken = `${page.id}:${detail.draft?.versionNo ?? 0}:${retryNonce}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <DsButton variant="link" size="sm" onClick={onBack}>
            ← Todas as páginas
          </DsButton>
          <h3 className="text-base font-semibold text-mc-text">{page.name}</h3>
          <p className="text-xs text-mc-muted">
            {detail.platformUrl ?? `${page.slug}.${pagesDomain ?? "—"}`}
          </p>
        </div>
        <DsBadge variant={page.status === "published" ? "success" : "neutral"}>
          {page.status === "published" ? "No ar" : "Rascunho"}
        </DsBadge>
      </div>

      {message ? <p className="rounded-mc-base bg-success/10 px-4 py-2 text-sm text-mc-text">{message}</p> : null}
      {problem ? <p className="rounded-mc-base bg-error/10 px-4 py-2 text-sm text-error">{problem}</p> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Envios" value={String(submissions.total)} hint="Total de formulários recebidos." />
        <StatCard label="Últimos 7 dias" value={String(submissions.last7Days)} hint="Ritmo recente." />
        <StatCard label="Leads no CRM" value={String(submissions.leadsCreated)} hint="Entraram no funil." />
      </div>

      {Object.keys(submissions.byChannel).length > 0 ? (
        <div className="rounded-mc-base border border-mc-border bg-mc-surface p-4">
          <h4 className="text-sm font-semibold text-mc-text">De onde vieram</h4>
          {submissions.channelSampleSize !== undefined &&
          submissions.channelSampleSize < submissions.total ? (
            <p className="mt-1 text-xs text-mc-muted">
              Com base nos {submissions.channelSampleSize.toLocaleString("pt-BR")} envios mais
              recentes.
            </p>
          ) : null}
          <ul className="mt-2 flex flex-wrap gap-2">
            {Object.entries(submissions.byChannel).map(([channel, count]) => (
              <li key={channel} className="rounded-mc-base bg-mc-surface-2 px-3 py-1 text-xs text-mc-text">
                {CHANNEL_LABEL[channel] ?? channel}: {count}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail.canManage ? (
        <>
          <div className="flex flex-col gap-3 rounded-mc-base border border-mc-border bg-mc-surface p-4">
            <div>
              <h4 className="text-sm font-semibold text-mc-text">Entrega do lead</h4>
              <p className="text-xs text-mc-muted">
                A regra escolhida carimba a equipa no lead. <strong>Sem regra, o lead nasce sem
                equipa e só o titular o vê</strong> — os vendedores não o encontram no CRM.
              </p>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-mc-muted">Regra de distribuição</span>
              <select
                className="min-h-[44px] rounded-mc-base border border-mc-border bg-mc-surface-2 px-3 text-sm text-mc-text"
                value={page.ruleId ?? ""}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  act(
                    "rule",
                    `/api/client/landing-pages/${page.id}`,
                    {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ ruleId: event.target.value || null }),
                    },
                    () => "Regra atualizada.",
                  )
                }
              >
                <option value="">Sem regra — só o titular vê o lead</option>
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name}
                  </option>
                ))}
              </select>
              {rules.length === 0 ? (
                <span className="text-xs text-mc-muted">
                  Nenhuma regra encontrada. Crie uma em Integrações de Leads.
                </span>
              ) : null}
            </label>
          </div>

          <div className="flex flex-col gap-3 rounded-mc-base border border-mc-border bg-mc-surface p-4">
            <h4 className="text-sm font-semibold text-mc-text">Gerar conteúdo com IA</h4>
            <p className="text-xs text-mc-muted">
              O texto sai do que você já configurou no agente. Custa {CREDIT_ACTION_COST.landing_generate_page}{" "}
              créditos; a variante para teste A/B custa {CREDIT_ACTION_COST.landing_generate_variant}.
            </p>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-mc-muted">Pedido extra (opcional)</span>
              <DsInput
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder="Ex.: dar destaque ao atendimento no mesmo dia"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-mc-muted">Modelo</span>
              <select
                className="min-h-[44px] rounded-mc-base border border-mc-border bg-mc-surface-2 px-3 text-sm text-mc-text"
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-2">
              <DsButton
                isLoading={busy === "generate"}
                disabled={Boolean(busy)}
                onClick={() =>
                  act(
                    "generate",
                    `/api/client/landing-pages/${page.id}/generate`,
                    {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ templateId, brief, attemptToken: `${attemptToken}:page` }),
                    },
                    (payload) => `Conteúdo gerado. Saldo: ${payload.balance ?? "—"} créditos.`,
                  )
                }
              >
                Gerar página
              </DsButton>

              <DsButton
                variant="secondary"
                isLoading={busy === "variant"}
                disabled={Boolean(busy) || !detail.published}
                onClick={() =>
                  act(
                    "variant",
                    `/api/client/landing-pages/${page.id}/generate`,
                    {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        templateId,
                        brief,
                        variant: true,
                        attemptToken: `${attemptToken}:variant`,
                      }),
                    },
                    (payload) => `Variante gerada. Saldo: ${payload.balance ?? "—"} créditos.`,
                  )
                }
              >
                Gerar variante A/B
              </DsButton>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-mc-base border border-mc-border bg-mc-surface p-4">
            <div className="mr-auto">
              <h4 className="text-sm font-semibold text-mc-text">Publicação</h4>
              <p className="text-xs text-mc-muted">
                {detail.published
                  ? `No ar: versão ${detail.published.versionNo}.`
                  : "Ainda não publicada."}
                {detail.draft ? ` Rascunho: versão ${detail.draft.versionNo}.` : ""}
              </p>
            </div>
            {detail.draft ? (
              <a
                className="text-xs font-semibold text-mc-brand underline-offset-4 hover:underline"
                href={`/dashboard/paginas/preview/${page.id}?versao=${detail.draft.id}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Ver prévia
              </a>
            ) : null}
            <DsButton
              isLoading={busy === "publish"}
              disabled={Boolean(busy) || !detail.draft}
              onClick={() =>
                act(
                  "publish",
                  `/api/client/landing-pages/${page.id}/publish`,
                  { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
                  () => "Página publicada.",
                )
              }
            >
              Publicar rascunho
            </DsButton>
            {page.status === "published" ? (
              <DsButton
                variant="secondary"
                isLoading={busy === "unpublish"}
                disabled={Boolean(busy)}
                onClick={() =>
                  act(
                    "unpublish",
                    `/api/client/landing-pages/${page.id}/publish`,
                    { method: "DELETE" },
                    () => "Página fora do ar.",
                  )
                }
              >
                Despublicar
              </DsButton>
            ) : null}
          </div>

          <DomainsPanel
            pageId={page.id}
            domains={detail.domains}
            host={host}
            setHost={setHost}
            busy={busy}
            onPurchase={(chosen) =>
              act(
                `purchase:${chosen}`,
                `/api/client/landing-pages/${page.id}/domains/purchase`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ host: chosen, confirm: true }),
                },
                (payload) => String(payload.message ?? "Domínio comprado e ligado."),
              )
            }
            onAttach={() =>
              act(
                "attach",
                `/api/client/landing-pages/${page.id}/domains`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ host }),
                },
                () => "Domínio ligado. Crie os registos no seu registador e clique em verificar.",
              )
            }
            onVerify={(domainId) =>
              act(
                `verify:${domainId}`,
                `/api/client/landing-pages/${page.id}/domains/verify`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ domainId }),
                },
                (payload) => String(payload.message ?? "Verificação concluída."),
              )
            }
            onRemove={(domainId) =>
              act(
                `remove:${domainId}`,
                `/api/client/landing-pages/${page.id}/domains?domainId=${encodeURIComponent(domainId)}`,
                { method: "DELETE" },
                () => "Domínio removido.",
              )
            }
          />
        </>
      ) : null}
    </div>
  );
}

type DomainSuggestion = {
  domain: string;
  available: boolean;
  restriction: string | null;
  isAlternative: boolean;
  firstYearBRL: number | null;
  renewalBRL: number | null;
};

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const RESTRICTION_LABEL: Record<string, string> = {
  requires_cpf_or_cnpj: "Exige CPF ou CNPJ brasileiro",
};

function DomainsPanel({
  domains,
  host,
  setHost,
  busy,
  onAttach,
  onVerify,
  onRemove,
  onPurchase,
}: {
  pageId: string;
  domains: DomainWithRecords[];
  host: string;
  setHost: (value: string) => void;
  busy: string | null;
  onAttach: () => void;
  onVerify: (domainId: string) => void;
  onRemove: (domainId: string) => void;
  onPurchase: (host: string) => void;
}) {
  const [mode, setMode] = useState<"byo" | "buy">("byo");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<DomainSuggestion[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "searching" | "disabled">("idle");
  const [confirming, setConfirming] = useState<string | null>(null);

  async function search() {
    if (query.trim().length < 2) return;
    setSearchState("searching");
    try {
      const response = await fetch(`/api/client/domains/search?q=${encodeURIComponent(query.trim())}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        suggestions?: DomainSuggestion[];
        purchaseEnabled?: boolean;
      };
      setSuggestions(payload.suggestions ?? []);
      setSearchState(payload.purchaseEnabled ? "idle" : "disabled");
    } catch {
      setSuggestions([]);
      setSearchState("idle");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-mc-base border border-mc-border bg-mc-surface p-4">
      <div>
        <h4 className="text-sm font-semibold text-mc-text">Domínio próprio</h4>
        <p className="text-xs text-mc-muted">
          Use um domínio que já é seu ou compre um aqui. Nos dois casos, o certificado é emitido
          automaticamente.
        </p>
      </div>

      <div className="flex gap-2">
        <DsButton
          variant={mode === "byo" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setMode("byo")}
        >
          Já tenho um domínio
        </DsButton>
        <DsButton
          variant={mode === "buy" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setMode("buy")}
        >
          Comprar domínio
        </DsButton>
      </div>

      {mode === "byo" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-mc-muted">Domínio</span>
            <DsInput
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="exemplo.com.br ou lp.exemplo.com.br"
            />
          </label>
          <DsButton
            variant="secondary"
            isLoading={busy === "attach"}
            disabled={Boolean(busy) || host.trim().length < 4}
            onClick={onAttach}
          >
            Ligar domínio
          </DsButton>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[240px] flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-mc-muted">Nome desejado</span>
              <DsInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ex.: minhaempresa"
                onKeyDown={(event) => {
                  if (event.key === "Enter") void search();
                }}
              />
            </label>
            <DsButton
              variant="secondary"
              isLoading={searchState === "searching"}
              disabled={query.trim().length < 2}
              onClick={() => void search()}
            >
              Procurar
            </DsButton>
          </div>

          {searchState === "disabled" ? (
            <p className="text-xs text-mc-muted">
              A compra automática ainda não está ligada nesta conta. Fale com o suporte, ou registe o
              domínio onde preferir e use a aba &quot;Já tenho um domínio&quot;.
            </p>
          ) : null}

          {suggestions.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {suggestions.map((item) => (
                <li
                  key={item.domain}
                  className="flex flex-wrap items-center gap-2 rounded-mc-base border border-mc-border bg-mc-surface-2 px-3 py-2"
                >
                  <span className="text-sm font-medium text-mc-text">{item.domain}</span>
                  <DsBadge variant={item.available ? "success" : "neutral"}>
                    {item.available ? "Disponível" : "Indisponível"}
                  </DsBadge>
                  {item.firstYearBRL !== null ? (
                    <span className="text-xs text-mc-muted">
                      {brl(item.firstYearBRL)} no 1º ano
                      {item.renewalBRL !== null && item.renewalBRL !== item.firstYearBRL
                        ? ` · depois ${brl(item.renewalBRL)}/ano`
                        : "/ano"}
                    </span>
                  ) : null}
                  {item.restriction ? (
                    <span className="text-xs text-mc-muted">
                      {RESTRICTION_LABEL[item.restriction] ?? item.restriction}
                    </span>
                  ) : null}

                  {item.available && searchState !== "disabled" ? (
                    <div className="ml-auto flex items-center gap-2">
                      {confirming === item.domain ? (
                        <>
                          <span className="text-xs text-mc-muted">
                            Comprar {item.domain}
                            {item.firstYearBRL !== null ? ` por ${brl(item.firstYearBRL)}` : ""}? O
                            registo é por um ano e não pode ser desfeito.
                          </span>
                          <DsButton
                            size="sm"
                            isLoading={busy === `purchase:${item.domain}`}
                            disabled={Boolean(busy)}
                            onClick={() => {
                              setConfirming(null);
                              onPurchase(item.domain);
                            }}
                          >
                            Sim, comprar
                          </DsButton>
                          <DsButton size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                            Cancelar
                          </DsButton>
                        </>
                      ) : (
                        <DsButton
                          size="sm"
                          variant="secondary"
                          disabled={Boolean(busy)}
                          onClick={() => setConfirming(item.domain)}
                        >
                          Comprar
                        </DsButton>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {domains.length === 0 ? null : (
        <ul className="flex flex-col gap-3">
          {domains.map((domain) => (
            <li key={domain.id} className="rounded-mc-base border border-mc-border bg-mc-surface-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-mc-text">{domain.host}</span>
                <DsBadge variant={domain.status === "active" ? "success" : "warning"}>
                  {domain.status === "active"
                    ? "Ativo"
                    : domain.status === "verifying"
                      ? "A verificar"
                      : domain.status === "failed"
                        ? "Falhou"
                        : "Aguarda DNS"}
                </DsBadge>
                <div className="ml-auto flex gap-2">
                  {domain.status !== "active" ? (
                    <DsButton
                      variant="secondary"
                      size="sm"
                      isLoading={busy === `verify:${domain.id}`}
                      disabled={Boolean(busy)}
                      onClick={() => onVerify(domain.id)}
                    >
                      Verificar
                    </DsButton>
                  ) : null}
                  <DsButton
                    variant="ghost"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => onRemove(domain.id)}
                  >
                    Remover
                  </DsButton>
                </div>
              </div>

              {domain.status !== "active" && domain.records.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead>
                      <tr className="text-mc-muted">
                        <th className="py-1 pr-3 font-medium">Tipo</th>
                        <th className="py-1 pr-3 font-medium">Nome</th>
                        <th className="py-1 font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {domain.records.map((record) => (
                        <tr key={`${record.type}-${record.name}`} className="border-t border-mc-border">
                          <td className="py-1.5 pr-3 font-mono text-mc-text">{record.type}</td>
                          <td className="py-1.5 pr-3 font-mono text-mc-text">{record.name}</td>
                          <td className="py-1.5 font-mono text-mc-text break-all">{record.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-mc-muted">
                    Depois de criar os registos, clique em verificar. A propagação do DNS pode demorar
                    algumas horas.
                  </p>
                </div>
              ) : null}

              {domain.lastError && domain.status !== "active" ? (
                <p className="mt-2 text-xs text-mc-muted">Último resultado: {domain.lastError}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
