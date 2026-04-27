const icons = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  mic: (
    <>
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M8 11v1a4 4 0 0 0 8 0v-1M12 18v3M10 21h4" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.8 5.5h5.7l-4.6 3.3 1.8 5.5-4.7-3.4-4.7 3.4 1.8-5.5-4.6-3.3h5.7L12 3Z" />
    </>
  ),
  plug: (
    <>
      <path d="M6 9h12v6a4 4 0 0 1-8 0V9" />
      <path d="M10 5v4M14 5v4M9 21h6" />
    </>
  ),
  funnel: (
    <>
      <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />
    </>
  ),
  grid: (
    <>
      <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" />
    </>
  ),
} as const;

export function FeatureIcon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      className="h-7 w-7 text-primary"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {icons[name]}
    </svg>
  );
}
