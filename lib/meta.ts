/**
 * むぎサバイバーズの周回要素（メタ永続強化）の定義と永続化。
 * ランで稼いだ「麦の粒」を localStorage に貯め、恒常アップグレードに使う。
 * Phaser 非依存の純粋モジュール（シーンと React UI の両方から使う）。
 */
import { loadNumber, saveNumber } from "./records";

export const GRAINS_KEY = "mugi-games:survivors:grains";
export const META_KEY = "mugi-games:survivors:meta";

export type MetaTrackId = "hp" | "spd" | "mag" | "pow";
export type MetaLevels = Record<MetaTrackId, number>;

export const META_MAX_LV = 5;
/** 次のレベルに上げるコスト（現在Lvを添字に使う。全トラック共通） */
export const META_COSTS = [30, 60, 120, 240, 480];

export type MetaTrackDef = {
  id: MetaTrackId;
  icon: string;
  name: string;
  /** 1レベルごとの効果説明 */
  perLv: string;
  /** 現在Lvでの合計効果の表示を作る */
  effectLabel: (lv: number) => string;
};

export const META_TRACKS: MetaTrackDef[] = [
  {
    id: "hp", icon: "❤️", name: "体力の素",
    perLv: "最大HP +10 / Lv",
    effectLabel: (lv) => `最大HP +${10 * lv}`,
  },
  {
    id: "spd", icon: "👟", name: "疾風の素",
    perLv: "移動速度 +3% / Lv",
    effectLabel: (lv) => `移動速度 +${3 * lv}%`,
  },
  {
    id: "mag", icon: "🧲", name: "引力の素",
    perLv: "獲得範囲 +12% / Lv",
    effectLabel: (lv) => `獲得範囲 +${12 * lv}%`,
  },
  {
    id: "pow", icon: "💪", name: "力の素",
    perLv: "全ダメージ +4% / Lv",
    effectLabel: (lv) => `全ダメージ +${4 * lv}%`,
  },
];

export const EMPTY_META: MetaLevels = { hp: 0, spd: 0, mag: 0, pow: 0 };

/** ランの成果から獲得できる麦の粒：撃破2体で1粒＋生存15秒で1粒 */
export function grainsForRun(kills: number, timeSec: number): number {
  return Math.floor(kills / 2) + Math.floor(timeSec / 15);
}

export function loadGrains(): number {
  return Math.max(0, Math.floor(loadNumber(GRAINS_KEY) ?? 0));
}

export function saveGrains(n: number): void {
  saveNumber(GRAINS_KEY, Math.max(0, Math.floor(n)));
}

export function loadMetaLevels(): MetaLevels {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { ...EMPTY_META };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...EMPTY_META };
    const out = { ...EMPTY_META };
    for (const t of META_TRACKS) {
      const v = (parsed as Record<string, unknown>)[t.id];
      if (typeof v === "number" && Number.isFinite(v)) {
        out[t.id] = Math.min(META_MAX_LV, Math.max(0, Math.floor(v)));
      }
    }
    return out;
  } catch {
    return { ...EMPTY_META };
  }
}

export function saveMetaLevels(lv: MetaLevels): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(lv));
  } catch {
    /* 保存できなくてもゲームは続行 */
  }
}

/** そのトラックを次に上げるコスト。最大レベルなら null */
export function nextCost(lv: MetaLevels, id: MetaTrackId): number | null {
  const cur = lv[id];
  return cur >= META_MAX_LV ? null : META_COSTS[cur];
}

/** これまでに消費した粒の総額（リセット時の返金計算用） */
export function spentTotal(lv: MetaLevels): number {
  let sum = 0;
  for (const t of META_TRACKS) {
    for (let i = 0; i < lv[t.id]; i++) sum += META_COSTS[i];
  }
  return sum;
}

export function totalLevels(lv: MetaLevels): number {
  return META_TRACKS.reduce((a, t) => a + lv[t.id], 0);
}
