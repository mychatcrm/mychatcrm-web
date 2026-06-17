"use client";

import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import {
  currencySymbol,
  formatStripeCurrencyLabel,
  getCurrencyDecimals,
  inputValueToMinorUnits,
  minorUnitsToInputValue,
  normalizeStripeCurrency,
  sortedStripeCurrencyCodes,
} from "@/lib/commercial/stripe-currencies";

type MinimumAmountFieldsProps = {
  currency: string;
  cents: number | null;
  onCurrencyChange: (currency: string) => void;
  onCentsChange: (cents: number | null) => void;
};

export function MinimumAmountFields({
  currency,
  cents,
  onCurrencyChange,
  onCentsChange,
}: MinimumAmountFieldsProps) {
  const normalized = normalizeStripeCurrency(currency);
  const symbol = currencySymbol(normalized);
  const decimals = getCurrencyDecimals(normalized);
  const step = decimals === 0 ? "1" : decimals === 3 ? "0.001" : "0.01";

  return (
    <div className="flex max-w-lg flex-wrap items-center gap-2">
      <Select
        className="min-w-[12rem] flex-1"
        value={normalized}
        onChange={(e) => onCurrencyChange(e.target.value)}
      >
        {sortedStripeCurrencyCodes().map((code) => (
          <option key={code} value={code}>
            {formatStripeCurrencyLabel(code)}
          </option>
        ))}
      </Select>
      <div className="relative min-w-[8rem] flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-content-muted">
          {symbol}
        </span>
        <Input
          type="number"
          className="pl-10"
          min={0}
          step={step}
          value={minorUnitsToInputValue(cents, normalized)}
          onChange={(e) => onCentsChange(inputValueToMinorUnits(e.target.value, normalized))}
        />
      </div>
    </div>
  );
}
