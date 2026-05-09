import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Service NSW Chatbot (demo)",
  description:
    "A trustworthy, retrieval-grounded assistant over public Service NSW pages.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
