import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Government Concierge — Service NSW Assistant",
  description:
    "An elegant, retrieval-grounded assistant for Service NSW (New South Wales, Australia) — licences, registrations, fines, and other public services.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased font-sans">{children}</body>
    </html>
  );
}
