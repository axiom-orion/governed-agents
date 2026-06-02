import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Governed Agents — Run Trace",
  description:
    "Visualize a governed multi-agent run: agent handoffs, source provenance, and the pre-action governance gate — rendered purely from the trace event stream.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full bg-slate-50 font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
