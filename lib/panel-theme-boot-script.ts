/** Mesma chave que `components/panel/PanelAppearance.tsx`. */
export const PANEL_APPEARANCE_STORAGE_KEY = "mychatcrm-panel-appearance";

/** Alinhado à variável CSS `--color-surface-base` do tema claro do painel. */
export const PANEL_LIGHT_CHROME_BG = "rgb(238 242 248)";

/** DS dark mode background — zinc pure black (#000000). */
export const PANEL_HTML_DARK_BG = "#000000";

export type PanelChromeTheme = "light" | "dark";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

/** Persiste o tema para o próximo SSR (evita flash claro/escuro ao atualizar). Só no browser. */
export function persistPanelThemeCookie(mode: PanelChromeTheme): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${PANEL_APPEARANCE_STORAGE_KEY}=${mode};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

/**
 * Rotas de marketing / auth fora do painel: repõe o chrome do `app/layout.tsx` e `:root` em `globals.css`,
 * removendo estilos inline deixados por `applyPanelChromeTheme` após visitar o dashboard (evita cores erradas).
 */
export function resetMarketingChromeTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.backgroundColor = PANEL_HTML_DARK_BG;
  document.documentElement.style.colorScheme = "dark";
  if (document.body) {
    document.body.style.backgroundColor = "";
    document.body.style.colorScheme = "dark";
  }
}

export function applyPanelChromeTheme(mode: PanelChromeTheme): void {
  if (typeof document === "undefined") return;
  if (mode === "light") {
    const c = PANEL_LIGHT_CHROME_BG;
    document.documentElement.style.backgroundColor = c;
    document.documentElement.style.colorScheme = "light";
    if (document.body) {
      document.body.style.backgroundColor = c;
      document.body.style.colorScheme = "light";
    }
  } else {
    document.documentElement.style.backgroundColor = PANEL_HTML_DARK_BG;
    document.documentElement.style.colorScheme = "dark";
    if (document.body) {
      document.body.style.backgroundColor = "";
      document.body.style.colorScheme = "dark";
    }
  }
}

/** Minificado: cookie (igual ao SSR) > localStorage; alinha html/body antes da hidratação. */
export const PANEL_THEME_BOOT_SCRIPT = `(function(){try{var k="${PANEL_APPEARANCE_STORAGE_KEY}";function gc(n){var p=("; "+document.cookie).split("; "+n+"=");if(p.length<2)return null;return (p.pop()||"").split(";").shift()||null;}var c=gc(k);var ls=null;try{ls=localStorage.getItem(k);}catch(e){}var t=(c==="light"||c==="dark")?c:((ls==="light"||ls==="dark")?ls:null);if(t==="light"){var bg="${PANEL_LIGHT_CHROME_BG}";document.documentElement.style.backgroundColor=bg;document.documentElement.style.colorScheme="light";var b=document.body;if(b){b.style.backgroundColor=bg;b.style.colorScheme="light";}}else if(t==="dark"){var d="${PANEL_HTML_DARK_BG}";document.documentElement.style.backgroundColor=d;document.documentElement.style.colorScheme="dark";var e=document.body;if(e){e.style.backgroundColor="";e.style.colorScheme="dark";}}}catch(x){}})();`;
