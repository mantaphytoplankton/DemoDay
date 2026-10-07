"use client";

import { useHydrated } from "@/hooks/useHydrated";

const OPTIONS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
const UTC = new Intl.DateTimeFormat("en-GB", { ...OPTIONS, timeZone: "UTC" });

/**
 * A timestamp in the viewer's time zone and locale. Server and hydration render the same UTC text,
 * then the viewer's local time replaces it, so the two renders never disagree.
 */
export function LocalTime({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  const d = new Date(iso);
  return (
    <time dateTime={iso} title={d.toISOString()}>
      {hydrated ? d.toLocaleString(undefined, OPTIONS) : `${UTC.format(d)} UTC`}
    </time>
  );
}
