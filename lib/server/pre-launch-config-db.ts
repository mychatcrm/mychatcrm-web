import "server-only";

import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** Tag usada pelo PATCH de /api/admin/platform-launch-config pra invalidar na hora. */
export const PRE_LAUNCH_POPUP_CACHE_TAG = "pre-launch-popup-config";

async function readPreLaunchPopupEnabled(): Promise<boolean> {
  try {
    const sb = createSupabaseServiceClient();
    const { data, error } = await sb
      .from("platform_launch_config")
      .select("pre_launch_popup_enabled")
      .eq("id", "global")
      .maybeSingle();
    if (error) {
      console.warn("[pre-launch-config] read_failed", error.message);
      return true;
    }
    return data ? data.pre_launch_popup_enabled !== false : true;
  } catch (e) {
    console.warn("[pre-launch-config] read_failed", e instanceof Error ? e.message : e);
    return true;
  }
}

// `app/[locale]/layout.tsx` é estático (generateStaticParams) — sem cache
// com tempo de revalidação, essa leitura rodaria só uma vez no build, e
// desligar o popup pelo admin não teria efeito sem um novo deploy. Cache de
// 30s (mesmo tradeoff já documentado pro flag de manutenção) + tag pra
// invalidar na hora quando o PATCH do admin acontece.
const cachedRead = unstable_cache(readPreLaunchPopupEnabled, ["pre-launch-popup-enabled"], {
  revalidate: 30,
  tags: [PRE_LAUNCH_POPUP_CACHE_TAG],
});

/**
 * Flag único do popup de pré-lançamento. Lido direto do Supabase (nunca por
 * API pública) nos dois layouts server-side que decidem o que montar —
 * `app/[locale]/layout.tsx` (o popup em si) e `app/layout.tsx` (suprime o
 * ChatWidget flutuante, que também tem atalho de WhatsApp próprio).
 *
 * Falha aberta em caso de erro de leitura (mostra o popup) — mais seguro
 * do que arriscar deixar passar contato sem querer se o banco falhar.
 */
export async function isPreLaunchPopupEnabled(): Promise<boolean> {
  return cachedRead();
}
