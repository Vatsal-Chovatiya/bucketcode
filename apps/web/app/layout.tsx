import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "BucketCode — Browser IDE",
  description:
    "Code, run, and preview projects instantly in your browser. BucketCode provides a full development environment with an editor, terminal, and live preview.",
  keywords: ["IDE", "browser IDE", "code editor", "online coding", "BucketCode"],
  openGraph: {
    title: "BucketCode — Browser IDE",
    description: "Code, run, and preview projects instantly in your browser.",
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
      <body suppressHydrationWarning>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              boxShadow: "var(--shadow-md)",
            },
            success: {
              iconTheme: {
                primary: "var(--success)",
                secondary: "var(--bg-elevated)",
              },
            },
            error: {
              iconTheme: {
                primary: "var(--error)",
                secondary: "var(--bg-elevated)",
              },
            },
          }}
        />
      </body>
    </html>
  );
}
