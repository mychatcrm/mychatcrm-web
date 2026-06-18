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
} from "@/lib/commercial/types";
import { cn } from "@/lib/utils";
import { StripeProductPicker, StripeInlineToggle, RowMenu, type StripeProductOption } from "@/components/admin/commercial/StripeProductPicker";
import { MinimumAmountFields } from "@/components/admin/commercial/MinimumAmountFields";
import { validatePromoExpiresWithinCouponRedeemBy } from "@/lib/server/stripe-coupon-mapping";

export type CouponFormDraft = Partial<CommercialCoupon> & {
  id?: string;
  promoMaxRedemptions?: number | null;
};

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
    minimumAmountCents: null,
    minimumAmountCurrency: "brl",
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

function combineRedeemUntil(date: string, time: string): string | null {
  if (!date.trim()) return null;
  const t = time.trim() || "23:59";
  const parsed = new Date(`${date}T${t}:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseRedeemUntilParts(value: string | null | undefined): { date: string; time: string } {
  if (!value) return { date: "", time: "23:59" };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: String(value).slice(0, 10), time: "23:59" };
  }
  const date = parsed.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const time = parsed.toLocaleTimeString("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { date, time };
}

export type PromoCodeBlockDraft = {
  code: string;
  collapsed: boolean;
  firstTimeOnly: boolean;
  restrictCustomer: boolean;
  restrictedCustomerEmail: string | null;
  limitPromoRedemptions: boolean;
  promoMaxRedemptions: number | null;
  promoValidityEnabled: boolean;
  promoExpiresDate: string;
  promoExpiresTime: string;
  minimumAmount: boolean;
  minimumAmountCents: number | null;
  minimumAmountCurrency: string;
};

function emptyPromoCodeBlock(): PromoCodeBlockDraft {
  return {
    code: "",
    collapsed: false,
    firstTimeOnly: false,
    restrictCustomer: false,
    restrictedCustomerEmail: null,
    limitPromoRedemptions: false,
    promoMaxRedemptions: null,
    promoValidityEnabled: false,
    promoExpiresDate: "",
    promoExpiresTime: "23:59",
    minimumAmount: false,
    minimumAmountCents: null,
    minimumAmountCurrency: "brl",
  };
}

function validatePromoCodeBlock(block: PromoCodeBlockDraft, label: string): string | null {
  if (block.limitPromoRedemptions && (block.promoMaxRedemptions == null || block.promoMaxRedemptions < 1)) {
    return `Informe o limite de resgates em «${label}» ou desative a opção.`;
  }
  if (block.promoValidityEnabled && !block.promoExpiresDate.trim()) {
    return `Informe a data de validade em «${label}» ou desative a opção.`;
  }
  if (block.restrictCustomer && !String(block.restrictedCustomerEmail ?? "").trim()) {
    return `Informe o e-mail do cliente em «${label}».`;
  }
  if (block.minimumAmount && (block.minimumAmountCents == null || block.minimumAmountCents < 0)) {
    return `Informe o valor mínimo em «${label}».`;
  }
  return null;
}

function promoBlockToApiOptions(block: PromoCodeBlockDraft) {
  return {
    firstTimeOnly: block.firstTimeOnly,
    restrictedCustomerEmail: block.restrictCustomer ? block.restrictedCustomerEmail : null,
    minimumAmountCents: block.minimumAmount ? block.minimumAmountCents : null,
    minimumAmountCurrency: block.minimumAmount ? block.minimumAmountCurrency : null,
    promoMaxRedemptions: block.limitPromoRedemptions ? block.promoMaxRedemptions : null,
    promoExpiresAt: block.promoValidityEnabled
      ? combineRedeemUntil(block.promoExpiresDate, block.promoExpiresTime)
      : null,
  };
}

function OptionalCheckbox({
  id,
  label,
  checked,
  onChange,
  disabled,
  className,
  children,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(className)}>
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

function CodePromoCard({
  title,
  collapsed,
  onToggleCollapse,
  menuItems,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  menuItems?: { label: string; onClick: () => void; destructive?: boolean }[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-surface-elevated/20 px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">{title}</span>
        {menuItems && menuItems.length > 0 ? (
          <RowMenu ariaLabel="Opções do código" items={menuItems} />
        ) : null}
        <button
          type="button"
          aria-label={collapsed ? "Expandir" : "Recolher"}
          onClick={onToggleCollapse}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-surface-elevated hover:text-content"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("transition-transform", collapsed ? "" : "rotate-180")}
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {!collapsed ? <div className="space-y-4 p-4">{children}</div> : null}
    </div>
  );
}

function PromoCodeBlockFields({
  block,
  idPrefix,
  onChange,
}: {
  block: PromoCodeBlockDraft;
  idPrefix: string;
  onChange: (patch: Partial<PromoCodeBlockDraft>) => void;
}) {
  return (
    <div className="space-y-4">
      <OptionalCheckbox
        id={`${idPrefix}-first-time`}
        label="Válido somente para o primeiro pedido"
        checked={block.firstTimeOnly}
        onChange={(v) => onChange({ firstTimeOnly: v })}
      />
      <OptionalCheckbox
        id={`${idPrefix}-restrict-customer`}
        label="Limitar a um cliente específico"
        checked={block.restrictCustomer}
        onChange={(v) => {
          onChange({
            restrictCustomer: v,
            restrictedCustomerEmail: v ? block.restrictedCustomerEmail : null,
          });
        }}
      >
        <Input
          type="email"
          placeholder="Encontrar ou adicionar um cliente…"
          value={block.restrictedCustomerEmail ?? ""}
          onChange={(e) =>
            onChange({ restrictedCustomerEmail: e.target.value.trim() || null })
          }
        />
      </OptionalCheckbox>
      <OptionalCheckbox
        id={`${idPrefix}-limit-promo`}
        label="Limitar o número de vezes que este código pode ser resgatado"
        checked={block.limitPromoRedemptions}
        onChange={(v) =>
          onChange({
            limitPromoRedemptions: v,
            promoMaxRedemptions: v ? block.promoMaxRedemptions : null,
          })
        }
      >
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            className="w-24"
            value={block.promoMaxRedemptions ?? ""}
            onChange={(e) =>
              onChange({
                promoMaxRedemptions: e.target.value === "" ? null : parseInt(e.target.value, 10),
              })
            }
          />
          <span className="text-sm text-content-muted">
            {(block.promoMaxRedemptions ?? 1) === 1 ? "vez" : "vezes"}
          </span>
        </div>
      </OptionalCheckbox>
      <OptionalCheckbox
        id={`${idPrefix}-promo-validity`}
        label="Incluir data de validade"
        checked={block.promoValidityEnabled}
        onChange={(v) =>
          onChange({
            promoValidityEnabled: v,
            promoExpiresDate: v ? block.promoExpiresDate : "",
            promoExpiresTime: v ? block.promoExpiresTime : "23:59",
          })
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            className="w-auto min-w-[10.5rem]"
            value={block.promoExpiresDate}
            onChange={(e) => onChange({ promoExpiresDate: e.target.value })}
          />
          <Input
            type="time"
            className="w-auto min-w-[7rem]"
            value={block.promoExpiresTime}
            onChange={(e) => onChange({ promoExpiresTime: e.target.value })}
          />
          <span className="text-xs font-medium text-content-faint">BRT</span>
        </div>
      </OptionalCheckbox>
      <OptionalCheckbox
        id={`${idPrefix}-minimum-amount`}
        label="Exigir um valor mínimo por pedido"
        checked={block.minimumAmount}
        onChange={(v) =>
          onChange({
            minimumAmount: v,
            minimumAmountCents: v ? block.minimumAmountCents : null,
            minimumAmountCurrency: v ? block.minimumAmountCurrency : "brl",
          })
        }
      >
        <MinimumAmountFields
          currency={block.minimumAmountCurrency}
          cents={block.minimumAmountCents}
          onCurrencyChange={(currency) =>
            onChange({ minimumAmountCurrency: currency, minimumAmountCents: null })
          }
          onCentsChange={(cents) => onChange({ minimumAmountCents: cents })}
        />
      </OptionalCheckbox>
    </div>
  );
}

function PromoCodeBlockEditor({
  block,
  idPrefix,
  onChange,
  onRemove,
}: {
  block: PromoCodeBlockDraft;
  idPrefix: string;
  onChange: (patch: Partial<PromoCodeBlockDraft>) => void;
  onRemove?: () => void;
}) {
  const title = block.code.trim() ? block.code : "O código será gerado quando for criado";

  return (
    <CodePromoCard
      title={title}
      collapsed={block.collapsed}
      onToggleCollapse={() => onChange({ collapsed: !block.collapsed })}
      menuItems={
        onRemove
          ? [{ label: "Remover código", onClick: onRemove, destructive: true }]
          : undefined
      }
    >
      <Field label="Código">
        <Input
          className="font-mono uppercase"
          value={block.code}
          onChange={(e) =>
            onChange({ code: e.target.value.toUpperCase().replace(/\s+/g, "") })
          }
          placeholder="FRIENDS20"
        />
      </Field>
      <PromoCodeBlockFields block={block} idPrefix={idPrefix} onChange={onChange} />
    </CodePromoCard>
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
  const [mainPromoBlock, setMainPromoBlock] = useState<PromoCodeBlockDraft>(emptyPromoCodeBlock);
  const [extraPromoBlocks, setExtraPromoBlocks] = useState<PromoCodeBlockDraft[]>([]);
  const [limitRedeemUntil, setLimitRedeemUntil] = useState(false);
  const [limitMaxRedemptions, setLimitMaxRedemptions] = useState(false);
  const [redeemUntilDate, setRedeemUntilDate] = useState("");
  const [redeemUntilTime, setRedeemUntilTime] = useState("23:59");
  const [saving, setSaving] = useState(false);
  const [syncingStripe, setSyncingStripe] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [stripeProducts, setStripeProducts] = useState<StripeProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [productRestrictionEnabled, setProductRestrictionEnabled] = useState(false);
  const [mychatcrmOpen, setMychatcrmOpen] = useState(false);

  const loadStripeProducts = useCallback(async () => {
    if (productsLoaded && stripeProducts.length > 0) return;
    setLoadingProducts(true);
    setProductsError(null);
    try {
      const res = await fetch("/api/admin/stripe/products");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Erro HTTP ${res.status}`);
      setStripeProducts(Array.isArray(data?.products) ? data.products : []);
      setProductsLoaded(true);
    } catch (e) {
      setProductsError(e instanceof Error ? e.message : "Falha ao carregar produtos do Stripe.");
      setStripeProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  }, [productsLoaded, stripeProducts.length]);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (coupon) {
      setDraft({
        ...coupon,
        validFrom: coupon.validFrom ?? null,
        validUntil: coupon.validUntil ?? null,
      });
      setExtraPromoBlocks([]);
      setMainPromoBlock(emptyPromoCodeBlock());
      setLimitRedeemUntil(Boolean(coupon.validUntil));
      setLimitMaxRedemptions(coupon.maxRedemptionsTotal != null);
      const redeemParts = parseRedeemUntilParts(coupon.validUntil);
      setRedeemUntilDate(redeemParts.date);
      setRedeemUntilTime(redeemParts.time);
      setMychatcrmOpen(
        Boolean(
          coupon.maxRedemptionsPerUser != null ||
            coupon.partnerId ||
            String(coupon.description ?? "").trim(),
        ),
      );
    } else {
      setDraft(emptyDraft());
      setMainPromoBlock(emptyPromoCodeBlock());
      setExtraPromoBlocks([]);
      setLimitRedeemUntil(false);
      setLimitMaxRedemptions(false);
      setRedeemUntilDate("");
      setRedeemUntilTime("23:59");
      setProductsLoaded(false);
      setStripeProducts([]);
      setProductsError(null);
      setProductRestrictionEnabled(false);
      setMychatcrmOpen(false);
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
      if (draft.createPublicCode !== false) {
        if (!mainPromoBlock.code.trim()) {
          return "Código do cupom é obrigatório quando códigos públicos estão ativos.";
        }
        const mainBlockErr = validatePromoCodeBlock(mainPromoBlock, "código principal");
        if (mainBlockErr) return mainBlockErr;
        for (let i = 0; i < extraPromoBlocks.length; i++) {
          const label = extraPromoBlocks[i].code.trim() || `código ${i + 2}`;
          const err = validatePromoCodeBlock(extraPromoBlocks[i], label);
          if (err) return err;
        }
      }
      const dv = Number(draft.discountValue);
      if (!Number.isFinite(dv) || dv < 0) return "Valor de desconto inválido.";
      if (draft.discountType === "percent" && dv > 100) return "Percentual não pode exceder 100.";
      if (productRestrictionEnabled && (draft.stripeProductIds?.length ?? 0) === 0) {
        return "Selecione pelo menos um produto ou desative «Aplicar a produtos específicos».";
      }
      if (limitRedeemUntil && !redeemUntilDate.trim()) {
        return "Informe a data em «Resgatar até» ou desative o limite de período.";
      }
      if (limitMaxRedemptions && (draft.maxRedemptionsTotal == null || draft.maxRedemptionsTotal < 1)) {
        return "Informe o máximo de resgates ou desative o limite total.";
      }
      const couponValidUntil = limitRedeemUntil
        ? combineRedeemUntil(redeemUntilDate, redeemUntilTime)
        : null;
      if (couponValidUntil) {
        if (draft.createPublicCode !== false) {
          const mainPromoExpires = mainPromoBlock.promoValidityEnabled
            ? combineRedeemUntil(mainPromoBlock.promoExpiresDate, mainPromoBlock.promoExpiresTime)
            : null;
          const mainExpiryErr = validatePromoExpiresWithinCouponRedeemBy(
            mainPromoExpires,
            couponValidUntil,
            "código principal",
          );
          if (mainExpiryErr) return mainExpiryErr;
          for (let i = 0; i < extraPromoBlocks.length; i++) {
            const block = extraPromoBlocks[i];
            const promoExpires = block.promoValidityEnabled
              ? combineRedeemUntil(block.promoExpiresDate, block.promoExpiresTime)
              : null;
            const err = validatePromoExpiresWithinCouponRedeemBy(
              promoExpires,
              couponValidUntil,
              block.code.trim() || `código ${i + 2}`,
            );
            if (err) return err;
          }
        }
      }
    }
    return null;
  }, [
    draft,
    isEdit,
    mainPromoBlock,
    extraPromoBlocks,
    productRestrictionEnabled,
    limitRedeemUntil,
    redeemUntilDate,
    redeemUntilTime,
    limitMaxRedemptions,
  ]);

  const buildPayload = () => {
    const mainOpts = promoBlockToApiOptions(mainPromoBlock);
    return {
      ...draft,
      code: mainPromoBlock.code,
      firstTimeOnly: mainPromoBlock.firstTimeOnly,
      restrictedCustomerEmail: mainPromoBlock.restrictCustomer
        ? mainPromoBlock.restrictedCustomerEmail || null
        : null,
      minimumAmountCents: mainPromoBlock.minimumAmount ? mainPromoBlock.minimumAmountCents : null,
      minimumAmountCurrency: mainPromoBlock.minimumAmount ? mainPromoBlock.minimumAmountCurrency : null,
      promoMaxRedemptions: mainOpts.promoMaxRedemptions,
      promoExpiresAt: mainOpts.promoExpiresAt,
      validFrom: draft.validFrom || null,
      validUntil: limitRedeemUntil ? combineRedeemUntil(redeemUntilDate, redeemUntilTime) : null,
      maxRedemptionsTotal: limitMaxRedemptions ? draft.maxRedemptionsTotal : null,
      extraCodes: extraPromoBlocks.map((b) => b.code).filter((c) => c.trim().length > 0),
      extraPromoConfigs: extraPromoBlocks.map(promoBlockToApiOptions),
    };
  };

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
          No Stripe, só o nome pode ser alterado após a criação. Aqui você também pode editar status, limite por
          e-mail, parceiro e descrição interna.
        </p>
      ) : null}

      <Field label="Status" className="mb-4">
        <Toggle
          id="coupon-active"
          checked={draft.active !== false}
          onChange={(v) => setDraft((d) => ({ ...d, active: v }))}
          label="Cupom ativo"
        />
      </Field>

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

              <StripeProductPicker
                products={stripeProducts}
                selectedIds={draft.stripeProductIds ?? []}
                onChange={(ids) => setDraft((d) => ({ ...d, stripeProductIds: ids }))}
                onEnabledChange={setProductRestrictionEnabled}
                loading={loadingProducts}
                error={productsError}
                onRetry={() => void loadStripeProducts()}
                onRequestLoad={() => void loadStripeProducts()}
              />
              {productRestrictionEnabled ? (
                <p className="sm:col-span-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-200">
                  Se este cupom for usado na página de vendas, selecione o Product Stripe do plano
                  correspondente. Cupons restritos apenas a add-ons ou produtos diferentes serão
                  recusados pelo Stripe no checkout.
                </p>
              ) : null}

              <Field label="Duração" className="sm:col-span-2">
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

              <div className="space-y-5 border-t border-line pt-5 sm:col-span-2">
                <h3 className="text-sm font-semibold text-content">Limites de resgate</h3>

                <OptionalCheckbox
                  id="limit-redeem-until"
                  className="sm:col-span-2"
                  label="Limitar o período em que os clientes podem resgatar o cupom"
                  checked={limitRedeemUntil}
                  onChange={(v) => {
                    setLimitRedeemUntil(v);
                    if (!v) {
                      setRedeemUntilDate("");
                      setRedeemUntilTime("23:59");
                      setDraft((d) => ({ ...d, validUntil: null }));
                    }
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-content-muted">Resgatar até</span>
                    <Input
                      type="date"
                      className="w-auto min-w-[10.5rem]"
                      value={redeemUntilDate}
                      onChange={(e) => {
                        const date = e.target.value;
                        setRedeemUntilDate(date);
                        setDraft((d) => ({
                          ...d,
                          validUntil: combineRedeemUntil(date, redeemUntilTime),
                        }));
                      }}
                    />
                    <Input
                      type="time"
                      className="w-auto min-w-[7rem]"
                      value={redeemUntilTime}
                      onChange={(e) => {
                        const time = e.target.value;
                        setRedeemUntilTime(time);
                        setDraft((d) => ({
                          ...d,
                          validUntil: combineRedeemUntil(redeemUntilDate, time),
                        }));
                      }}
                    />
                    <span className="text-xs font-medium text-content-faint">BRT</span>
                  </div>
                </OptionalCheckbox>

                <OptionalCheckbox
                  id="limit-max-redemptions"
                  className="sm:col-span-2"
                  label="Limitar o total de vezes que o cupom pode ser resgatado"
                  checked={limitMaxRedemptions}
                  onChange={(v) => {
                    setLimitMaxRedemptions(v);
                    if (!v) setDraft((d) => ({ ...d, maxRedemptionsTotal: null }));
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      className="w-24"
                      value={draft.maxRedemptionsTotal ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          maxRedemptionsTotal: e.target.value === "" ? null : parseInt(e.target.value, 10),
                        }))
                      }
                    />
                    <span className="text-sm text-content-muted">
                      {(draft.maxRedemptionsTotal ?? 1) === 1 ? "vez" : "vezes"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-content-faint">
                    Este limite se aplica a diversos clientes, ou seja, não impede um único cliente de resgatar
                    várias vezes.
                  </p>
                </OptionalCheckbox>
              </div>
            </StripeSection>

            <div className="border-t border-line pt-5">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-content">Códigos</h3>
                <StripeInlineToggle
                  id="create-public-code"
                  checked={draft.createPublicCode === true}
                  onChange={(v) => setDraft((d) => ({ ...d, createPublicCode: v }))}
                  label="Usar códigos de cupons visíveis para o cliente"
                />

                {draft.createPublicCode === true ? (
                  <div className="space-y-3">
                    <PromoCodeBlockEditor
                      block={mainPromoBlock}
                      idPrefix="main-promo"
                      onChange={(patch) => setMainPromoBlock((b) => ({ ...b, ...patch }))}
                    />

                    {extraPromoBlocks.map((block, i) => (
                      <PromoCodeBlockEditor
                        key={i}
                        block={block}
                        idPrefix={`extra-promo-${i}`}
                        onChange={(patch) =>
                          setExtraPromoBlocks((prev) =>
                            prev.map((b, j) => (j === i ? { ...b, ...patch } : b)),
                          )
                        }
                        onRemove={() =>
                          setExtraPromoBlocks((prev) => prev.filter((_, j) => j !== i))
                        }
                      />
                    ))}

                    {extraPromoBlocks.length < 5 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExtraPromoBlocks((prev) => [...prev, emptyPromoCodeBlock()])
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-surface-elevated/50"
                      >
                        <span className="text-base leading-none">+</span>
                        Adicionar outro código
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <StripeSection title="Informações do cupom">
            <Field label="Nome" hint="Único campo editável no Stripe após a criação." className="sm:col-span-2">
              <Input
                value={draft.internalName ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, internalName: e.target.value }))}
              />
            </Field>
          </StripeSection>
        )}

        <section className="space-y-4 border-b border-line pb-5 last:border-b-0">
          <StripeInlineToggle
            id="mychatcrm-settings"
            checked={mychatcrmOpen}
            onChange={(on) => {
              setMychatcrmOpen(on);
              if (!on) {
                setDraft((d) => ({
                  ...d,
                  maxRedemptionsPerUser: null,
                  partnerId: null,
                  description: "",
                }));
              }
            }}
            label="Configurações MyChatCRM"
          />
          {mychatcrmOpen ? (
            <div className="space-y-4">
              <p className="text-xs text-content-muted">
                Campos internos do sistema — restrição de produtos fica no bloco Stripe acima.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
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
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}
