"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/analytics", label: "Equity", q: "Did it make money?" },
  { href: "/analytics/calibration", label: "Calibration", q: "Are the price estimates trustworthy?" },
  { href: "/analytics/categories", label: "Categories", q: "What sold best?" },
];

export function AnalyticsNav() {
  const path = usePathname();
  return (
    <nav className="subnav" aria-label="Analytics views">
      {TABS.map((t) => {
        const active = t.href === "/analytics" ? path === "/analytics" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={active ? "active" : ""}>
            <span className="subnav-l">{t.label}</span>
            <span className="subnav-q">{t.q}</span>
          </Link>
        );
      })}
    </nav>
  );
}
