import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Cabin:wght@400;500;600;700&family=Open+Sans:wght@300;400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
