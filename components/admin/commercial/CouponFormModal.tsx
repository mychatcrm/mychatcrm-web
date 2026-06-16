"use client";

import { useCallback, useEffect, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { Toggle } from "@/components/ui/Toggle";
import type {
  CommercialCoupon,
  CommercialPartner,
  CouponPeriodicity,
} from "@/lib/commercial/types";
import { PLAN_CHECKOUT_SLUGS } from "@/lib/plans";
import { cn } from "@/lib/utils";

const PERIODICITY_OPTIONS: { value: CouponPeriodicity; label: string }[] = [
  { value: "monthly", label: "Mensal" },
  { value: "yearly", label: "Anual" },
];

export type CouponFormDraft = Partial<CommercialCoupon> & { id?: string };

function emptyDraft(): CouponFormDraft {
  return {
    code: "",
    internalName: "",
    description: "",
    discountType: "percent",
    discountValue: 10,
    validFrom: null,
    validUntil: null,
    maxRedemptionsTotal: null,
    maxRedemptionsPerUser: null,
    allowedPlanSlugs: [],
    allowedPeriodicities: [],
    discountRecurrence: "first_cycle",
    recurringCyclesLimit: null,
    active: true,
    partnerId: null,
    createPublicCode: false,
    stripeProductIds: [],
    firstTimeOnly: false,
    restrictedCustomerEmail: null,
    minimumAmountBrl: null,
  };
}

function StripeSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-b border-line pb-5 last:border-b-0 last:pb-0">
      <div>
        <h3 className="text-sm font-semibold text-content">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-content-muted">{description}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(className)}>
      {label ? <label className="text-xs font-semibold text-content-muted">{label}</label> : null}
      <div className={label ? "mt-1.5" : undefined}>{children}</div>
      {hint ? <p className="mt-1 text-xs text-content-faint">{hint}</p> : null}
    </div>
  );
}

function OptionalCheckbox({
  id,
  label,
  checked,
  onChange,
  disabled,
  children,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="sm:col-span-2">
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          id={id}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-primary"
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="cursor-pointer text-sm text-content-secondary">
            {label}
          </label>
          {checked && children ? <div className="mt-2.5">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

function SegmentedOption({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
        active
          ? "border-primary bg-primary/10 text-content ring-1 ring-primary/30"
          : "border-line text-content-muted hover:border-line-strong hover:bg-surface-elevated/40",
      )}
    >
      {children}
    </button>
  );
}

type CouponFormModalProps = {
  open: boolean;
  coupon: CommercialCoupon | null;
  partners: CommercialPartner[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

export function CouponFormModal({ open, coupon, partners, onClose, onSaved }: CouponFormModalProps) {
  const isEdit = Boolean(coupon?.id);
  const [draft, setDraft] = useState<CouponFormDraft>(emptyDraft());
  const [extraCodeInputs, setExtraCodeInputs] = useState<string[]>([]);
  const [limitRedeemUntil, setLimitRedeemUntil] = useState(false);
  const [limitMaxRedemptions, setLimitMaxRedemptions] = useState(false);
  const [restrictCustomer, setRestrictCustomer] = useState(false);
  const [minimumAmount, setMinimumAmount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingStripe, setSyncingStripe] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (coupon) {
      setDraft({
        ...coupon,
        validFrom: coupon.validFrom ?? null,
        validUntil: coupon.validUntil ?? null,
      });
      setExtraCodeInputs([]);
      setLimitRedeemUntil(Boolean(coupon.validUntil));
      setLimitMaxRedemptions(coupon.maxRedemptionsTotal != null);
      setRestrictCustomer(Boolean(coupon.restrictedCustomerEmail));
      setMinimumAmount(coupon.minimumAmountBrl != null);
    } else {
      setDraft(emptyDraft());
      setExtraCodeInputs([]);
      setLimitRedeemUntil(false);
      setLimitMaxRedemptions(false);
      setRestrictCustomer(false);
      setMinimumAmount(false);
    }
  }, [open, coupon]);

  const setDuration = (opt: "once" | "repeating" | "forever") => {
    if (opt === "once") {
      setDraft((d) => ({ ...d, discountRecurrence: "first_cycle", recurringCyclesLimit: null }));
    } else if (opt === "forever") {
      setDraft((d) => ({ ...d, discountRecurrence: "all_cycles", recurringCyclesLimit: null }));
    } else {
      setDraft((d) => ({
        ...d,
        discountRecurrence: "all_cycles",
        recurringCyclesLimit: d.recurringCyclesLimit ?? 1,
      }));
    }
  };

  const durationActive = (opt: "once" | "repeating" | "forever") => {
    if (opt === "once") return draft.discountRecurrence === "first_cycle";
    if (opt === "forever")
      return draft.discountRecurrence === "all_cycles" && draft.recurringCyclesLimit === null;
    return draft.discountRecurrence === "all_cycles" && draft.recurringCyclesLimit !== null;
  };

  const validateDraft = useCallback((): string | null => {
    if (!String(draft.internalName ?? "").trim()) return "Nome é obrigatório.";
    if (!isEdit) {
      if (draft.createPublicCode !== false && !String(draft.code ?? "").trim()) {
        return "Código do cupom é obrigatório quando códigos públicos estão ativos.";
      }
      const dv = Number(draft.discountValue);
      if (!Number.isFinite(dv) || dv < 0) return "Valor de desconto inválido.";
      if (draft.discountType === "percent" && dv > 100) return "Percentual não pode exceder 100.";
    }
    return null;
  }, [draft, isEdit]);

  const buildPayload = () => ({
    ...draft,
    validFrom: draft.validFrom || null,
    validUntil: limitRedeemUntil ? draft.validUntil || null : null,
    maxRedemptionsTotal: limitMaxRedemptions ? draft.maxRedemptionsTotal : null,
    restrictedCustomerEmail: restrictCustomer ? draft.restrictedCustomerEmail || null : null,
    minimumAmountBrl: minimumAmount ? draft.minimumAmountBrl : null,
    extraCodes: extraCodeInputs.filter((c) => c.trim().length > 0),
  });

  const save = async () => {
    setFormError(null);
    const v = validateDraft();
    if (v) {
      setFormError(v);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Erro HTTP ${res.status}`);
      onClose();
      await onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const syncStripe = async () => {
    if (!coupon?.id) return;
    setFormError(null);
    setSyncingStripe(true);
    try {
      const res = await fetch(`/api/admin/coupons/${encodeURIComponent(coupon.id)}/sync-stripe`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Falha ao sincronizar com o Stripe.");
      await onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao sincronizar.");
    } finally {
      setSyncingStripe(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Editar cupom · ${coupon?.code}` : "Criar cupom"}
      className="max-w-3xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {isEdit && coupon?.active && coupon.createPublicCode !== false && !coupon.stripePromoCodeId ? (
            <Button type="button" variant="secondary" onClick={() => void syncStripe()} isLoading={syncingStripe}>
              Sincronizar Stripe
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void save()} isLoading={saving}>
            {isEdit ? "Salvar alterações" : "Criar cupom"}
          </Button>
        </div>
      }
    >
      {formError ? <p className="mb-3 text-sm text-rose-400">{formError}</p> : null}
      {isEdit && coupon?.active && coupon.createPublicCode !== false && !coupon.stripePromoCodeId ? (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          Este cupom está ativo mas sem Promotion Code no Stripe — use «Sincronizar Stripe» para criar a promo.
        </p>
      ) : null}
      {isEdit ? (
        <p className="mb-4 text-xs text-content-muted">
          No Stripe, só o nome pode ser alterado após a criação. Aqui você também pode editar status, planos,
          periodicidade, limite por e-mail, parceiro e descrição interna.
        </p>
      ) : null}

      <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        {!isEdit ? (
          <>
            {/* Espelha a ordem do Stripe Dashboard → Products → Coupons → + New */}
            <StripeSection title="Informações do cupom">
              <Field label="Nome" hint="Aparece em recibos e faturas." className="sm:col-span-2">
                <Input
                  value={draft.internalName ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, internalName: e.target.value }))}
                  placeholder="Ex.: Desconto de lançamento"
                />
              </Field>

              <Field label="Tipo de desconto" className="sm:col-span-2">
                <div className="flex gap-2">
                  <SegmentedOption
                    active={draft.discountType === "percent"}
                    onClick={() => setDraft((d) => ({ ...d, discountType: "percent" }))}
                  >
                    <span className="font-medium">Percentual de desconto</span>
                  </SegmentedOption>
                  <SegmentedOption
                    active={draft.discountType === "fixed"}
                    onClick={() => setDraft((d) => ({ ...d, discountType: "fixed" }))}
                  >
                    <span className="font-medium">Valor fixo de desconto</span>
                  </SegmentedOption>
                </div>
              </Field>

              <Field label={draft.discountType === "fixed" ? "Valor do desconto" : "Percentual de desconto"}>
                <div className="relative">
                  {draft.discountType === "fixed" ? (
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-content-muted">
                      R$
                    </span>
                  ) : null}
                  <Input
                    type="number"
                    className={draft.discountType === "fixed" ? "pl-10" : undefined}
                    value={
                      draft.discountType === "fixed"
                        ? (draft.discountValue ?? 0) / 100
                        : (draft.discountValue ?? 0)
                    }
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (!Number.isFinite(n)) return;
                      setDraft((d) => ({
                        ...d,
                        discountValue: d.discountType === "fixed" ? Math.round(n * 100) : n,
                      }));
                    }}
                  />
                  {draft.discountType === "percent" ? (
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-content-muted">
                      %
                    </span>
                  ) : null}
                </div>
              </Field>

              <Field label="Duração">
                <div className="flex flex-wrap gap-2">
                  {(["once", "repeating", "forever"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDuration(opt)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        durationActive(opt)
                          ? "border-primary/40 bg-primary/15 text-content"
                          : "border-line text-content-muted",
                      )}
                    >
                      {opt === "once" ? "Uma vez" : opt === "repeating" ? "Vários meses" : "Vitalício"}
                    </button>
                  ))}
                </div>
                {durationActive("repeating") ? (
                  <Input
                    type="number"
                    className="mt-2"
                    min={1}
                    placeholder="Número de meses"
                    value={draft.recurringCyclesLimit ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        recurringCyclesLimit: e.target.value === "" ? 1 : parseInt(e.target.value, 10),
                      }))
                    }
                  />
                ) : null}
              </Field>

              <Field
                label="Aplicar a produtos específicos"
                hint="Opcional. Restringe o cupom a produtos Stripe (applies_to.products). IDs em Products no Dashboard."
                className="sm:col-span-2"
              >
                <Input
                  className="font-mono text-xs"
                  placeholder="prod_xxx, prod_yyy"
                  value={(draft.stripeProductIds ?? []).join(", ")}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      stripeProductIds: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter((s) => s.startsWith("prod_")),
                    }))
                  }
                />
              </Field>
            </StripeSection>

            <StripeSection
              title="Limites de resgate"
              description="Opcional. Configurações do Coupon no Stripe (redeem_by e max_redemptions)."
            >
              <OptionalCheckbox
                id="limit-redeem-until"
                label="Limitar o período em que os clientes podem resgatar o cupom"
                checked={limitRedeemUntil}
                onChange={(v) => {
                  setLimitRedeemUntil(v);
                  if (!v) setDraft((d) => ({ ...d, validUntil: null }));
                }}
              >
                <Field label="Válido até">
                  <Input
                    type="date"
                    value={draft.validUntil ? String(draft.validUntil).slice(0, 10) : ""}
                    onChange={(e) => setDraft((d) => ({ ...d, validUntil: e.target.value || null }))}
                  />
                </Field>
              </OptionalCheckbox>

              <OptionalCheckbox
                id="limit-max-redemptions"
                label="Limitar o total de vezes que o cupom pode ser resgatado"
                checked={limitMaxRedemptions}
                onChange={(v) => {
                  setLimitMaxRedemptions(v);
                  if (!v) setDraft((d) => ({ ...d, maxRedemptionsTotal: null }));
                }}
              >
                <Field label="Máximo de resgates">
                  <Input
                    type="number"
                    min={1}
                    value={draft.maxRedemptionsTotal ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        maxRedemptionsTotal: e.target.value === "" ? null : parseInt(e.target.value, 10),
                      }))
                    }
                  />
                </Field>
              </OptionalCheckbox>
            </StripeSection>

            <StripeSection title="Códigos de cupom">
              <Field className="sm:col-span-2">
                <Toggle
                  id="create-public-code"
                  checked={draft.createPublicCode === true}
                  onChange={(v) => setDraft((d) => ({ ...d, createPublicCode: v }))}
                  label="Usar códigos de cupons visíveis para o cliente"
                />
                <p className="mt-1.5 text-xs text-content-faint">
                  Equivale ao botão «Use customer-facing coupon codes» no Stripe Dashboard.
                </p>
              </Field>

              {draft.createPublicCode === true ? (
                <>
                  <Field label="Código" className="sm:col-span-2">
                    <Input
                      className="font-mono uppercase"
                      value={draft.code ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          code: e.target.value.toUpperCase().replace(/\s+/g, ""),
                        }))
                      }
                      placeholder="PROMOOFFICE100"
                    />
                    <p className="mt-1 text-xs text-content-faint">
                      O código é sensível a maiúsculas/minúsculas no Stripe. Deixe em branco para o Stripe gerar
                      automaticamente — aqui exigimos um código explícito.
                    </p>
                  </Field>

                  <p className="sm:col-span-2 rounded-lg border border-line bg-surface-elevated/40 px-3 py-2 text-xs text-content-muted">
                    As restrições abaixo valem para o código principal e todos os códigos extras (decisão de
                    produto: sem schema por código).
                  </p>

                  <OptionalCheckbox
                    id="first-time-only"
                    label="Válido somente para o primeiro pedido"
                    checked={draft.firstTimeOnly === true}
                    onChange={(v) => setDraft((d) => ({ ...d, firstTimeOnly: v }))}
                  />

                  <OptionalCheckbox
                    id="restrict-customer"
                    label="Limitar a um cliente específico"
                    checked={restrictCustomer}
                    onChange={(v) => {
                      setRestrictCustomer(v);
                      if (!v) setDraft((d) => ({ ...d, restrictedCustomerEmail: null }));
                    }}
                  >
                    <Field
                      label="E-mail do cliente"
                      hint="Será buscado ou criado automaticamente no Stripe (customers.list → customers.create)."
                    >
                      <Input
                        type="email"
                        value={draft.restrictedCustomerEmail ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, restrictedCustomerEmail: e.target.value || null }))
                        }
                      />
                    </Field>
                  </OptionalCheckbox>

                  <OptionalCheckbox
                    id="minimum-amount"
                    label="Exigir um valor mínimo por pedido"
                    checked={minimumAmount}
                    onChange={(v) => {
                      setMinimumAmount(v);
                      if (!v) setDraft((d) => ({ ...d, minimumAmountBrl: null }));
                    }}
                  >
                    <Field label="Valor mínimo">
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-content-muted">
                          R$
                        </span>
                        <Input
                          type="number"
                          className="pl-10"
                          min={0}
                          step={0.01}
                          value={
                            draft.minimumAmountBrl != null ? (draft.minimumAmountBrl / 100).toFixed(2) : ""
                          }
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              minimumAmountBrl: e.target.value
                                ? Math.round(parseFloat(e.target.value) * 100)
                                : null,
                            }))
                          }
                        />
                      </div>
                    </Field>
                  </OptionalCheckbox>

                  <div className="sm:col-span-2">
                    {extraCodeInputs.map((c, i) => (
                      <div key={i} className="mt-2 flex gap-2">
                        <Input
                          className="font-mono uppercase"
                          value={c}
                          onChange={(e) => {
                            const next = [...extraCodeInputs];
                            next[i] = e.target.value.toUpperCase().replace(/\s+/g, "");
                            setExtraCodeInputs(next);
                          }}
                          placeholder={`CÓDIGO_EXTRA_${i + 1}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setExtraCodeInputs((prev) => prev.filter((_, j) => j !== i))}
                        >
                          Remover
                        </Button>
                      </div>
                    ))}
                    {extraCodeInputs.length < 5 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className={extraCodeInputs.length > 0 ? "mt-2" : undefined}
                        onClick={() => setExtraCodeInputs((prev) => [...prev, ""])}
                      >
                        + Adicionar outro código
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </StripeSection>
          </>
        ) : (
          <StripeSection title="Informações do cupom">
            <Field label="Nome" hint="Único campo editável no Stripe após a criação." className="sm:col-span-2">
              <Input
                value={draft.internalName ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, internalName: e.target.value }))}
              />
            </Field>
            <Field label="Status" className="sm:col-span-2">
              <Toggle
                id="coupon-active"
                checked={draft.active !== false}
                onChange={(v) => setDraft((d) => ({ ...d, active: v }))}
                label="Cupom ativo"
              />
            </Field>
          </StripeSection>
        )}

        <StripeSection
          title="Restrições MyChatCRM"
          description="Campos exclusivos do nosso sistema — não existem no formulário do Stripe."
        >
          <Field label="Restringir a planos" className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {PLAN_CHECKOUT_SLUGS.map((slug) => {
                const on = draft.allowedPlanSlugs?.includes(slug);
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() =>
                      setDraft((d) => {
                        const cur = d.allowedPlanSlugs ?? [];
                        const next = on ? cur.filter((s) => s !== slug) : [...cur, slug];
                        return { ...d, allowedPlanSlugs: next };
                      })
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                      on ? "border-primary/40 bg-primary/15 text-content" : "border-line text-content-muted",
                    )}
                  >
                    {slug}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-content-faint">Vazio = todos os planos com checkout.</p>
          </Field>

          <Field label="Periodicidade" className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {PERIODICITY_OPTIONS.map(({ value, label }) => {
                const on = draft.allowedPeriodicities?.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setDraft((d) => {
                        const cur = d.allowedPeriodicities ?? [];
                        const next = on ? cur.filter((p) => p !== value) : [...cur, value];
                        return { ...d, allowedPeriodicities: next };
                      })
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      on ? "border-primary/40 bg-primary/15 text-content" : "border-line text-content-muted",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-content-faint">Vazio = mensal e anual.</p>
          </Field>

          <Field label="Limite de usos por e-mail">
            <Input
              type="number"
              min={0}
              placeholder="Ilimitado"
              value={draft.maxRedemptionsPerUser ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  maxRedemptionsPerUser: e.target.value === "" ? null : parseInt(e.target.value, 10),
                }))
              }
            />
          </Field>

          <Field label="Parceiro vinculado">
            <Select
              value={draft.partnerId ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, partnerId: e.target.value || null }))}
            >
              <option value="">Nenhum</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Descrição interna" className="sm:col-span-2">
            <Input
              value={draft.description ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </Field>
        </StripeSection>
      </div>
    </Modal>
  );
}
