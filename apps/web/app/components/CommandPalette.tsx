"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

interface Command {
  readonly label: string;
  readonly href: string;
  readonly hint?: string;
}

const COMMANDS: Command[] = [
  { label: "Go to Triage feed", href: "/", hint: "g t" },
  { label: "Go to Money / P&L", href: "/money", hint: "g m" },
  { label: "Go to Health", href: "/health", hint: "g h" },
];

/** ⌘K command palette (plan §14). Keyboard-complete: open with ⌘/Ctrl-K, arrow to navigate, Enter to go. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQ("");
        setSel(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(
    () => COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())),
    [q],
  );

  if (!open) return null;

  function go(cmd: Command | undefined) {
    if (!cmd) return;
    setOpen(false);
    router.push(cmd.href);
  }

  return (
    <div className="palette-scrim" onClick={() => setOpen(false)} role="presentation">
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          autoFocus
          value={q}
          placeholder="Jump to…"
          aria-label="Command"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, results.length - 1));
            else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
            else if (e.key === "Enter") go(results[sel]);
          }}
        />
        <ul>
          {results.map((c, i) => (
            <li key={c.href} aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(c)}>
              {c.label}
              {c.hint ? <span className="k">{c.hint}</span> : null}
            </li>
          ))}
          {results.length === 0 ? <li className="k">no matches</li> : null}
        </ul>
      </div>
    </div>
  );
}
