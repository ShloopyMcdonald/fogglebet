import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FoggleBet",
  description: "Personal +EV bet tracker",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col"
        style={{ background: 'radial-gradient(ellipse at 20% 10%, #0f172a 0%, #0b0b0f 60%)', backgroundAttachment: 'fixed' }}
      >
        <header className="border-b border-white/5 px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-white">FoggleBet</h1>
        </header>
        {children}
      </body>
    </html>
  );
}
