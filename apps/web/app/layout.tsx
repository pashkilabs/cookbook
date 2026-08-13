import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pashki Recipes",
  description: "Capture recipes from anywhere, plan a week, shop once.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
