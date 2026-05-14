"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { createRepl } from "../lib/api";

const LANGUAGES = [
  {
    id: "node-js" as const,
    name: "Node.js",
    description: "JavaScript runtime",
    icon: "⬡",
    color: "#3fb950",
  },
  {
    id: "react" as const,
    name: "React",
    description: "UI component library",
    icon: "⚛",
    color: "#58a6ff",
  },
];

export default function HomePage() {
  const router = useRouter();
  const [selectedLang, setSelectedLang] = useState<"node-js" | "react">(
    "node-js"
  );
  const [replName, setReplName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const result = await createRepl(
        selectedLang,
        replName.trim() || "Untitled Repl",
        // Stubbed ownerId — replace with real auth when implemented
        "user-stub"
      );

      toast.success("Workspace created! Redirecting...");
      router.push(`/repl/${result.replId}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create workspace";
      toast.error(message);
      setIsCreating(false);
    }
  };

  return (
    <div className="landing-container">
      {/* Background gradient */}
      <div className="landing-bg" aria-hidden="true" />

      <div className="landing-content">
        {/* Hero */}
        <header className="landing-hero">
          <h1>BucketCode</h1>
          <p>
            Code, run, and preview projects instantly in your browser.
            <br />
            No setup required.
          </p>
        </header>

        {/* Create Form */}
        <div className="card-glass landing-form">
          {/* Language Picker */}
          <div className="form-group">
            <label className="form-label" id="lang-label">
              Choose a language
            </label>
            <div
              className="language-grid"
              role="radiogroup"
              aria-labelledby="lang-label"
            >
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedLang === lang.id}
                  className={`language-card ${selectedLang === lang.id ? "selected" : ""}`}
                  onClick={() => setSelectedLang(lang.id)}
                >
                  <span
                    className="language-icon"
                    style={{ color: lang.color }}
                    aria-hidden="true"
                  >
                    {lang.icon}
                  </span>
                  <span className="language-name">{lang.name}</span>
                  <span className="language-desc">{lang.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Name Input */}
          <div className="form-group">
            <label className="form-label" htmlFor="repl-name-input">
              Project name
            </label>
            <input
              id="repl-name-input"
              className="input"
              type="text"
              placeholder="my-awesome-project"
              value={replName}
              onChange={(e) => setReplName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              maxLength={64}
              autoComplete="off"
            />
          </div>

          {/* Create Button */}
          <button
            id="create-repl-button"
            className="btn btn-primary btn-lg"
            onClick={handleCreate}
            disabled={isCreating}
            style={{ width: "100%" }}
          >
            {isCreating ? (
              <>
                <span className="loader-spinner" aria-hidden="true" />
                Creating workspace...
              </>
            ) : (
              "Create Workspace →"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
