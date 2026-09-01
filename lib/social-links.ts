/**
 * Links das redes sociais usados nos rodapés do site público (home e
 * blog). Placeholders até o Renato mandar os handles definitivos —
 * `grep -rn "TODO: link real do Renato"` acha os 5 de uma vez.
 *
 * WhatsApp não entra aqui: já tem número real via
 * `whatsappHandoffHref()` (`lib/whatsapp-handoff.ts`).
 */
export const SOCIAL_LINKS = {
  instagram: "https://instagram.com/mychatcrm", // TODO: link real do Renato
  tiktok: "https://tiktok.com/@mychatcrm", // TODO: link real do Renato
  youtube: "https://youtube.com/@mychatcrm", // TODO: link real do Renato
  x: "https://x.com/mychatcrm", // TODO: link real do Renato
  linkedin: "https://linkedin.com/company/mychatcrm", // TODO: link real do Renato
} as const;
