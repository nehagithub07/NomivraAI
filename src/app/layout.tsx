import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  title: {
    default: "NomviraAI",
    template: "%s · NomviraAI",
  },
  description:
    "The visual foundation for NomviraAI, your intelligent travel companion.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={GeistSans.variable}
    >
      <body>{children}</body>
    </html>
  );
}