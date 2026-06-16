"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { cn } from "@/lib/utils";

export type StripeProductOption = {
  id: string;
  name: string;
  active: boolean;
  priceLabel: string | null;
};

function ProductIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-content-muted"
      aria-hidden
    >
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function StripeInlineToggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          checked ? "border-primary/40 bg-primary" : "border-line/80 bg-surface-deep",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
            checked ? "translate-x-[22px]" : "translate-x-[2px]",
          )}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer text-sm font-medium text-content">
        {label}
      </label>
    </div>
  );
}

function RowMenu({
  items,
  ariaLabel,
}: {
  items: { label: string; onClick: () => void; destructive?: boolean }[];
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-surface-elevated hover:text-content"
      >
        <span className="text-lg leading-none tracking-widest">⋯</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-line bg-surface-card py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={cn(
                "block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-elevated/70",
                item.destructive ? "text-rose-500" : "text-content",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SelectedProductRow({
  product,
  onRemove,
}: {
  product: StripeProductOption;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center">
        <ProductIcon />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-content">{product.name}</p>
        {product.priceLabel ? (
          <p className="text-xs text-content-muted">{product.priceLabel}</p>
        ) : (
          <p className="font-mono text-xs text-content-faint">{product.id}</p>
        )}
      </div>
      <RowMenu
        ariaLabel={`Opções para ${product.name}`}
        items={[{ label: "Remover", onClick: onRemove, destructive: true }]}
      />
    </div>
  );
}

function ProductSearchRow({
  products,
  excludedIds,
  onSelect,
  onRemoveRow,
  canRemoveRow,
  autoFocus,
}: {
  products: StripeProductOption[];
  excludedIds: string[];
  onSelect: (productId: string) => void;
  onRemoveRow?: () => void;
  canRemoveRow?: boolean;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const available = useMemo(
    () => products.filter((p) => !excludedIds.includes(p.id)),
    [products, excludedIds],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    );
  }, [available, query]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const menuItems = canRemoveRow && onRemoveRow
    ? [{ label: "Remover linha", onClick: onRemoveRow, destructive: true as const }]
    : [];

  return (
    <div ref={rootRef} className="relative py-3.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            value={query}
            autoFocus={autoFocus}
            placeholder="Encontre um produto…"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            aria-expanded={open}
            aria-controls={listId}
            role="combobox"
          />
          {open ? (
            filtered.length > 0 ? (
              <ul
                id={listId}
                role="listbox"
                className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-line bg-surface-card py-1 shadow-lg"
              >
                {filtered.map((product) => (
                  <li key={product.id} role="option">
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-elevated/70"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onSelect(product.id);
                        setQuery("");
                        setOpen(false);
                      }}
                    >
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
                        <ProductIcon />
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-content">{product.name}</span>
                        <span className="block text-xs text-content-muted">
                          {product.priceLabel ?? product.id}
                          {!product.active ? " · inativo" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-content-muted shadow-lg">
                Nenhum produto encontrado.
              </div>
            )
          ) : null}
        </div>
        {menuItems.length > 0 ? (
          <RowMenu ariaLabel="Opções da linha de busca" items={menuItems} />
        ) : (
          <div className="h-9 w-9 shrink-0" aria-hidden />
        )}
      </div>
    </div>
  );
}

type StripeProductPickerProps = {
  products: StripeProductOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onEnabledChange?: (enabled: boolean) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRequestLoad?: () => void;
};

export function StripeProductPicker({
  products,
  selectedIds,
  onChange,
  onEnabledChange,
  loading,
  error,
  onRetry,
  onRequestLoad,
}: StripeProductPickerProps) {
  const [enabled, setEnabled] = useState(selectedIds.length > 0);
  const [searchSlots, setSearchSlots] = useState(1);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const selectedProducts = selectedIds
    .map((id) => productById.get(id))
    .filter((p): p is StripeProductOption => Boolean(p));

  const setEnabledState = (on: boolean) => {
    setEnabled(on);
    onEnabledChange?.(on);
  };

  const handleToggle = (on: boolean) => {
    setEnabledState(on);
    if (on) {
      onRequestLoad?.();
      setSearchSlots(1);
    } else {
      onChange([]);
      setSearchSlots(1);
    }
  };

  const addProduct = (productId: string) => {
    if (selectedIds.includes(productId)) return;
    onChange([...selectedIds, productId]);
  };

  const removeProduct = (productId: string) => {
    onChange(selectedIds.filter((id) => id !== productId));
  };

  const removeSearchRow = () => {
    setSearchSlots((n) => Math.max(1, n - 1));
  };

  const showBody = enabled && !loading && !error;
  const showLoadingOrError = enabled && (loading || error);

  return (
    <div className="sm:col-span-2">
      <div className={cn(showBody || showLoadingOrError ? "border-b border-line pb-3.5" : undefined)}>
        <StripeInlineToggle
          id="limit-stripe-products"
          checked={enabled}
          onChange={handleToggle}
          label="Aplicar a produtos específicos"
        />
      </div>

      {showLoadingOrError ? (
        <div className="pt-3.5">
          {loading ? (
            <p className="text-sm text-content-muted">Carregando produtos do Stripe…</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-rose-400">{error}</p>
              {onRetry ? (
                <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                  Tentar novamente
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {showBody ? (
        <div>
          <div className="divide-y divide-line">
            {selectedProducts.map((product) => (
              <SelectedProductRow
                key={product.id}
                product={product}
                onRemove={() => removeProduct(product.id)}
              />
            ))}
            {Array.from({ length: searchSlots }, (_, i) => (
              <ProductSearchRow
                key={`search-${i}`}
                products={products}
                excludedIds={selectedIds}
                autoFocus={i === 0 && selectedProducts.length === 0}
                canRemoveRow={searchSlots > 1}
                onRemoveRow={removeSearchRow}
                onSelect={(id) => addProduct(id)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSearchSlots((n) => n + 1)}
            className="mt-3 text-sm font-medium text-primary hover:underline"
          >
            Adicionar outro produto
          </button>
        </div>
      ) : null}
    </div>
  );
}
