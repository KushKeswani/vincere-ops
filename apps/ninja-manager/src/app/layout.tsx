import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Vincere Ninja Manager", template: "%s | Ninja Manager" },
  description: "A safer operations control center for Vincere clients and staff.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
