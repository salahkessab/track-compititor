/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.RECIPE_INTELLIGENCE_BUILD === "1" ? ".local-next" : ".next",
  typescript: { tsconfigPath: process.env.RECIPE_INTELLIGENCE_BUILD === "1" ? "tsconfig.local.json" : "tsconfig.json" },
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/api/recipe-capture-extension": ["./extensions/recipe-intelligence-capture/**/*"],
    "/api/recipe-wordpress-plugin": ["./wordpress/recipe-intelligence-bridge/*.php"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.fal.media" },
      { protocol: "https", hostname: "**.fal.ai" },
    ],
  },
};
export default nextConfig;
