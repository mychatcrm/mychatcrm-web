import { cookies } from "next/headers";
import { PANEL_APPEARANCE_STORAGE_KEY } from "@/lib/panel-theme-boot-script";

/** Só em Server Components — lê o cookie gravado em conjunto com `localStorage` no painel. */
export function getPanelAppearanceFromCookies(): "light" | "dark" | undefined {
  const value = cookies().get(PANEL_APPEARANCE_STORAGE_KEY)?.value;
  if (value === "light" || value === "dark") return value;
  return undefined;
}
