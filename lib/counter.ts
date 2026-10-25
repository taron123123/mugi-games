const NS = "mugi-games-solo-guild";
const BASE = "https://abacus.jasoncameron.dev";

/** 現在のプレイ回数を取得。未初期化(404)は 0、失敗時は null。 */
export async function getCount(slug: string): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/get/${NS}/plays-${slug}`);
    if (res.status === 404) return 0;
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "value" in data &&
      typeof (data as { value: unknown }).value === "number"
    ) {
      return (data as { value: number }).value;
    }
    return null;
  } catch {
    return null;
  }
}

/** プレイ回数を +1 して新しい値を返す。失敗時は null。 */
export async function hitCount(slug: string): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/hit/${NS}/plays-${slug}`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "value" in data &&
      typeof (data as { value: unknown }).value === "number"
    ) {
      return (data as { value: number }).value;
    }
    return null;
  } catch {
    return null;
  }
}

export function formatCount(n: number | null, loaded: boolean): string {
  if (!loaded) return "…";
  if (n === null) return "—";
  return n.toLocaleString("ja-JP");
}
