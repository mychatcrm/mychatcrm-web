"use client";

/** Dígitos internacionais (55…) para URLs do WhatsApp. */
export function phoneDigitsInternational(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return `55${digits}`;
}

export function phoneToWhatsAppWebHref(phone: string): string {
  const n = phoneDigitsInternational(phone);
  if (!n) return "https://web.whatsapp.com/";
  return `https://web.whatsapp.com/send?phone=${encodeURIComponent(n)}`;
}

const WHATSAPP_BRAND_GREEN = "#25D366";
const WHATSAPP_BRAND_TEAL = "#128C7E";

/** Silhueta oficial do WhatsApp (mesmo path que `WhatsAppGlyph`), para marcas a cor fixa. */
const WHATSAPP_BUBBLE_PATH =
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.883 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z";

export function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={20} height={20} aria-hidden>
      <path fill="currentColor" d={WHATSAPP_BUBBLE_PATH} />
    </svg>
  );
}

/**
 * Ícone compacto “QR + WhatsApp” (vector): grelha verde simplificada, bolha da marca no centro — não é bitmap.
 * Cores oficiais aproximadas (#25D366 / #128C7E).
 */
export function WhatsAppQrMark({ className }: { className?: string }) {
  const g = WHATSAPP_BRAND_GREEN;
  const r = 0.22;
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="5.5" fill="#fff" />
      <rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="none" stroke={WHATSAPP_BRAND_TEAL} strokeOpacity={0.22} strokeWidth="0.6" />
      <path fill={g} fillRule="evenodd" d="M2.35 2.35h6.8v6.8H2.35Zm1.05 1.05h4.7v4.7H3.4V3.4Z" />
      <rect x="5.45" y="5.45" width="1.55" height="1.55" rx={r} fill="#fff" />
      <path fill={g} fillRule="evenodd" d="M14.85 2.35h6.8v6.8h-6.8Zm1.05 1.05h4.7v4.7h-4.7V3.4Z" />
      <rect x="18.0" y="5.45" width="1.55" height="1.55" rx={r} fill="#fff" />
      <path fill={g} fillRule="evenodd" d="M2.35 14.85h6.8v6.8H2.35Zm1.05 1.05h4.7v4.7H3.4v-4.7Z" />
      <rect x="5.45" y="18.0" width="1.55" height="1.55" rx={r} fill="#fff" />
      <rect x="10.4" y="2.55" width="1.35" height="1.35" rx={r} fill={g} />
      <rect x="12.35" y="3.05" width="1.35" height="1.35" rx={r} fill={g} />
      <rect x="10.9" y="9.1" width="1.25" height="1.25" rx={r} fill={g} />
      <rect x="16.2" y="9.35" width="1.25" height="1.25" rx={r} fill={g} />
      <rect x="18.85" y="10.1" width="1.25" height="1.25" rx={r} fill={g} />
      <rect x="9.15" y="16.25" width="1.25" height="1.25" rx={r} fill={g} />
      <rect x="2.55" y="10.35" width="1.25" height="1.25" rx={r} fill={g} />
      <rect x="18.85" y="16.4" width="1.25" height="1.25" rx={r} fill={g} />
      <circle cx="12" cy="12" r="5.15" fill="#fff" stroke={g} strokeOpacity={0.35} strokeWidth="0.45" />
      <g transform="translate(12 12) scale(0.195) translate(-12 -12)">
        <path fill={g} d={WHATSAPP_BUBBLE_PATH} />
      </g>
    </svg>
  );
}
