/**
 * 麦畑防衛戦のバランス・データ定義（Phaser非依存の純粋モジュール）。
 * シーン（lib/phaser/towerDefense.ts）と React UI の両方から使う。
 */

export const COLS = 12;
export const ROWS = 8;
export const BASE_HP = 20;

export const BALANCE = {
  initialWheat: 180, hpGrowth: 1.105, endlessGrowth: 0.055,
  bonusBase: 28, bonusPerWave: 3, rewardGrowth: 0.045,
  wetDuration: 3, wetLightning: 1.65, frozenCannon: 1.4,
  slowDuration: 1.6, bossRageSpeed: 1.65, maxParticles: 360,
};

/** 経路（セル座標）。入口は左端 row1、出口は下端 col9。 */
export const PATH_SEGMENTS: Array<[number, number, number, number]> = [
  [-1, 1, 9, 1],
  [9, 1, 9, 3],
  [9, 3, 2, 3],
  [2, 3, 2, 5],
  [2, 5, 9, 5],
  [9, 5, 9, 8],
];

export const PATH_CELLS = new Set<string>();
for (const [c0, r0, c1, r1] of PATH_SEGMENTS) {
  const dc = Math.sign(c1 - c0);
  const dr = Math.sign(r1 - r0);
  let c = c0, r = r0;
  PATH_CELLS.add(`${c},${r}`);
  while (c !== c1 || r !== r1) {
    c += dc; r += dr;
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) PATH_CELLS.add(`${c},${r}`);
  }
}

export type TowerKind = "scarecrow" | "sprinkler" | "fan" | "thunder";
export type TowerDef = {
  name: string; icon: string; cost: number; range: number; dmg: number; rate: number;
  color: string; desc: string; slow?: number; chain?: number;
};
export const TOWERS: Record<TowerKind, TowerDef> = {
  scarecrow: { name: "かかし砲台", icon: "🧑‍🌾", cost: 50, range: 2.7, dmg: 14, rate: 1.4, color: "#e0a458", desc: "単体砲撃。鈍化中の敵へ威力1.4倍" },
  sprinkler: { name: "連射スプリンクラー", icon: "💦", cost: 40, range: 2.1, dmg: 4, rate: 5, color: "#4db8e8", desc: "連射で3秒間「濡れ」付与。雷と好相性" },
  fan: { name: "氷結ファン", icon: "❄️", cost: 60, range: 2.3, dmg: 2, rate: 2, color: "#7cc7e8", desc: "1.6秒鈍化。かかし砲台の威力を増幅", slow: 0.45 },
  thunder: { name: "雷タワー", icon: "⚡", cost: 120, range: 3.0, dmg: 24, rate: 0.55, color: "#b388ff", desc: "3体連鎖。濡れた敵へ威力1.65倍", chain: 3 },
};
export const TOWER_KINDS = Object.keys(TOWERS) as TowerKind[];

export function towerStats(kind: TowerKind, lv: number) {
  const d = TOWERS[kind];
  return {
    dmg: d.dmg * Math.pow(1.55, lv - 1),
    range: d.range * (1 + 0.09 * (lv - 1)),
    rate: d.rate * Math.pow(1.16, lv - 1),
  };
}
export function upgradeCost(kind: TowerKind, lv: number): number | null {
  if (lv >= 3) return null;
  return Math.round(TOWERS[kind].cost * (lv === 1 ? 0.8 : 1.2));
}

export type EKind = "normal" | "fast" | "tank" | "swarm" | "boss";
export const ENEMY_LABELS: Record<EKind, string> = {
  normal: "🐦 カラス", fast: "🦇 コウモリ", tank: "🪲 甲虫", swarm: "🐜 アリ", boss: "👑 王様",
};
export function waveName(wave: number) {
  if (wave % 5 === 0) return "王様の襲来";
  return ["カラスの偵察", "俊足ラッシュ", "アリの大行進", "甲虫の盾"][((wave - 1) % 5) % 4];
}
export function waveQueue(wave: number): EKind[] {
  const q: EKind[] = [];
  const tier = Math.min(8, Math.floor((wave - 1) / 5));
  const add = (kind: EKind, count: number) => { for (let i = 0; i < count; i++) q.push(kind); };
  const extra = Math.min(16, tier * 2);
  switch (wave % 5) {
    case 1: add("normal", 8 + extra); if (tier) { add("fast", 4 + tier); add("tank", 2); } break;
    case 2: add("normal", 3); add("fast", 9 + extra); break;
    case 3: add("swarm", 22 + extra); add("normal", 3 + tier); break;
    case 4: for (let i = 0; i < 4 + Math.min(tier, 6); i++) { add("tank", 1); add("normal", 2); } break;
    default: add("normal", 4 + extra); add("boss", 1); add("fast", 5 + Math.min(tier, 8)); add("swarm", 8 + extra);
  }
  return q;
}
export function waveHpMultiplier(wave: number) {
  return Math.pow(BALANCE.hpGrowth, Math.min(wave - 1, 19)) *
    (1 + Math.max(0, wave - 20) * BALANCE.endlessGrowth);
}
export function enemyBase(kind: EKind) {
  return {
    normal: { hp: 22, spd: 34, bounty: 6, leak: 1, r: 15, emoji: "🐦" },
    fast: { hp: 13, spd: 58, bounty: 7, leak: 1, r: 13, emoji: "🦇" },
    tank: { hp: 95, spd: 19, bounty: 14, leak: 2, r: 22, emoji: "🌩️" },
    swarm: { hp: 8, spd: 44, bounty: 3, leak: 1, r: 10, emoji: "🐜" },
    boss: { hp: 460, spd: 15, bounty: 150, leak: 5, r: 30, emoji: "👹" },
  }[kind];
}
