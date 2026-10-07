/** "Team 2" before "Team 10", case-insensitive (stable team queue order, BAT-02). */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
