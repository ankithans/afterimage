import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono } from "next/font/google";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["opsz", "wdth"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://afterimage.space"),
  title: "afterimage · your song knows what it looks like",
  description:
    "A tiny film crew in your browser. Send it a song. It listens, pitches three directions, then shoots, cuts and delivers your video.",
  openGraph: {
    title: "afterimage · your song knows what it looks like",
    description:
      "One song in. One visual world out. A tiny film crew for musicians.",
    url: "https://afterimage.space",
    siteName: "afterimage",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable}`}>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
