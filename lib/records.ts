export type Rec = { v: number; t: number };

const CAP = 50;

export function loadHistory(key: string): Rec[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is Rec =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as Rec).v === "number" &&
        typeof (r as Rec).t === "number",
    );
  } catch {
    return [];
  }
}

export function pushHistory(key: string, v: number): Rec[] {
  const next = [...loadHistory(key), { v, t: Date.now() }].slice(-CAP);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* 保存できなくてもゲームは続行 */
  }
  return next;
}

export function bestOf(recs: Rec[], mode: "min" | "max"): number | null {
  if (recs.length === 0) return null;
  const vals = recs.map((r) => r.v);
  return mode === "min" ? Math.min(...vals) : Math.max(...vals);
}

export function loadNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function saveNumber(key: string, n: number): void {
  try {
    localStorage.setItem(key, String(n));
  } catch {
    /* ignore */
  }
}

export function formatWhen(t: number): string {
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}
