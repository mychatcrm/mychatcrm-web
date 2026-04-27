/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || "https://mychatcrm.com.br",
  generateRobotsTxt: true,
  exclude: ["/dashboard", "/dashboard/*", "/admin", "/admin/*", "/checkout/*", "/login"],
  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/admin"],
      },
    ],
  },
};
