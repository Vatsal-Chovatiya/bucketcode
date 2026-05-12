/**
 * Repl Page — Server Component
 *
 * Fetches repl metadata, validates state, and renders:
 * - If TERMINATED: "Resume Workspace" button
 * - Otherwise: passes data to client Workspace component
 *
 * This is a Server Component for:
 * - SEO (dynamic title/description)
 * - Initial auth check
 * - Fast TTFB (no client-side loading flicker)
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workspace } from "./workspace";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ─── Dynamic Metadata ────────────────────────────────────────────

interface PageProps {
  params: Promise<{ replId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { replId } = await params;

  return {
    title: `${replId} — BucketCode`,
    description: `Editing workspace ${replId} on BucketCode.`,
  };
}

// ─── Page Component ──────────────────────────────────────────────

export default async function ReplPage({ params }: PageProps) {
  const { replId } = await params;

  // Fetch metadata from http-backend
  let repl: {
    id: string;
    name: string;
    language: string;
    status: string;
    ownerId: string;
    previewUrl: string | null;
    runnerAddr: string | null;
  };

  try {
    const res = await fetch(`${API_URL}/repl/${replId}`, {
      cache: "no-store", // Always fresh
    });

    if (res.status === 404) {
      notFound();
    }

    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    repl = await res.json();
  } catch (err) {
    // If API is unreachable, show a fallback
    console.error("[ReplPage] Failed to fetch metadata:", err);
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 16,
          color: "var(--text-secondary)",
          fontFamily: "var(--font-sans)",
          background: "var(--bg-primary)",
        }}
      >
        <span style={{ fontSize: 48 }}>⚠️</span>
        <h2 style={{ color: "var(--text-primary)" }}>
          Unable to load workspace
        </h2>
        <p>The API server may be offline. Please try again later.</p>
        <a href="/" className="btn btn-secondary">
          ← Back to Home
        </a>
      </div>
    );
  }

  return (
    <Workspace
      replId={repl.id}
      language={repl.language}
      previewUrl={repl.previewUrl}
      status={repl.status}
      ownerId={repl.ownerId}
      replName={repl.name}
    />
  );
}
