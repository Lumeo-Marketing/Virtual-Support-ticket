import type { Metadata } from "next";
import "./globals.css";
import { AlertProvider } from "./alerts";

export const metadata: Metadata = {
  title: "LUMEO | Internal Support",
  description: "Secure in-house IT support workspace for LUMEO staff and administrators.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AlertProvider>{children}</AlertProvider></body></html>;
}
