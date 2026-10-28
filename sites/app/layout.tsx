import type { Metadata } from "next";
import "./globals.css";
import "@/styles/bank-connection.css";

export const metadata: Metadata = {
  title: "MG Fakturakoll – betalningar & fakturor",
  description: "Privat fakturaöversikt för M.George Vitvaror AB. Följ kundbetalningar, fakturor att betala och bankavstämning.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv">
      <body className="antialiased">{children}</body>
    </html>
  );
}
