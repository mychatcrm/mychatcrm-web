"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Toggle } from "@/components/ui/Toggle";
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

function SelectedProductRow({
  product,
  onRemove,
}: {
  product: StripeProductOption;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-elevated/60">
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
      <button
        type="button"
        onClick={onRemove}
        className="rounded-md px-2 py-1 text-xs text-content-muted transition-colors hover:bg-surface-elevated hover:text-content"
        aria-label={`Remover ${product.name}`}
      >
        Remover
      </button>
    </div>
  );
}

function ProductSearchRow({
  products,
  excludedIds,
  onSelect,
  autoFocus,
}: {
  products: StripeProductOption[];
  excludedIds: string[];
  onSelect: (productId: string) => void;
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

  return (
    <div ref={rootRef} className="relative">
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
      {open && filtered.length > 0 ? (
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
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-elevated/60">
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
      ) : null}
      {open && filtered.length === 0 ? (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-surface-card px-3 py-2 text-sm text-content-muted shadow-lg">
          Nenhum produto encontrado.
        </div>
      ) : null}
    </div>
  );
}

type StripeProductPickerProps = {
  products: StripeProductOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRequestLoad?: () => void;
};

export function StripeProductPicker({
  products,
  selectedIds,
  onChange,
  loading,
  error,
  onRetry,
  onRequestLoad,
}: StripeProductPickerProps) {
  const [enabled, setEnabled] = useState(selectedIds.length > 0);
  const [searchSlots, setSearchSlots] = useState(1);

  useEffect(() => {
    setEnabled(selectedIds.length > 0);
  }, [selectedIds.length]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const selectedProducts = selectedIds
    .map((id) => productById.get(id))
    .filter((p): p is StripeProductOption => Boolean(p));

  const handleToggle = (on: boolean) => {
    setEnabled(on);
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

  return (
    <div className="sm:col-span-2">
      <Toggle
        id="limit-stripe-products"
        checked={enabled}
        onChange={handleToggle}
        label="Aplicar a produtos específicos"
      />

      {enabled ? (
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="text-sm text-content-muted">Carregando produtos do Stripe…</p>
          ) : error ? (
            <div className="space-y-2">
              <p className="text-sm text-rose-400">{error}</p>
              {onRetry ? (
                <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                  Tentar novamente
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              {selectedProducts.length > 0 ? (
                <div className="rounded-lg border border-line px-3">
                  {selectedProducts.map((product) => (
                    <SelectedProductRow
                      key={product.id}
                      product={product}
                      onRemove={() => removeProduct(product.id)}
                    />
                  ))}
                </div>
              ) : null}

              <div className="space-y-2">
                {Array.from({ length: searchSlots }, (_, i) => (
                  <ProductSearchRow
                    key={i}
                    products={products}
                    excludedIds={selectedIds}
                    autoFocus={i === searchSlots - 1 && selectedProducts.length === 0}
                    onSelect={(id) => {
                      addProduct(id);
                      if (i === searchSlots - 1) setSearchSlots((n) => n + 1);
                    }}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() => setSearchSlots((n) => n + 1)}
                className="text-sm font-medium text-primary hover:underline"
              >
                Adicionar outro produto
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
