import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Cabin, Open_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// next/font self-hosts at build time: the woff2 is preloaded, no font CSS in
// the render-blocking bundle, and size-adjusted fallbacks avoid layout shift.
// Components reach these through --font-head / --font-body / --font-mono
// (defined in globals.css from these variables).
const cabin = Cabin({ subsets: ["latin"], variable: "--font-cabin", display: "swap" });
const openSans = Open_Sans({ subsets: ["latin"], variable: "--font-open-sans", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Orr Recruiting",
  description: "Orr Fellowship recruiting workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cabin.variable} ${openSans.variable} ${jetbrainsMono.variable}`}>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
