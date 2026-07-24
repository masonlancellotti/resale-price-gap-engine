"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Triage" },
  { href: "/analytics", label: "Analytics" },
  { href: "/money", label: "Money" },
  { href: "/health", label: "Health" },
];

export function NavBar() {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" || path.startsWith("/deal") : path.startsWith(href));
  return (
    <nav className="nav" aria-label="Primary">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={isActive(l.href) ? "active" : ""}>
          {l.label}
        </Link>
      ))}
      <span className="hint">
        <kbd>⌘</kbd> <kbd>K</kbd> command palette
      </span>
    </nav>
  );
}
