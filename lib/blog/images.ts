import type { BlogImageVariant, BlogPost } from "./types";

const variantCopy: Record<BlogImageVariant, { label: string; detail: string; accent: string }> = {
  hero: {
    label: "Plano de crescimento",
    detail: "Chatbot, CRM Kanban, automação, atendimento e conversão operando juntos",
    accent: "#f24400",
  },
  workflow: {
    label: "Fluxo de atendimento",
    detail: "Captação, qualificação, follow-up e passagem para humano",
    accent: "#ff7a1a",
  },
  dashboard: {
    label: "CRM Kanban inteligente",
    detail: "Pipeline, histórico, próximos passos e métricas de conversão",
    accent: "#22c55e",
  },
  card: {
    label: "Guia prático",
    detail: "Estratégia por nicho para vender mais no WhatsApp",
    accent: "#f24400",
  },
};

function escapeSvgText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clampText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export function buildBlogImageDataUri(post: Pick<BlogPost, "niche" | "title">, variant: BlogImageVariant) {
  const copy = variantCopy[variant];
  const title = escapeSvgText(clampText(post.niche, 34));
  const heading = escapeSvgText(clampText(post.title, 58));
  const detail = escapeSvgText(copy.detail);
  const label = escapeSvgText(copy.label);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="840" viewBox="0 0 1400 840" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#050505"/>
      <stop offset="48%" stop-color="#101014"/>
      <stop offset="100%" stop-color="#1c0900"/>
    </linearGradient>
    <radialGradient id="glow" cx="32%" cy="22%" r="70%">
      <stop offset="0%" stop-color="${copy.accent}" stop-opacity="0.42"/>
      <stop offset="55%" stop-color="${copy.accent}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="${copy.accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="22" stdDeviation="28" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <rect width="1400" height="840" rx="48" fill="url(#bg)"/>
  <rect width="1400" height="840" rx="48" fill="url(#glow)"/>
  <circle cx="1130" cy="130" r="210" fill="${copy.accent}" opacity="0.12"/>
  <circle cx="190" cy="710" r="260" fill="#ffffff" opacity="0.035"/>
  <g filter="url(#shadow)">
    <rect x="105" y="130" width="1190" height="580" rx="38" fill="#0f0f12" stroke="#2d2d32"/>
    <rect x="150" y="180" width="360" height="420" rx="28" fill="#17171b" stroke="#303037"/>
    <rect x="560" y="180" width="690" height="90" rx="24" fill="#18181c" stroke="#34343a"/>
    <rect x="560" y="305" width="205" height="255" rx="24" fill="#17171b" stroke="#33333a"/>
    <rect x="795" y="305" width="205" height="255" rx="24" fill="#17171b" stroke="#33333a"/>
    <rect x="1030" y="305" width="220" height="255" rx="24" fill="#17171b" stroke="#33333a"/>
    <rect x="585" y="595" width="665" height="64" rx="22" fill="#141417" stroke="#303037"/>
  </g>
  <text x="150" y="110" fill="#ffffff" opacity="0.72" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="700">${label}</text>
  <text x="150" y="245" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="54" font-weight="800">${title}</text>
  <text x="150" y="302" fill="#f7b39a" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="600">Estratégia de IA comercial</text>
  <text x="150" y="374" fill="#d6d6d6" font-family="Inter, Arial, sans-serif" font-size="23">${detail}</text>
  <text x="150" y="458" fill="#ffffff" opacity="0.78" font-family="Inter, Arial, sans-serif" font-size="22">${heading}</text>
  <g fill="${copy.accent}">
    <rect x="585" y="210" width="210" height="22" rx="11" opacity="0.95"/>
    <rect x="585" y="335" width="110" height="18" rx="9" opacity="0.9"/>
    <rect x="820" y="335" width="125" height="18" rx="9" opacity="0.85"/>
    <rect x="1055" y="335" width="140" height="18" rx="9" opacity="0.8"/>
  </g>
  <g fill="#ffffff" opacity="0.16">
    <rect x="585" y="238" width="520" height="12" rx="6"/>
    <rect x="585" y="378" width="145" height="12" rx="6"/>
    <rect x="585" y="410" width="120" height="12" rx="6"/>
    <rect x="820" y="378" width="135" height="12" rx="6"/>
    <rect x="820" y="410" width="100" height="12" rx="6"/>
    <rect x="1055" y="378" width="145" height="12" rx="6"/>
    <rect x="1055" y="410" width="118" height="12" rx="6"/>
    <rect x="615" y="618" width="410" height="14" rx="7"/>
  </g>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

