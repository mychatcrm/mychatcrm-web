# Branding Rules (Public Pages)

These rules apply only to localized public pages under `app/[locale]/`:

- Home/Landing
- Plans
- Blog and blog articles
- Login
- Legal pages
- Maintenance page

Do **not** apply these rules to `app/dashboard` or `app/admin`.

## Font System

- **Display titles**: Manrope SemiBold (`public/fonts/Manrope-SemiBold.otf`)
- **Body/subtitles/supporting text**: Manrope family (`next/font/google`)

Configured in:

- `app/[locale]/layout.tsx`
- `app/globals.css` (`.brand-marketing`)

## Type Scale (Desktop targets)

- Title: `100 / 120`
- Subtitle: `40 / 45`
- Body: `24 / 28`
- Footer/support text: `16 / 20`

Responsive behavior is handled with `clamp(...)` variables in `.brand-marketing`:

- `--brand-title-size`, `--brand-title-line`
- `--brand-subtitle-size`, `--brand-subtitle-line`
- `--brand-body-size`, `--brand-body-line`
- `--brand-footer-size`, `--brand-footer-line`

## Implementation Rule for Future Changes

When creating or updating public pages/components:

1. Keep content inside the `app/[locale]/` scope.
2. Use semantic tags (`h1`, `h2`, `h3`, `p`, `footer`) so the global type system applies automatically.
3. Keep display headings with `.font-display` when explicit heading styling is required.
4. Avoid hardcoding per-component font families/sizes unless there is a justified exception.
5. If an exception is required, document it in the PR or commit description.
