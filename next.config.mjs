/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.RECIPE_INTELLIGENCE_BUILD === "1" ? ".local-next" : ".next",
  typescript: { tsconfigPath: process.env.RECIPE_INTELLIGENCE_BUILD === "1" ? "tsconfig.local.json" : "tsconfig.json" },
  serverExternalPackages: ["better-sqlite3", "exiftool-vendored", "exiftool-vendored.exe", "exiftool-vendored.pl"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./config/image-metadata.config", "./node_modules/exiftool-vendored.exe/**/*", "./node_modules/exiftool-vendored.pl/**/*"],
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
