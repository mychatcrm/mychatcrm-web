/**
 * Dicas opcionais para o formulário de login (sem senhas no bundle).
 * Contas demo no servidor: `lib/client-auth.ts` quando `ALLOW_DEMO_PASSWORD_AUTH=1`.
 */
export const CLIENT_DEMO_EMAIL =
  process.env.NEXT_PUBLIC_DEMO_CLIENT_EMAIL?.trim() || "lagaresone@gmail.com";
/** Nome exibido no rodapé da sidebar do painel do cliente. */
export const CLIENT_DEMO_DISPLAY_NAME = "Renato Lagares";
/** Slug do plano comercial mais alto — libera todos os módulos na demo. */
export const CLIENT_DEMO_PLAN_SLUG = "enterprise" as const;
