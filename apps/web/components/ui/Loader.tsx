/**
 * Loader Component
 *
 * Reusable animated loader with multiple variants.
 */

"use client";

interface LoaderProps {
  variant?: "spinner" | "dots";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_MAP = {
  sm: { spinner: 16, dot: 6 },
  md: { spinner: 24, dot: 8 },
  lg: { spinner: 36, dot: 10 },
};

export function Loader({
  variant = "spinner",
  size = "md",
  className = "",
}: LoaderProps) {
  const dims = SIZE_MAP[size];

  if (variant === "dots") {
    return (
      <div className={`loader-dots ${className}`}>
        <span style={{ width: dims.dot, height: dims.dot }} />
        <span style={{ width: dims.dot, height: dims.dot }} />
        <span style={{ width: dims.dot, height: dims.dot }} />
      </div>
    );
  }

  return (
    <div
      className={`loader-spinner ${className}`}
      style={{ width: dims.spinner, height: dims.spinner }}
      role="status"
      aria-label="Loading"
    />
  );
}
