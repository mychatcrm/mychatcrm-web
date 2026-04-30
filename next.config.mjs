import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */

const isProdBuild = process.env.NODE_ENV === "production";
const enableHsts =
  process.env.VERCEL_ENV === "production" || process.env.ENABLE_HSTS === "1";
const hstsPreload = process.env.HSTS_PRELOAD === "1";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const hstsValue = hstsPreload
  ? "max-age=63072000; includeSubDomains; preload"
  : "max-age=63072000; includeSubDomains";

const nextConfig = {
  /** Expõe no cliente só o facto de o build ter corrido na Vercel (sem segredos). */
  env: {
    NEXT_PUBLIC_VERCEL_BUILT: process.env.VERCEL === "1" ? "1" : "",
  },
  poweredByHeader: false,
  compress: true,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  compiler: {
    removeConsole:
      isProdBuild && process.env.KEEP_CONSOLE !== "1"
        ? { exclude: ["error", "warn"] }
        : false,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.pravatar.cc",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    const base = [...securityHeaders];
    if (isProdBuild && enableHsts) {
      base.push({ key: "Strict-Transport-Security", value: hstsValue });
    }
    if (process.env.CSP_UPGRADE_INSECURE_REQUESTS === "1") {
      base.push({ key: "Content-Security-Policy", value: "upgrade-insecure-requests" });
    }
    return [{ source: "/:path*", headers: base }];
  },
};

export default withNextIntl(nextConfig);
