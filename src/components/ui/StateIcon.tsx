import type { TeamStatus } from "@/shared/status";

export type StateKind = "pending" | "active" | "done" | "failed" | "hold";

export function stateKind(s: TeamStatus): StateKind {
  if (s === "Completed") return "done";
  if (s === "Failed") return "failed";
  if (s === "Pending") return "pending";
  return "active";
}

/** Shape carries the meaning (ui-guideline.md section 3.3); colour comes from the parent. */
export function StateIcon({ kind, size = 16 }: { kind: StateKind; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true, focusable: false } as const;
  switch (kind) {
    case "pending":
      return (<svg {...common}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>);
    case "active":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" />
          <path className="spin" d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "done":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M4.8 8.2l2.1 2.1 4.3-4.6" fill="none" stroke="#0B1220" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "failed":
      return (
        <svg {...common}>
          <path d="M8 1.5l7 12.5H1z" fill="currentColor" />
          <path d="M8 6v4" stroke="#0B1220" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="12.1" r="1" fill="#0B1220" />
        </svg>
      );
    case "hold":
      return (
        <svg {...common}>
          <rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
          <rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
        </svg>
      );
  }
}

export function FlagIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2 1v10M2 1.5h7l-1.5 2.5L9 6.5H2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
