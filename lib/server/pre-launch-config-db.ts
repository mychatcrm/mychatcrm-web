import "server-only";

import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Modo lista de espera.
 *
 * Enquanto ligado, quem escolhe um plano cai na página de lista de espera em
 * vez do checkout Stripe. A coluna no banco ainda se chama
 * `pre_launch_popup_enabled` porque nasceu para o popup que existia antes —
 * o significado mudou, o nome da coluna ficou para não migrar dados à toa.
 *
 * Para voltar ao checkout: toggle em /admin/leads-lancamento, ou
 * PATCH /api/admin/platform-launch-config {"enabled": false}.
 */

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

// A página de checkout é estática (generateStaticParams) — sem cache com
// tempo de revalidação, esta leitura rodaria só uma vez no build e desligar o
// modo pelo admin não teria efeito sem um novo deploy. Cache de 30s (mesmo
// tradeoff já documentado pro flag de manutenção) + tag para invalidar na
// hora quando o PATCH do admin acontece.
const cachedRead = unstable_cache(readPreLaunchPopupEnabled, ["pre-launch-popup-enabled"], {
  revalidate: 30,
  tags: [PRE_LAUNCH_POPUP_CACHE_TAG],
});

/**
 * Lido direto do Supabase (nunca por API pública) em
 * `app/[locale]/checkout/[planSlug]/page.tsx`, que escolhe entre a lista de
 * espera e o checkout.
 *
 * Falha fechada para o pagamento: se a leitura der erro, mostra a lista de
 * espera. Cobrar por um produto ainda em testes é pior do que atrasar uma
 * venda por um minuto.
 */
export async function isPreLaunchWaitlistEnabled(): Promise<boolean> {
  return cachedRead();
}
