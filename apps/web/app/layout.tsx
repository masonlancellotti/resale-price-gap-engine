import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { NavBar } from "./components/NavBar";
import { Ticker } from "./components/Ticker";

export const metadata: Metadata = {
  title: "FLIP DESK",
  description: "Secondhand-marketplace arbitrage terminal",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0a0e12",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Ticker />
          <NavBar />
          <main>{children}</main>
        </div>
        <CommandPalette />
      </body>
    </html>
  );
}
