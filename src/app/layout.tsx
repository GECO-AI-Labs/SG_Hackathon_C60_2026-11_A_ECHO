import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader, Schibsted_Grotesk } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Newsreader: headlines (a serif made for news). Schibsted Grotesk: interface text
// (from a newsroom type family). IBM Plex Mono: numbers, labels, metadata.
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"] });
const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "ECHO", template: "%s · ECHO" },
  description: "Every Content Hits Objectives: LinkedIn content and insights desk.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${schibsted.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="paper min-h-full">
        {children}
        <Toaster position="bottom-right" theme="light" />
      </body>
    </html>
  );
}
