import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Caveat } from "next/font/google";
import "./globals.css";
import { PWASetup } from "@/components/PWASetup";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { MotionProvider } from "@/components/MotionProvider";
import { AppFrame } from "@/components/AppFrame";
import { Splash } from "@/components/Splash";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Night Kitchen",
  description: "A personal recipe library that actually gets cooked from.",
  appleWebApp: {
    capable: true,
    title: "Night Kitchen",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f2f1ec",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // no accidental zoom while cooking with greasy hands
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the inline script sets data-mode/theme/style on <html>
    // before React hydrates, which is intentional.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* overflow-x-hidden: the page slides right to reveal the menu, and that
          shift must not become a horizontal scrollbar. */}
      <body
        className={`${bricolage.variable} ${instrument.variable} ${caveat.variable} overflow-x-hidden antialiased`}
      >
        {/* First in the body so its markup parses (and starts animating)
            before anything else on a cold start. */}
        <Splash />
        {/* Shown only by the portrait-lock media query in globals.css.
            aria-hidden is deliberately absent: when it's visible it is the
            only thing a screen reader should find. */}
        <div className="rotate-notice">
          <p className="font-display text-xl font-bold">Turn me back around</p>
          <p className="font-hand text-xl text-smoke">the kitchen works portrait</p>
        </div>
        <MotionProvider>
          <AppFrame>{children}</AppFrame>
        </MotionProvider>
        <PWASetup />
      </body>
    </html>
  );
}
