import "./globals.css";
import "@fontsource-variable/fraunces/wght.css";
import "@fontsource-variable/rokkitt/wght.css";
import "@fontsource-variable/archivo-narrow/wght.css";
import "@fontsource/special-elite/index.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Horse Image Generator",
  description: "Generate beautiful horse scenes with AI",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F9FAFB",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
