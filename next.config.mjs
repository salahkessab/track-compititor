/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.RECIPE_INTELLIGENCE_BUILD === "1" ? ".local-next" : ".next",
  typescript: { tsconfigPath: process.env.RECIPE_INTELLIGENCE_BUILD === "1" ? "tsconfig.local.json" : "tsconfig.json" },
  serverExternalPackages: ["better-sqlite3"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.fal.media" },
      { protocol: "https", hostname: "**.fal.ai" },
    ],
  },
};
export default nextConfig;
