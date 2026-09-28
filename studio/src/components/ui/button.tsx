"use client";

import { CircleNotchIcon } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const styles: Record<Variant, string> = {
  primary:
    "bg-ink text-paper border-2 border-ink hover:bg-paper hover:text-ink disabled:bg-ink-3 disabled:border-ink-3 disabled:text-paper",
  secondary:
    "bg-paper text-ink border-2 border-ink hover:bg-ink hover:text-paper disabled:text-ink-3 disabled:border-rule",
  ghost: "bg-transparent text-ink border-2 border-transparent hover:border-ink disabled:text-ink-3",
};

export function Button({
  variant = "primary",
  loading = false,
  icon,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-12 items-center justify-center gap-2.5 px-5 font-semibold text-base transition-colors duration-150 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {loading ? <CircleNotchIcon size={20} weight="bold" className="animate-spin" aria-hidden /> : icon}
      <span>{children}</span>
    </button>
  );
}
