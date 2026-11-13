import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { Masthead } from "@/components/masthead";
import { RateFooter } from "@/components/rate-footer";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });
const display = Newsreader({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-newsreader", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Standings · github-ranking", template: "%s · github-ranking" },
  description: "Evidence-based assessment and ranking of GitHub engineers and teams. Every person is scored on their own work alone.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0b" },
  ],
};

/** Applies the stored theme before first paint so there is no flash. */
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Masthead />
        <main>{children}</main>
        <RateFooter />
      </body>
    </html>
  );
}
