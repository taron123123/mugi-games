"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SITE_URL } from "@/lib/games";
import { usePlayCounter } from "@/lib/usePlayCounter";
import { pushHistory } from "@/lib/records";
import { sfx } from "@/lib/sfx";
import PlayCountBadge from "./PlayCountBadge";
import RecordsPanel from "./RecordsPanel";
import ShareButton from "./ShareButton";
import MuteButton from "./MuteButton";

const SLUG = "tower-defense";
const HIST_KEY = "mugi-games:td:history";

const COLS = 12;
const ROWS = 8;
const CELL = 56;
const HUD_H = 46;
const W = COLS * CELL;
const H = HUD_H + ROWS * CELL;
const BASE_HP = 20;

// 経路（セル座標）。入口は左端 row1、出口は下端 col9。
const PATH_SEGMENTS: Array<[number, number, number, number]> = [
  [-1, 1, 9, 1],
  [9, 1, 9, 3],
  [9, 3, 2, 3],
  [2, 3, 2, 5],
  [2, 5, 9, 5],
  [9, 5, 9, 8],
];

function cellCenter(c: number, r: number): [number, number] {
  return [c * CELL + CELL / 2, HUD_H + r * CELL + CELL / 2];
}

const WAYPOINTS: Array<[number, number]> = (() => {
  const pts: Array<[number, number]> = [];
  for (const [c0, r0, c1, r1] of PATH_SEGMENTS) {
    if (pts.length === 0) pts.push(cellCenter(c0, r0));
    pts.push(cellCenter(c1, r1));
  }
  return pts;
})();

const SEG_LEN: number[] = [];
let PATH_TOTAL = 0;
for (let i = 0; i < WAYPOINTS.length - 1; i++) {
  const len = Math.hypot(
    WAYPOINTS[i + 1][0] - WAYPOINTS[i][0],
    WAYPOINTS[i + 1][1] - WAYPOINTS[i][1],
  );
  SEG_LEN.push(len);
  PATH_TOTAL += len;
}

function posAt(dist: number): [number, number] {
  let d = dist;
  for (let i = 0; i < SEG_LEN.length; i++) {
    if (d <= SEG_LEN[i] || i === SEG_LEN.length - 1) {
      const t = SEG_LEN[i] === 0 ? 0 : Math.min(1, Math.max(0, d / SEG_LEN[i]));
      return [
        WAYPOINTS[i][0] + (WAYPOINTS[i + 1][0] - WAYPOINTS[i][0]) * t,
        WAYPOINTS[i][1] + (WAYPOINTS[i + 1][1] - WAYPOINTS[i][1]) * t,
      ];
    }
    d -= SEG_LEN[i];
  }
  return WAYPOINTS[WAYPOINTS.length - 1];
}

const PATH_CELLS = new Set<string>();
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

type TowerKind = "scarecrow" | "sprinkler" | "fan" | "thunder";
type TowerDef = {
  name: string; icon: string; cost: number; range: number; dmg: number; rate: number;
  color: string; desc: string; slow?: number; chain?: number;
};
const TOWERS: Record<TowerKind, TowerDef> = {
  scarecrow: { name: "かかし砲台", icon: "🧑‍🌾", cost: 50, range: 2.7, dmg: 14, rate: 1.4, color: "#e0a458", desc: "標準バランスの単体攻撃" },
  sprinkler: { name: "連射スプリンクラー", icon: "💦", cost: 40, range: 2.1, dmg: 4, rate: 5, color: "#4db8e8", desc: "射程は短いが超連射" },
  fan: { name: "氷結ファン", icon: "❄️", cost: 60, range: 2.3, dmg: 2, rate: 2, color: "#7cc7e8", desc: "当てた敵を遅くする", slow: 0.45 },
  thunder: { name: "雷タワー", icon: "⚡", cost: 120, range: 3.0, dmg: 24, rate: 0.55, color: "#b388ff", desc: "最大3体へ連鎖する雷", chain: 3 },
};
const TOWER_KINDS = Object.keys(TOWERS) as TowerKind[];

function towerStats(kind: TowerKind, lv: number) {
  const d = TOWERS[kind];
  return {
    dmg: d.dmg * Math.pow(1.55, lv - 1),
    range: d.range * (1 + 0.09 * (lv - 1)),
    rate: d.rate * Math.pow(1.16, lv - 1),
  };
}
function upgradeCost(kind: TowerKind, lv: number): number | null {
  if (lv >= 3) return null;
  return Math.round(TOWERS[kind].cost * (lv === 1 ? 0.8 : 1.2));
}

type Tower = { id: number; kind: TowerKind; c: number; r: number; lv: number; invested: number; cd: number };
type EKind = "normal" | "fast" | "tank" | "swarm" | "boss";
type Enemy = {
  id: number; kind: EKind; dist: number; hp: number; maxHp: number;
  spd: number; bounty: number; leak: number; r: number; emoji: string;
  slowUntil: number; slowFactor: number; deadFlag?: boolean;
};
type Proj = { x: number; y: number; targetId: number; dmg: number; kind: TowerKind; slow?: number };
type Bolt = { pts: Array<[number, number]>; ttl: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string };

type Phase = "build" | "playing" | "paused" | "over";

type S = {
  gtime: number;
  wheat: number;
  baseHp: number;
  wave: number;
  kills: number;
  totalEarned: number;
  towers: Tower[];
  enemies: Enemy[];
  projs: Proj[];
  bolts: Bolt[];
  particles: Particle[];
  queue: EKind[];
  spawnCd: number;
  waveActive: boolean;
  autoTimer: number;
  banner: string;
  bannerUntil: number;
  invalidAt: number;
  invalidCell: string;
  hover: { c: number; r: number } | null;
  nextId: number;
  lastTs: number;
};

function freshState(): S {
  return {
    gtime: 0, wheat: 150, baseHp: BASE_HP, wave: 0,
    kills: 0, totalEarned: 0,
    towers: [], enemies: [], projs: [], bolts: [], particles: [],
    queue: [], spawnCd: 0, waveActive: false, autoTimer: 0,
    banner: "", bannerUntil: 0, invalidAt: -9, invalidCell: "",
    hover: null, nextId: 1, lastTs: 0,
  };
}

function waveQueue(wave: number): EKind[] {
  const q: EKind[] = [];
  const n = Math.min(42, 7 + wave * 2);
  const swarmWave = wave % 3 === 0;
  for (let i = 0; i < n; i++) {
    const roll = Math.random();
    if (swarmWave && roll < 0.55) q.push("swarm");
    else if (wave >= 4 && roll < 0.12) q.push("tank");
    else if (wave >= 3 && roll < 0.35) q.push("fast");
    else q.push("normal");
  }
  // タンクは少し間隔を空けるため後ろに寄せる
  q.sort((a, b) => (a === "tank" ? 1 : 0) - (b === "tank" ? 1 : 0));
  if (wave % 5 === 0) q.push("boss");
  return q;
}

function enemyBase(kind: EKind) {
  return {
    normal: { hp: 22, spd: 34, bounty: 6, leak: 1, r: 15, emoji: "🐦" },
    fast: { hp: 13, spd: 58, bounty: 7, leak: 1, r: 13, emoji: "🦇" },
    tank: { hp: 95, spd: 19, bounty: 14, leak: 2, r: 22, emoji: "🌩️" },
    swarm: { hp: 8, spd: 44, bounty: 3, leak: 1, r: 10, emoji: "🐜" },
    boss: { hp: 950, spd: 15, bounty: 150, leak: 5, r: 30, emoji: "👹" },
  }[kind];
}

export default function TowerDefenseGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sRef = useRef<S>(freshState());
  const phaseRef = useRef<Phase>("build");
  const startedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("build");
  const [hud, setHud] = useState({ wheat: 150, baseHp: BASE_HP, wave: 0, waveActive: false });
  const [selectedKind, setSelectedKind] = useState<TowerKind>("scarecrow");
  const [selectedTower, setSelectedTower] = useState<number | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [result, setResult] = useState<{ wave: number; kills: number; score: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { count, loaded, registerPlay } = usePlayCounter(SLUG);
  const autoStartRef = useRef(autoStart);
  autoStartRef.current = autoStart;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const syncHud = useCallback(() => {
    const s = sRef.current;
    setHud({ wheat: Math.floor(s.wheat), baseHp: s.baseHp, wave: s.wave, waveActive: s.waveActive });
  }, []);

  const burst = useCallback((s: S, x: number, y: number, color: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 26 + Math.random() * 90;
      s.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0, maxLife: 0.3 + Math.random() * 0.25, color,
      });
    }
  }, []);

  const startWave = useCallback((s: S) => {
    s.wave += 1;
    s.queue = waveQueue(s.wave);
    s.waveActive = true;
    s.spawnCd = 0.3;
    s.banner = s.wave % 5 === 0 ? `WAVE ${s.wave} 👹ボス接近！` : `WAVE ${s.wave}`;
    s.bannerUntil = s.gtime + 1.6;
    sfx.play("clear");
    syncHud();
  }, [syncHud]);

  const endGame = useCallback((s: S) => {
    const score = s.kills * 15 + s.wave * 800 + s.totalEarned;
    setResult({ wave: s.wave, kills: s.kills, score });
    pushHistory(HIST_KEY, score);
    setRefreshKey((k) => k + 1);
    sfx.play("gameover");
    setPhaseBoth("over");
  }, [setPhaseBoth]);

  const damageEnemy = useCallback((s: S, e: Enemy, dmg: number) => {
    if (e.deadFlag) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      e.deadFlag = true;
      s.kills += 1;
      s.wheat += e.bounty;
      s.totalEarned += e.bounty;
      const [x, y] = posAt(e.dist);
      burst(s, x, y, e.kind === "boss" ? "#b388ff" : "#8a6d3b", e.kind === "boss" ? 30 : 7);
      sfx.play(e.kind === "boss" ? "boom" : "coin");
      syncHud();
    }
  }, [burst, syncHud]);

  const update = useCallback((s: S, dt: number) => {
    s.gtime += dt;

    // スポーン
    if (s.waveActive && s.queue.length > 0) {
      s.spawnCd -= dt;
      if (s.spawnCd <= 0) {
        const kind = s.queue.shift()!;
        const base = enemyBase(kind);
        const hpMul = Math.pow(1.19, s.wave - 1) * (kind === "boss" ? 1 + (s.wave / 5 - 1) * 0.6 : 1);
        s.enemies.push({
          id: s.nextId++, kind, dist: 0,
          hp: base.hp * hpMul, maxHp: base.hp * hpMul,
          spd: base.spd, bounty: Math.round(base.bounty * (1 + s.wave * 0.03)),
          leak: base.leak, r: base.r, emoji: base.emoji,
          slowUntil: 0, slowFactor: 1,
        });
        s.spawnCd = kind === "swarm" ? 0.22 : 0.75;
        syncHud();
      }
    }

    // 敵の移動
    for (const e of s.enemies) {
      if (e.deadFlag) continue;
      const slowed = s.gtime < e.slowUntil;
      e.dist += e.spd * (slowed ? e.slowFactor : 1) * dt;
      if (e.dist >= PATH_TOTAL) {
        e.deadFlag = true;
        s.baseHp -= e.leak;
        sfx.play("hurt");
        syncHud();
        if (s.baseHp <= 0) {
          s.baseHp = 0;
          endGame(s);
          return;
        }
      }
    }
    s.enemies = s.enemies.filter((e) => !e.deadFlag);

    // ウェーブ終了判定
    if (s.waveActive && s.queue.length === 0 && s.enemies.length === 0) {
      s.waveActive = false;
      const bonus = 20 + s.wave * 2;
      s.wheat += bonus;
      s.totalEarned += bonus;
      s.banner = `WAVE ${s.wave} クリア！ ボーナス +${bonus}🌾`;
      s.bannerUntil = s.gtime + 1.8;
      sfx.play("clear");
      s.autoTimer = 3;
      syncHud();
    }
    if (!s.waveActive && phaseRef.current === "playing" && autoStartRef.current) {
      s.autoTimer -= dt;
      if (s.autoTimer <= 0) startWave(s);
    }

    // タワーの攻撃
    for (const t of s.towers) {
      t.cd -= dt;
      const st = towerStats(t.kind, t.lv);
      const [tx, ty] = cellCenter(t.c, t.r);
      // 射程内で最も進んでいる敵
      let target: Enemy | null = null;
      for (const e of s.enemies) {
        if (e.deadFlag) continue;
        const [ex, ey] = posAt(e.dist);
        if (Math.hypot(ex - tx, ey - ty) <= st.range * CELL + e.r) {
          if (!target || e.dist > target.dist) target = e;
        }
      }
      if (!target || t.cd > 0) continue;
      t.cd = 1 / st.rate;
      const def = TOWERS[t.kind];
      if (t.kind === "thunder") {
        // 連鎖雷（即時）
        const chainTargets: Enemy[] = [target];
        let from = target;
        for (let i = 1; i < (def.chain ?? 3); i++) {
          let next: Enemy | null = null;
          let bestD = 100;
          const [fx, fy] = posAt(from.dist);
          for (const e of s.enemies) {
            if (e.deadFlag || chainTargets.includes(e)) continue;
            const [ex, ey] = posAt(e.dist);
            const d = Math.hypot(ex - fx, ey - fy);
            if (d < bestD) { bestD = d; next = e; }
          }
          if (!next) break;
          chainTargets.push(next);
          from = next;
        }
        // 稲妻の軌跡を作る
        const pts: Array<[number, number]> = [[tx, ty - 10]];
        for (const e of chainTargets) {
          const [ex, ey] = posAt(e.dist);
          const [px0, py0] = pts[pts.length - 1];
          const mx = (px0 + ex) / 2 + (Math.random() - 0.5) * 22;
          const my = (py0 + ey) / 2 + (Math.random() - 0.5) * 22;
          pts.push([mx, my], [ex, ey]);
        }
        s.bolts.push({ pts, ttl: 0.13 });
        for (const e of chainTargets) damageEnemy(s, e, st.dmg);
        sfx.play("thunder");
      } else {
        s.projs.push({
          x: tx, y: ty - 8, targetId: target.id, dmg: st.dmg,
          kind: t.kind, slow: def.slow,
        });
        sfx.play("shoot");
      }
    }

    // 弾の移動
    for (const p of s.projs) {
      const e = s.enemies.find((en) => en.id === p.targetId && !en.deadFlag);
      if (!e) { p.targetId = -1; continue; }
      const [ex, ey] = posAt(e.dist);
      const d = Math.hypot(ex - p.x, ey - p.y);
      const step = 420 * dt;
      if (d <= step + e.r * 0.4) {
        damageEnemy(s, e, p.dmg);
        if (p.slow && !e.deadFlag) {
          e.slowFactor = 1 - p.slow;
          e.slowUntil = s.gtime + 1.4;
          sfx.play("freeze");
        }
        burst(s, ex, ey, p.kind === "fan" ? "#bdeaff" : "#ffe9a8", 3);
        p.targetId = -1;
      } else {
        p.x += ((ex - p.x) / d) * step;
        p.y += ((ey - p.y) / d) * step;
      }
    }
    s.projs = s.projs.filter((p) => p.targetId !== -1);

    // エフェクト
    for (const b of s.bolts) b.ttl -= dt;
    s.bolts = s.bolts.filter((b) => b.ttl > 0);
    for (const p of s.particles) {
      p.life += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    s.particles = s.particles.filter((p) => p.life < p.maxLife);
    s.enemies = s.enemies.filter((e) => !e.deadFlag);
  }, [damageEnemy, endGame, startWave, syncHud, burst]);

  // (autoStartRef / speedRef はコンポーネント冒頭で宣言済み)

  const draw = useCallback((s: S) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // HUD帯
    ctx.fillStyle = "#23405a";
    ctx.fillRect(0, 0, W, HUD_H);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(`🌾 ${Math.floor(s.wheat)}`, 12, HUD_H / 2);
    ctx.fillText(`🏡 畑HP ${s.baseHp}`, 130, HUD_H / 2);
    ctx.fillText(`🌊 WAVE ${Math.max(1, s.wave)}`, 300, HUD_H / 2);
    const remain = s.enemies.length + s.queue.length;
    ctx.fillText(s.waveActive ? `敵のこり ${remain}` : "待機中", 470, HUD_H / 2);
    if (s.wave >= 20) {
      ctx.fillStyle = "#ffd94d";
      ctx.textAlign = "right";
      ctx.fillText("エンドレス中♾️", W - 12, HUD_H / 2);
      ctx.textAlign = "left";
    }

    // 草原
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (c + r) % 2 === 0 ? "#a9d977" : "#9ed168";
        ctx.fillRect(c * CELL, HUD_H + r * CELL, CELL, CELL);
      }
    }
    // 経路
    ctx.strokeStyle = "#d9b678";
    ctx.lineWidth = CELL * 0.78;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    WAYPOINTS.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    ctx.strokeStyle = "rgba(122, 90, 30, 0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    WAYPOINTS.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    ctx.setLineDash([]);
    // 入口と畑
    ctx.font = "24px serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🚪", 16, HUD_H + 1 * CELL + CELL / 2);
    ctx.font = "30px serif";
    ctx.fillText("🌾", 9 * CELL + CELL / 2, H - 14);
    ctx.font = "bold 11px sans-serif";
    ctx.fillStyle = "#5b4a1e";
    ctx.fillText("畑", 9 * CELL + CELL / 2 + 24, H - 14);

    // 配置ゴースト
    const sel = selectedTowerRef.current;
    if (s.hover && phaseRef.current !== "over") {
      const { c, r } = s.hover;
      const occupied = s.towers.some((t) => t.c === c && t.r === r);
      if (!occupied && !PATH_CELLS.has(`${c},${r}`)) {
        const def = TOWERS[selectedKindRef.current];
        const [cx, cy] = cellCenter(c, r);
        ctx.fillStyle = "rgba(77,184,232,0.14)";
        ctx.beginPath(); ctx.arc(cx, cy, def.range * CELL, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(43,143,199,0.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, def.range * CELL, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.65;
        ctx.font = "30px serif";
        ctx.fillText(def.icon, cx, cy);
        ctx.globalAlpha = 1;
        void sel;
      }
    }
    // 配置不可フラッシュ
    if (s.gtime - s.invalidAt < 0.35 && s.invalidCell) {
      const [c, r] = s.invalidCell.split(",").map(Number);
      ctx.fillStyle = "rgba(255,60,60,0.4)";
      ctx.fillRect(c * CELL, HUD_H + r * CELL, CELL, CELL);
    }
    // 選択中タワーの射程
    if (sel) {
      const [cx, cy] = cellCenter(sel.c, sel.r);
      const st = towerStats(sel.kind, sel.lv);
      ctx.fillStyle = "rgba(255,255,255,0.13)";
      ctx.beginPath(); ctx.arc(cx, cy, st.range * CELL, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath(); ctx.arc(cx, cy, st.range * CELL, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "#ffd94d";
      ctx.lineWidth = 3;
      ctx.strokeRect(sel.c * CELL + 2, HUD_H + sel.r * CELL + 2, CELL - 4, CELL - 4);
    }

    // タワー
    for (const t of s.towers) {
      const [cx, cy] = cellCenter(t.c, t.r);
      const def = TOWERS[t.kind];
      ctx.fillStyle = def.color;
      ctx.beginPath(); ctx.roundRect(cx - 22, cy - 22, 44, 44, 10); ctx.fill();
      ctx.strokeStyle = "rgba(35,64,90,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(cx - 22, cy - 22, 44, 44, 10); ctx.stroke();
      ctx.font = "26px serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.icon, cx, cy - 3);
      ctx.font = "10px sans-serif";
      ctx.fillStyle = "#ffd94d";
      ctx.fillText("★".repeat(t.lv), cx, cy + 17);
    }

    // 敵
    for (const e of s.enemies) {
      const [x, y] = posAt(e.dist);
      const slowed = s.gtime < e.slowUntil;
      if (slowed) {
        ctx.fillStyle = "rgba(140,220,255,0.45)";
        ctx.beginPath(); ctx.arc(x, y, e.r + 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = `${e.r * 2}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(e.emoji, x, y);
      if (e.hp < e.maxHp) {
        const bw = Math.max(30, e.r * 2);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(x - bw / 2, y - e.r - 11, bw, 5);
        ctx.fillStyle = e.kind === "boss" ? "#b388ff" : "#ff5252";
        ctx.fillRect(x - bw / 2, y - e.r - 11, bw * Math.max(0, e.hp / e.maxHp), 5);
      }
    }
    // 弾
    for (const p of s.projs) {
      ctx.fillStyle = TOWERS[p.kind].color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
    }
    // 稲妻
    for (const b of s.bolts) {
      ctx.strokeStyle = `rgba(255,225,77,${Math.max(0, b.ttl / 0.13)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      b.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
    // パーティクル
    for (const p of s.particles) {
      ctx.globalAlpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // バナー
    if (s.gtime < s.bannerUntil && s.banner) {
      ctx.font = "bold 30px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(35,64,90,0.85)";
      ctx.lineWidth = 6;
      const by = HUD_H + ROWS * CELL * 0.42;
      ctx.strokeText(s.banner, W / 2, by);
      ctx.fillText(s.banner, W / 2, by);
    }
  }, []);

  const selectedKindRef = useRef(selectedKind);
  selectedKindRef.current = selectedKind;
  const selectedTowerObj = selectedTower !== null
    ? sRef.current.towers.find((t) => t.id === selectedTower) ?? null
    : null;
  const selectedTowerRef = useRef<Tower | null>(null);
  selectedTowerRef.current = selectedTower !== null
    ? (sRef.current.towers.find((t) => t.id === selectedTower) ?? null)
    : null;

  // メインループ
  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      const s = sRef.current;
      const rawDt = s.lastTs === 0 ? 0 : Math.min(0.05, (ts - s.lastTs) / 1000);
      s.lastTs = ts;
      if (phaseRef.current === "playing" && rawDt > 0) {
        update(s, rawDt * speedRef.current);
      }
      draw(s);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [update, draw]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden && phaseRef.current === "playing") setPhaseBoth("paused");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [setPhaseBoth]);

  const toCell = (e: React.PointerEvent): { c: number; r: number } | null => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    const c = Math.floor(x / CELL);
    const r = Math.floor((y - HUD_H) / CELL);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return { c, r };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    sRef.current.hover = toCell(e);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const cell = toCell(e);
    const s = sRef.current;
    if (!cell || phaseRef.current === "over") return;
    const existing = s.towers.find((t) => t.c === cell.c && t.r === cell.r);
    if (existing) {
      setSelectedTower(existing.id);
      sfx.play("click");
      return;
    }
    if (PATH_CELLS.has(`${cell.c},${cell.r}`)) {
      s.invalidAt = s.gtime; s.invalidCell = `${cell.c},${cell.r}`;
      return;
    }
    const def = TOWERS[selectedKind];
    if (s.wheat < def.cost) {
      s.invalidAt = s.gtime; s.invalidCell = `${cell.c},${cell.r}`;
      sfx.play("hit");
      return;
    }
    s.wheat -= def.cost;
    const t: Tower = { id: s.nextId++, kind: selectedKind, c: cell.c, r: cell.r, lv: 1, invested: def.cost, cd: 0 };
    s.towers.push(t);
    setSelectedTower(t.id);
    sfx.play("place");
    syncHud();
  };

  const startGame = useCallback(() => {
    sfx.unlock();
    sfx.play("click");
    sRef.current = freshState();
    startedRef.current = true;
    setResult(null);
    setSelectedTower(null);
    syncHud();
    setPhaseBoth("playing");
    void registerPlay();
    startWave(sRef.current);
  }, [registerPlay, setPhaseBoth, startWave, syncHud]);

  /** 配置フェーズから、置いたタワーを保持したまま開始する */
  const beginFromBuild = useCallback(() => {
    sfx.unlock();
    sfx.play("click");
    startedRef.current = true;
    setResult(null);
    void registerPlay();
    setPhaseBoth("playing");
    startWave(sRef.current);
  }, [registerPlay, setPhaseBoth, startWave]);

  const doUpgrade = () => {
    const t = selectedTowerObj;
    if (!t) return;
    const cost = upgradeCost(t.kind, t.lv);
    const s = sRef.current;
    if (cost === null || s.wheat < cost) return;
    s.wheat -= cost;
    t.invested += cost;
    t.lv += 1;
    sfx.play("levelup");
    syncHud();
    setRefreshKey((k) => k + 1);
  };
  const doSell = () => {
    const t = selectedTowerObj;
    if (!t) return;
    const s = sRef.current;
    s.wheat += Math.floor(t.invested * 0.7);
    s.towers = s.towers.filter((x) => x.id !== t.id);
    setSelectedTower(null);
    sfx.play("coin");
    syncHud();
  };

  const shareText = result
    ? `🏯『麦畑防衛戦』で WAVE ${result.wave} まで畑を守った！ 撃破${result.kills}・スコア${result.score.toLocaleString()}点 🌾 #むぎゲームズ ${SITE_URL}/games/tower-defense`
    : "";

  return (
    <div className="game-box">
      <PlayCountBadge count={count} loaded={loaded} />
      <div className="game-toolbar">
        <span className="toolbar-label">🏯 麦畑防衛戦</span>
        <span className="toolbar-btns">
          <button type="button" className="chip-btn" onClick={() => setSpeed((v) => (v === 1 ? 2 : 1))}>
            ⏩ {speed}x
          </button>
          <button
            type="button"
            className={`chip-btn ${autoStart ? "on" : ""}`}
            onClick={() => setAutoStart((v) => !v)}
          >
            🔁 自動開始 {autoStart ? "ON" : "OFF"}
          </button>
          {phase === "playing" && (
            <button type="button" className="icon-btn" aria-label="ポーズ" onClick={() => setPhaseBoth("paused")}>⏸</button>
          )}
          {phase === "paused" && (
            <button type="button" className="icon-btn" aria-label="再開" onClick={() => setPhaseBoth("playing")}>▶️</button>
          )}
          <MuteButton />
        </span>
      </div>

      <div className="td-panel">
        {TOWER_KINDS.map((k) => {
          const d = TOWERS[k];
          const afford = hud.wheat >= d.cost;
          return (
            <button
              key={k}
              type="button"
              className={`td-card ${selectedKind === k ? "selected" : ""} ${afford ? "" : "cant"}`}
              onClick={() => { setSelectedKind(k); sfx.unlock(); sfx.play("click"); }}
            >
              <span className="td-card-icon">{d.icon}</span>
              <span className="td-card-name">{d.name}</span>
              <span className="td-card-desc">{d.desc}</span>
              <span className="td-card-cost">🌾 {d.cost}</span>
            </button>
          );
        })}
      </div>

      <div className="canvas-wrap td">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="game-canvas"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
        />
        {phase === "build" && (
          <div className="canvas-overlay build">
            <div className="build-card">
              <p className="overlay-title">🏯 麦畑防衛戦</p>
              <p>
                敵は左の入口🚪から畑🌾（下）を目指します。
                上のパネルでタワーを選び、草原をタップして配置しよう（経路には置けません）。
                準備ができたらスタート！ 5ウェーブごとにボス👹が出現します。
              </p>
              <button type="button" className="big-btn" onClick={beginFromBuild}>▶ ゲームスタート</button>
            </div>
          </div>
        )}
        {phase === "paused" && (
          <div className="canvas-overlay">
            <p className="overlay-title">⏸ ポーズ中</p>
            <div className="btn-row">
              <button type="button" className="big-btn" onClick={() => setPhaseBoth("playing")}>▶ つづける</button>
              <button type="button" className="sub-btn" onClick={startGame}>🔄 最初から</button>
            </div>
          </div>
        )}
        {phase === "over" && result && (
          <div className="canvas-overlay">
            <div className="result in-overlay">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mugi.webp" alt="むぎ" width={84} height={84} className="result-mugi" />
              <p className="result-title">畑が陥ちた…！</p>
              <p className="result-main">到達 <strong>WAVE {result.wave}</strong></p>
              <p className="result-sub">撃破 {result.kills} ／ スコア {result.score.toLocaleString()}点</p>
              <div className="btn-row">
                <button type="button" className="big-btn" onClick={startGame}>🔄 もう一度</button>
                <ShareButton text={shareText} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="td-controls">
        {phase === "playing" && !hud.waveActive && (
          <button type="button" className="big-btn" onClick={() => startWave(sRef.current)}>
            🌊 次のウェーブ（WAVE {hud.wave + 1}）
          </button>
        )}
        {selectedTowerObj && (
          <div className="td-selected">
            <span className="td-selected-name">
              {TOWERS[selectedTowerObj.kind].icon} {TOWERS[selectedTowerObj.kind].name} Lv{selectedTowerObj.lv}
            </span>
            <span className="td-selected-stats">
              攻撃 {Math.round(towerStats(selectedTowerObj.kind, selectedTowerObj.lv).dmg)} ／
              射程 {towerStats(selectedTowerObj.kind, selectedTowerObj.lv).range.toFixed(1)} ／
              連射 {towerStats(selectedTowerObj.kind, selectedTowerObj.lv).rate.toFixed(1)}/s
            </span>
            {upgradeCost(selectedTowerObj.kind, selectedTowerObj.lv) !== null ? (
              <button
                type="button"
                className="sub-btn"
                disabled={hud.wheat < (upgradeCost(selectedTowerObj.kind, selectedTowerObj.lv) ?? 0)}
                onClick={doUpgrade}
              >
                ⬆️ 強化（🌾{upgradeCost(selectedTowerObj.kind, selectedTowerObj.lv)}）
              </button>
            ) : (
              <span className="td-max">最大レベル</span>
            )}
            <button type="button" className="sub-btn danger" onClick={doSell}>
              💰 売却（🌾{Math.floor(selectedTowerObj.invested * 0.7)}）
            </button>
            <button type="button" className="sub-btn" onClick={() => setSelectedTower(null)}>✖ 閉じる</button>
          </div>
        )}
      </div>
      <p className="catch-help">
        タワーを選んで草原をタップで配置（経路には置けません）。置いたタワーをタップすると強化・売却できます。
      </p>
      <RecordsPanel
        storageKey={HIST_KEY}
        refreshKey={refreshKey}
        formatValue={(v) => `${v.toLocaleString()}点`}
        bestMode="max"
      />
    </div>
  );
}
