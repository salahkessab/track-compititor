import "./globals.css";
import "@fontsource-variable/fraunces/wght.css";
import "@fontsource-variable/rokkitt/wght.css";
import "@fontsource-variable/archivo-narrow/wght.css";
import "@fontsource/special-elite/index.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Recipe Studio",
  description: "Your workspace for recipe designs, images, articles and publishing.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F9FAFB",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('studio-theme')==='dark'?'dark':'light'}catch(e){}" }} /></head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
