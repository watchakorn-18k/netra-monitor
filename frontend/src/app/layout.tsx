import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "VPS Monitor Dashboard",
  description: "Real-time VPS resource monitoring dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={cn("dark font-sans", geist.variable)}>
      <body className="antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
