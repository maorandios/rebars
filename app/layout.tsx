import type { Metadata } from "next";
import "./globals.css";

import { ReinforcementProvider } from "@/context/reinforcement-context";

export const metadata: Metadata = {
  title: "Slab Mesh Geometry MVP",
  description:
    "Phase 1 local-first slab geometry and base mesh clipping workspace."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ReinforcementProvider>{children}</ReinforcementProvider>
      </body>
    </html>
  );
}
