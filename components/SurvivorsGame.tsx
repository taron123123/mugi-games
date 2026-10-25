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

const SLUG = "survivors";
const HIST_KEY = "mugi-games:survivors:history";

const VW = 960;
const VH = 600;
const WORLD = 2600;
const PLAYER_R = 21;

type Phase = "idle" | "playing" | "levelup" | "paused" | "over";

type EnemyKind = "crow" | "bat" | "cloud" | "elite" | "boss";
type Enemy = {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  spd: number;
  dmg: number;
  r: number;
  xp: number;
  score: number;
  flash: number;
  orbitHitAt: number;
  deadFlag?: boolean;
};
type Bullet = { x: number; y: number; vx: number; vy: number; dmg: number; life: number };
type Missile = { x: number; y: number; vx: number; vy: number; targetId: number; dmg: number; life: number };
type Gem = { x: number; y: number; v: number; vx: number; vy: number };
type Heal = { x: number; y: number };
type Particle = {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; color: string; size: number;
};
type FloatText = { x: number; y: number; text: string; life: number; color: string };

type Weapons = {
  dmgLv: number;
  rateLv: number;
  countLv: number;
  orbit: number;
  missile: number;
  thunder: number;
  speedLv: number;
  magnetLv: number;
};

type S = {
  time: number;
  px: number; py: number;
  hp: number; maxHp: number;
  level: number; xp: number; xpNext: number;
  kills: number; score: number;
  weapons: Weapons;
  enemies: Enemy[];
  bullets: Bullet[];
  missiles: Missile[];
  gems: Gem[];
  heals: Heal[];
  particles: Particle[];
  texts: FloatText[];
  keys: Set<string>;
  joy: { active: boolean; id: number; ox: number; oy: number; dx: number; dy: number };
  shotCd: number;
  missileCd: number;
  thunderCd: number;
  orbitAngle: number;
  spawnCd: number;
  eliteAt: number;
  bossAt: number;
  invulnUntil: number;
  shake: number;
  faceX: number; faceY: number;
  banner: string;
  bannerUntil: number;
  nextId: number;
  raf: number;
  lastTs: number;
  running: boolean;
};

function freshState(): S {
  return {
    time: 0,
    px: WORLD / 2, py: WORLD / 2,
    hp: 100, maxHp: 100,
    level: 1, xp: 0, xpNext: 6,
    kills: 0, score: 0,
    weapons: { dmgLv: 0, rateLv: 0, countLv: 0, orbit: 0, missile: 0, thunder: 0, speedLv: 0, magnetLv: 0 },
    enemies: [], bullets: [], missiles: [], gems: [], heals: [], particles: [], texts: [],
    keys: new Set(),
    joy: { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 },
    shotCd: 0, missileCd: 1, thunderCd: 2,
    orbitAngle: 0,
    spawnCd: 0.5,
    eliteAt: 60, bossAt: 180,
    invulnUntil: 0, shake: 0,
    faceX: 1, faceY: 0,
    banner: "", bannerUntil: 0,
    nextId: 1, raf: 0, lastTs: 0, running: false,
  };
}

type Card = { id: string; icon: string; name: string; desc: string; apply: (s: S) => void };

function buildPool(s: S): Card[] {
  const w = s.weapons;
  const pool: Card[] = [];
  pool.push({
    id: "dmg", icon: "💪", name: "麦ショット威力+",
    desc: "基本ショットのダメージ +6",
    apply: (st) => { st.weapons.dmgLv += 1; },
  });
  pool.push({
    id: "rate", icon: "🔥", name: "連射アップ",
    desc: "基本ショットの発射間隔が短くなる",
    apply: (st) => { st.weapons.rateLv += 1; },
  });
  if (w.countLv < 4) {
    pool.push({
      id: "count", icon: "🌾", name: "同時発射 +1",
      desc: "基本ショットが1方向増える",
      apply: (st) => { st.weapons.countLv += 1; },
    });
  }
  if (w.orbit < 5) {
    pool.push({
      id: "orbit", icon: "🌀", name: w.orbit === 0 ? "回転ガマ 解放！" : "回転ガマ Lv+",
      desc: w.orbit === 0 ? "周囲を回る鎌で敵を切り刻む" : `鎌が増えて威力アップ（現在 Lv${w.orbit}）`,
      apply: (st) => { st.weapons.orbit += 1; },
    });
  }
  if (w.missile < 5) {
    pool.push({
      id: "missile", icon: "🚀", name: w.missile === 0 ? "追尾ミサイル 解放！" : "追尾ミサイル Lv+",
      desc: w.missile === 0 ? "敵を追うミサイルを定期発射" : `ミサイルの数と威力アップ（現在 Lv${w.missile}）`,
      apply: (st) => { st.weapons.missile += 1; },
    });
  }
  if (w.thunder < 5) {
    pool.push({
      id: "thunder", icon: "⚡", name: w.thunder === 0 ? "雷撃 解放！" : "雷撃 Lv+",
      desc: w.thunder === 0 ? "近くの敵に雷が落ちる範囲攻撃" : `雷の回数と威力アップ（現在 Lv${w.thunder}）`,
      apply: (st) => { st.weapons.thunder += 1; },
    });
  }
  if (w.speedLv < 5) {
    pool.push({
      id: "speed", icon: "👟", name: "移動速度アップ",
      desc: "足が速くなる（+8%）",
      apply: (st) => { st.weapons.speedLv += 1; },
    });
  }
  if (w.magnetLv < 5) {
    pool.push({
      id: "magnet", icon: "🧲", name: "磁石範囲アップ",
      desc: "🌾経験値を吸い寄せる範囲 +40%",
      apply: (st) => { st.weapons.magnetLv += 1; },
    });
  }
  pool.push({
    id: "hp", icon: "❤️", name: "最大HP+25＆回復",
    desc: "最大HPが増え、今すぐ25回復",
    apply: (st) => { st.maxHp += 25; st.hp = Math.min(st.maxHp, st.hp + 25); },
  });
  return pool;
}

function pickCards(s: S): Card[] {
  const pool = buildPool(s);
  const picks: Card[] = [];
  const copy = [...pool];
  while (picks.length < 3 && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    picks.push(copy.splice(i, 1)[0]);
  }
  if (picks.length === 0) {
    picks.push({
      id: "heal", icon: "🍙", name: "大回復",
      desc: "HPを40回復する",
      apply: (st) => { st.hp = Math.min(st.maxHp, st.hp + 40); },
    });
  }
  return picks;
}

const ENEMY_STYLE: Record<EnemyKind, { emoji: string; font: number }> = {
  crow: { emoji: "🐦", font: 30 },
  bat: { emoji: "🦇", font: 26 },
  cloud: { emoji: "🌩️", font: 52 },
  elite: { emoji: "🦅", font: 62 },
  boss: { emoji: "🌪️", font: 110 },
};

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function SurvivorsGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sRef = useRef<S>(freshState());
  const imgRef = useRef<HTMLImageElement | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const startedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [cards, setCards] = useState<Card[]>([]);
  const [result, setResult] = useState<{ time: number; kills: number; level: number; score: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { count, loaded, registerPlay } = usePlayCounter(SLUG);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  useEffect(() => {
    const img = new Image();
    img.src = "/mugi.webp";
    imgRef.current = img;
  }, []);

  const spawnEnemy = useCallback((s: S, kind: EnemyKind) => {
    const scale = 1 + s.time / 80;
    const spdScale = 1 + Math.min(0.5, s.time / 600);
    // プレイヤーの視界の外周に出現
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.hypot(VW, VH) / 2 + 60 + Math.random() * 80;
    const x = Math.min(WORLD - 30, Math.max(30, s.px + Math.cos(ang) * dist));
    const y = Math.min(WORLD - 30, Math.max(30, s.py + Math.sin(ang) * dist));
    const base = {
      crow: { hp: 16, spd: 80, dmg: 9, r: 16, xp: 1, score: 10 },
      bat: { hp: 9, spd: 130, dmg: 7, r: 13, xp: 1, score: 15 },
      cloud: { hp: 68, spd: 47, dmg: 16, r: 27, xp: 3, score: 30 },
      elite: { hp: 340, spd: 63, dmg: 20, r: 34, xp: 12, score: 300 },
      boss: { hp: 1500, spd: 41, dmg: 26, r: 54, xp: 40, score: 2000 },
    }[kind];
    s.enemies.push({
      id: s.nextId++, kind, x, y,
      hp: base.hp * scale, maxHp: base.hp * scale,
      spd: base.spd * spdScale * (0.9 + Math.random() * 0.2),
      dmg: base.dmg, r: base.r, xp: base.xp, score: base.score,
      flash: 0, orbitHitAt: 0,
    });
  }, []);

  const burst = useCallback((s: S, x: number, y: number, color: string, n: number, power = 130) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 30 + Math.random() * power;
      s.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0, maxLife: 0.35 + Math.random() * 0.3, color, size: 2 + Math.random() * 3,
      });
    }
  }, []);

  const damageEnemy = useCallback((s: S, e: Enemy, dmg: number) => {
    e.hp -= dmg;
    e.flash = 0.08;
    if (e.hp <= 0 && !e.deadFlag) {
      e.deadFlag = true;
      s.kills += 1;
      s.score += e.score;
      burst(s, e.x, e.y, e.kind === "cloud" || e.kind === "boss" ? "#8a93a6" : "#5b4a2f", e.kind === "boss" ? 40 : 10, e.kind === "boss" ? 240 : 140);
      sfx.play(e.kind === "boss" || e.kind === "elite" ? "boom" : "hit");
      // 経験値ドロップ
      let remaining = e.xp;
      while (remaining > 0) {
        const v = remaining >= 5 ? 5 : 1;
        remaining -= v;
        const a = Math.random() * Math.PI * 2;
        s.gems.push({ x: e.x + Math.cos(a) * 10, y: e.y + Math.sin(a) * 10, v, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 });
      }
      if (e.kind === "elite") s.heals.push({ x: e.x, y: e.y });
      if (e.kind === "boss") {
        s.heals.push({ x: e.x - 30, y: e.y }, { x: e.x + 30, y: e.y });
        s.shake = Math.max(s.shake, 14);
        sfx.play("clear");
      }
    }
  }, [burst]);

  const gainXp = useCallback((s: S, v: number) => {
    s.xp += v;
    sfx.play("pickup");
    if (s.xp >= s.xpNext) {
      s.xp -= s.xpNext;
      s.level += 1;
      s.xpNext = 6 + (s.level - 1) * 5;
      burst(s, s.px, s.py, "#ffd94d", 26, 190);
      sfx.play("levelup");
      setCards(pickCards(s));
      setPhaseBoth("levelup");
    }
  }, [burst, setPhaseBoth]);

  const endGame = useCallback((s: S) => {
    const score = s.score + Math.floor(s.time) * 5 + (s.level - 1) * 150;
    setResult({ time: s.time, kills: s.kills, level: s.level, score });
    pushHistory(HIST_KEY, score);
    setRefreshKey((k) => k + 1);
    sfx.play("gameover");
    setPhaseBoth("over");
  }, [setPhaseBoth]);

  const update = useCallback((s: S, dt: number) => {
    s.time += dt;
    const w = s.weapons;

    // ---- 移動 ----
    let mx = 0, my = 0;
    if (s.keys.has("arrowleft") || s.keys.has("a")) mx -= 1;
    if (s.keys.has("arrowright") || s.keys.has("d")) mx += 1;
    if (s.keys.has("arrowup") || s.keys.has("w")) my -= 1;
    if (s.keys.has("arrowdown") || s.keys.has("s")) my += 1;
    if (s.joy.active && (Math.abs(s.joy.dx) > 0.12 || Math.abs(s.joy.dy) > 0.12)) {
      mx = s.joy.dx; my = s.joy.dy;
    }
    const mlen = Math.hypot(mx, my);
    if (mlen > 0.01) {
      const spd = 200 * (1 + 0.08 * w.speedLv);
      s.px = Math.min(WORLD - PLAYER_R, Math.max(PLAYER_R, s.px + (mx / Math.max(1, mlen)) * spd * dt));
      s.py = Math.min(WORLD - PLAYER_R, Math.max(PLAYER_R, s.py + (my / Math.max(1, mlen)) * spd * dt));
      s.faceX = mx / Math.max(1, mlen); s.faceY = my / Math.max(1, mlen);
    }

    // ---- スポーン ----
    s.spawnCd -= dt;
    if (s.spawnCd <= 0 && s.enemies.length < 150) {
      s.spawnCd = Math.max(0.26, 1.05 - s.time * 0.0058);
      const batch = 1 + Math.floor(s.time / 45);
      for (let i = 0; i < batch; i++) {
        const roll = Math.random();
        let kind: EnemyKind = "crow";
        if (s.time > 55 && roll < 0.13) kind = "cloud";
        else if (s.time > 18 && roll < 0.4) kind = "bat";
        spawnEnemy(s, kind);
      }
    }
    if (s.time >= s.eliteAt) {
      s.eliteAt += 60;
      spawnEnemy(s, "elite");
      s.banner = "⚠️ エリート出現！";
      s.bannerUntil = s.time + 2;
    }
    if (s.time >= s.bossAt) {
      s.bossAt += 120;
      spawnEnemy(s, "boss");
      s.banner = "🌪️ ボス出現！！";
      s.bannerUntil = s.time + 2.5;
      s.shake = Math.max(s.shake, 10);
      sfx.play("thunder");
    }

    // ---- 基本ショット ----
    const shotDmg = 10 + 6 * w.dmgLv;
    const shotCdMax = 0.5 * Math.pow(0.9, w.rateLv);
    s.shotCd -= dt;
    if (s.shotCd <= 0) {
      // 最も近い敵を探す
      let target: Enemy | null = null;
      let best = 580;
      for (const e of s.enemies) {
        const d = Math.hypot(e.x - s.px, e.y - s.py);
        if (d < best) { best = d; target = e; }
      }
      if (target) {
        s.shotCd = shotCdMax;
        const baseAng = Math.atan2(target.y - s.py, target.x - s.px);
        const count = 1 + w.countLv;
        for (let i = 0; i < count; i++) {
          const off = (i - (count - 1) / 2) * 0.14;
          const a = baseAng + off;
          s.bullets.push({ x: s.px, y: s.py, vx: Math.cos(a) * 540, vy: Math.sin(a) * 540, dmg: shotDmg, life: 1.1 });
        }
        sfx.play("shoot");
      } else {
        s.shotCd = 0.08;
      }
    }

    // ---- 回転ガマ ----
    if (w.orbit > 0) {
      s.orbitAngle += dt * 2.7;
      const radius = 80;
      const bladeDmg = 12 + 5 * w.orbit;
      for (let i = 0; i < w.orbit; i++) {
        const a = s.orbitAngle + (i * Math.PI * 2) / w.orbit;
        const bx = s.px + Math.cos(a) * radius;
        const by = s.py + Math.sin(a) * radius;
        for (const e of s.enemies) {
          if (e.deadFlag) continue;
          if (s.time - e.orbitHitAt < 0.38) continue;
          if (Math.hypot(e.x - bx, e.y - by) < e.r + 20) {
            e.orbitHitAt = s.time;
            damageEnemy(s, e, bladeDmg);
          }
        }
      }
    }

    // ---- 追尾ミサイル ----
    if (w.missile > 0) {
      s.missileCd -= dt;
      if (s.missileCd <= 0 && s.enemies.length > 0) {
        s.missileCd = 1.7;
        for (let i = 0; i < w.missile; i++) {
          const e = s.enemies[Math.floor(Math.random() * s.enemies.length)];
          const a = Math.random() * Math.PI * 2;
          s.missiles.push({ x: s.px, y: s.py, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, targetId: e.id, dmg: 24 + 9 * w.missile, life: 3.5 });
        }
        sfx.play("shoot");
      }
    }

    // ---- 雷撃 ----
    if (w.thunder > 0) {
      s.thunderCd -= dt;
      if (s.thunderCd <= 0 && s.enemies.length > 0) {
        s.thunderCd = Math.max(1.6, 3.4 - 0.25 * w.thunder);
        const strikes = 1 + Math.floor(w.thunder / 2);
        const tdmg = 30 + 11 * w.thunder;
        const sorted = [...s.enemies]
          .filter((e) => Math.hypot(e.x - s.px, e.y - s.py) < 660)
          .sort((a, b) => b.hp - a.hp)
          .slice(0, strikes);
        for (const e of sorted) {
          s.texts.push({ x: e.x, y: e.y - e.r - 26, text: "⚡", life: 0, color: "#ffe14d" });
          burst(s, e.x, e.y, "#ffe14d", 8, 170);
          for (const t of s.enemies) {
            if (!t.deadFlag && Math.hypot(t.x - e.x, t.y - e.y) < 92 + t.r) damageEnemy(s, t, tdmg);
          }
        }
        if (sorted.length > 0) sfx.play("thunder");
      }
    }

    // ---- 弾の移動 ----
    for (const b of s.bullets) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      for (const e of s.enemies) {
        if (e.deadFlag || b.life <= 0) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + 5) {
          b.life = 0;
          damageEnemy(s, e, b.dmg);
          burst(s, b.x, b.y, "#fff3b0", 3, 90);
        }
      }
    }
    s.bullets = s.bullets.filter((b) => b.life > 0);

    // ---- ミサイルの移動 ----
    for (const m of s.missiles) {
      m.life -= dt;
      if (m.life <= 0) { m.targetId = -999; continue; }
      const t = s.enemies.find((e) => e.id === m.targetId && !e.deadFlag)
        ?? s.enemies.find((e) => !e.deadFlag);
      if (!t) {
        // 対象がいなければ直進して寿命で消える
        m.x += m.vx * dt; m.y += m.vy * dt;
        continue;
      }
      const want = Math.atan2(t.y - m.y, t.x - m.x);
      const cur = Math.atan2(m.vy, m.vx);
      let diff = want - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.max(-5.2 * dt, Math.min(5.2 * dt, diff));
      const na = cur + turn;
      const spd = Math.min(430, Math.hypot(m.vx, m.vy) + 620 * dt);
      m.vx = Math.cos(na) * spd; m.vy = Math.sin(na) * spd;
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (Math.hypot(t.x - m.x, t.y - m.y) < t.r + 12) {
        m.targetId = -999; // 爆発済みマーク
        burst(s, m.x, m.y, "#ff9f43", 14, 190);
        for (const e of s.enemies) {
          if (!e.deadFlag && Math.hypot(e.x - m.x, e.y - m.y) < 68 + e.r) damageEnemy(s, e, m.dmg);
        }
        sfx.play("boom");
      }
    }
    s.missiles = s.missiles.filter((m) => m.targetId !== -999 && Math.hypot(m.x - s.px, m.y - s.py) < 1400);

    // ---- 敵の移動と接触ダメージ ----
    for (const e of s.enemies) {
      if (e.deadFlag) continue;
      e.flash = Math.max(0, e.flash - dt);
      const d = Math.hypot(s.px - e.x, s.py - e.y) || 1;
      e.x += ((s.px - e.x) / d) * e.spd * dt;
      e.y += ((s.py - e.y) / d) * e.spd * dt;
      if (d < e.r + PLAYER_R && s.time >= s.invulnUntil) {
        s.hp -= e.dmg;
        s.invulnUntil = s.time + 0.6;
        s.shake = Math.max(s.shake, 7);
        sfx.play("hurt");
        burst(s, s.px, s.py, "#ff6b6b", 10, 150);
        if (s.hp <= 0) {
          s.hp = 0;
          endGame(s);
          return;
        }
      }
    }
    s.enemies = s.enemies.filter((e) => !e.deadFlag);

    // ---- 経験値ジェム ----
    const magnetR = 80 * Math.pow(1.4, w.magnetLv);
    const keptGems: Gem[] = [];
    for (const g of s.gems) {
      const d = Math.hypot(s.px - g.x, s.py - g.y);
      if (d < PLAYER_R + 12) {
        gainXp(s, g.v);
        continue;
      }
      if (d < magnetR) {
        const pull = 1500;
        g.vx += ((s.px - g.x) / (d || 1)) * pull * dt;
        g.vy += ((s.py - g.y) / (d || 1)) * pull * dt;
      }
      g.vx *= 0.88; g.vy *= 0.88;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      keptGems.push(g);
    }
    s.gems = keptGems;

    // ---- 回復アイテム ----
    for (const h of s.heals) {
      if (Math.hypot(s.px - h.x, s.py - h.y) < PLAYER_R + 18) {
        h.x = -9999;
        s.hp = Math.min(s.maxHp, s.hp + 30);
        s.texts.push({ x: s.px, y: s.py - 34, text: "+30", life: 0, color: "#3fbf5a" });
        sfx.play("pickup");
      }
    }
    s.heals = s.heals.filter((h) => h.x > -9000);

    // ---- パーティクル / テキスト ----
    for (const p of s.particles) {
      p.life += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
    }
    s.particles = s.particles.filter((p) => p.life < p.maxLife);
    for (const t of s.texts) { t.life += dt; t.y -= 34 * dt; }
    s.texts = s.texts.filter((t) => t.life < 0.8);
    s.shake = Math.max(0, s.shake - 26 * dt);
  }, [spawnEnemy, damageEnemy, gainXp, endGame, burst]);

  const draw = useCallback((s: S) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== VW * dpr) { canvas.width = VW * dpr; canvas.height = VH * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const shX = s.shake > 0 ? (Math.random() - 0.5) * s.shake : 0;
    const shY = s.shake > 0 ? (Math.random() - 0.5) * s.shake : 0;
    const camX = Math.min(WORLD - VW, Math.max(0, s.px - VW / 2)) + shX;
    const camY = Math.min(WORLD - VH, Math.max(0, s.py - VH / 2)) + shY;
    const toX = (wx: number) => wx - camX;
    const toY = (wy: number) => wy - camY;

    // 麦畑の背景
    ctx.fillStyle = "#c9dd7e";
    ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = "rgba(120, 90, 20, 0.10)";
    const cell = 90;
    const ix0 = Math.floor(camX / cell), ix1 = Math.floor((camX + VW) / cell);
    const iy0 = Math.floor(camY / cell), iy1 = Math.floor((camY + VH) / cell);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const h = Math.abs(Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453) % 1;
        const x = ix * cell + h * 40 - camX;
        const y = iy * cell + ((h * 7) % 1) * 40 - camY;
        ctx.beginPath();
        ctx.ellipse(x, y, 16 + h * 10, 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // ワールドの境界
    ctx.strokeStyle = "#7a5a1e";
    ctx.lineWidth = 8;
    ctx.strokeRect(-camX, -camY, WORLD, WORLD);

    // 経験値ジェム
    for (const g of s.gems) {
      ctx.font = g.v >= 5 ? "24px serif" : "16px serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🌾", toX(g.x), toY(g.y));
    }
    // 回復
    for (const h of s.heals) {
      ctx.font = "26px serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("❤️", toX(h.x), toY(h.y) + Math.sin(s.time * 4 + h.x) * 3);
    }
    // 敵
    for (const e of s.enemies) {
      const st = ENEMY_STYLE[e.kind];
      ctx.font = `${st.font}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(st.emoji, toX(e.x), toY(e.y));
      if (e.flash > 0) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(toX(e.x), toY(e.y), e.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if ((e.kind === "elite" || e.kind === "boss") && e.hp < e.maxHp) {
        const bw = e.r * 2;
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(toX(e.x) - bw / 2, toY(e.y) - e.r - 16, bw, 7);
        ctx.fillStyle = "#ff5252";
        ctx.fillRect(toX(e.x) - bw / 2, toY(e.y) - e.r - 16, bw * Math.max(0, e.hp / e.maxHp), 7);
      }
    }
    // 弾
    ctx.fillStyle = "#ffcf3f";
    for (const b of s.bullets) {
      ctx.beginPath(); ctx.arc(toX(b.x), toY(b.y), 5, 0, Math.PI * 2); ctx.fill();
    }
    // ミサイル
    for (const m of s.missiles) {
      ctx.save();
      ctx.translate(toX(m.x), toY(m.y));
      ctx.rotate(Math.atan2(m.vy, m.vx) + Math.PI / 4);
      ctx.font = "22px serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🚀", 0, 0);
      ctx.restore();
    }
    // 回転ガマ
    if (s.weapons.orbit > 0) {
      for (let i = 0; i < s.weapons.orbit; i++) {
        const a = s.orbitAngle + (i * Math.PI * 2) / s.weapons.orbit;
        const bx = s.px + Math.cos(a) * 80;
        const by = s.py + Math.sin(a) * 80;
        ctx.save();
        ctx.translate(toX(bx), toY(by));
        ctx.rotate(a + Math.PI / 2);
        ctx.font = "26px serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("🗡️", 0, 0);
        ctx.restore();
      }
    }
    // プレイヤー
    const blink = s.time < s.invulnUntil && Math.floor(s.time * 14) % 2 === 0;
    const img = imgRef.current;
    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.beginPath();
      ctx.arc(toX(s.px), toY(s.py), PLAYER_R + 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.clip();
      ctx.drawImage(img, toX(s.px) - PLAYER_R, toY(s.py) - PLAYER_R, PLAYER_R * 2, PLAYER_R * 2);
    } else {
      ctx.beginPath();
      ctx.arc(toX(s.px), toY(s.py), PLAYER_R, 0, Math.PI * 2);
      ctx.fillStyle = "#aee3ff"; ctx.fill();
      ctx.fillStyle = "#23405a";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("むぎ", toX(s.px), toY(s.py));
    }
    ctx.restore();
    // パーティクル
    for (const p of s.particles) {
      ctx.globalAlpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(toX(p.x), toY(p.y), p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // フローティングテキスト
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const t of s.texts) {
      ctx.globalAlpha = 1 - t.life / 0.8;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, toX(t.x), toY(t.y));
    }
    ctx.globalAlpha = 1;

    // ---- HUD ----
    // XPバー
    ctx.fillStyle = "rgba(20,40,60,0.55)";
    ctx.fillRect(0, 0, VW, 16);
    ctx.fillStyle = "#4db8e8";
    ctx.fillRect(0, 0, VW * Math.min(1, s.xp / s.xpNext), 16);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(`Lv ${s.level}`, 8, 9);
    // HPバー
    ctx.fillStyle = "rgba(20,40,60,0.55)";
    ctx.fillRect(10, 24, 250, 18);
    ctx.fillStyle = s.hp / s.maxHp < 0.3 ? "#ff5252" : "#3fbf5a";
    ctx.fillRect(12, 26, 246 * Math.max(0, s.hp / s.maxHp), 14);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(`HP ${Math.ceil(s.hp)} / ${s.maxHp}`, 18, 34);
    // タイマー
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(fmtTime(s.time), VW / 2, 36);
    // 撃破数
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`撃破 ${s.kills}`, VW - 12, 34);
    // 武器アイコン
    ctx.font = "15px sans-serif";
    ctx.textAlign = "left";
    const w = s.weapons;
    let wx = 10;
    const chips: string[] = [`🌾ショット Lv${1 + w.dmgLv + w.rateLv + w.countLv}`];
    if (w.orbit > 0) chips.push(`🗡️ガマ Lv${w.orbit}`);
    if (w.missile > 0) chips.push(`🚀ミサイル Lv${w.missile}`);
    if (w.thunder > 0) chips.push(`⚡雷撃 Lv${w.thunder}`);
    for (const c of chips) {
      const tw = ctx.measureText(c).width + 14;
      ctx.fillStyle = "rgba(20,40,60,0.5)";
      ctx.beginPath(); ctx.roundRect(wx, VH - 30, tw, 22, 11); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(c, wx + 7, VH - 18);
      wx += tw + 6;
    }
    // ボスHP
    const boss = s.enemies.find((e) => e.kind === "boss");
    if (boss) {
      ctx.fillStyle = "rgba(20,40,60,0.6)";
      ctx.fillRect(VW / 2 - 210, VH - 58, 420, 16);
      ctx.fillStyle = "#b388ff";
      ctx.fillRect(VW / 2 - 208, VH - 56, 416 * Math.max(0, boss.hp / boss.maxHp), 12);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🌪️ ボス", VW / 2, VH - 68);
    }
    // バナー
    if (s.time < s.bannerUntil && s.banner) {
      ctx.font = "bold 40px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff5252";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 6;
      const by = VH / 2 - 90;
      ctx.strokeText(s.banner, VW / 2, by);
      ctx.fillText(s.banner, VW / 2, by);
    }
    // ジョイスティック
    if (s.joy.active) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#23405a";
      ctx.beginPath(); ctx.arc(s.joy.ox, s.joy.oy, 52, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(s.joy.ox + s.joy.dx * 34, s.joy.oy + s.joy.dy * 34, 22, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // 低HP警告
    if (s.hp / s.maxHp < 0.25 && phaseRef.current === "playing") {
      ctx.strokeStyle = `rgba(255,60,60,${0.35 + 0.25 * Math.sin(s.time * 6)})`;
      ctx.lineWidth = 10;
      ctx.strokeRect(0, 0, VW, VH);
    }
  }, []);

  // メインループ
  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      const s = sRef.current;
      const dt = s.lastTs === 0 ? 0 : Math.min(0.033, (ts - s.lastTs) / 1000);
      s.lastTs = ts;
      if (phaseRef.current === "playing" && dt > 0) {
        update(s, dt);
        // レベルアップでフェーズが変わったらスティックを離す
        if (phaseRef.current !== "playing") s.joy.active = false;
      }
      draw(s);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [update, draw]);

  // キーボード
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) {
        if (phaseRef.current === "playing") e.preventDefault();
      }
      sRef.current.keys.add(k);
      if ((k === "p" || k === "escape")) {
        if (phaseRef.current === "playing") setPhaseBoth("paused");
        else if (phaseRef.current === "paused") setPhaseBoth("playing");
      }
    };
    const up = (e: KeyboardEvent) => { sRef.current.keys.delete(e.key.toLowerCase()); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [setPhaseBoth]);

  // 画面が隠れたら自動ポーズ
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && phaseRef.current === "playing") setPhaseBoth("paused");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [setPhaseBoth]);

  const startGame = useCallback(() => {
    sfx.unlock();
    sfx.play("click");
    sRef.current = freshState();
    startedRef.current = true;
    setResult(null);
    void registerPlay();
    setPhaseBoth("playing");
  }, [registerPlay, setPhaseBoth]);

  const chooseCard = useCallback((card: Card) => {
    card.apply(sRef.current);
    sfx.play("click");
    setPhaseBoth("playing");
  }, [setPhaseBoth]);

  const toView = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (VW / rect.width),
      y: (e.clientY - rect.top) * (VH / rect.height),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (phaseRef.current !== "playing") return;
    const v = toView(e);
    const s = sRef.current;
    s.joy = { active: true, id: e.pointerId, ox: v.x, oy: v.y, dx: 0, dy: 0 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = sRef.current;
    if (!s.joy.active || s.joy.id !== e.pointerId) return;
    const v = toView(e);
    let dx = (v.x - s.joy.ox) / 52;
    let dy = (v.y - s.joy.oy) / 52;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    s.joy.dx = dx; s.joy.dy = dy;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = sRef.current;
    if (s.joy.id === e.pointerId) { s.joy.active = false; s.joy.dx = 0; s.joy.dy = 0; }
  };

  const shareText = result
    ? `🌾『むぎサバイバーズ』で ${fmtTime(result.time)} 生き延びた！ 撃破${result.kills}・Lv${result.level}・スコア${result.score.toLocaleString()}点 でした⚔️ #むぎゲームズ ${SITE_URL}/games/survivors`
    : "";

  return (
    <div className="game-box">
      <PlayCountBadge count={count} loaded={loaded} />
      <div className="game-toolbar">
        <span className="toolbar-label">⚔️ むぎサバイバーズ</span>
        <span className="toolbar-btns">
          {phase === "playing" && (
            <button type="button" className="icon-btn" aria-label="ポーズ" onClick={() => setPhaseBoth("paused")}>⏸</button>
          )}
          {phase === "paused" && (
            <button type="button" className="icon-btn" aria-label="再開" onClick={() => setPhaseBoth("playing")}>▶️</button>
          )}
          <MuteButton />
        </span>
      </div>
      <div className="canvas-wrap wide">
        <canvas
          ref={canvasRef}
          width={VW}
          height={VH}
          className="game-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {phase === "idle" && (
          <div className="canvas-overlay">
            <p className="overlay-title">⚔️ むぎサバイバーズ</p>
            <p>
              押し寄せる敵の群れから生き延びろ！ 攻撃は自動。
              <br />
              🌾を集めてレベルアップし、3つの強化から1つ選んでビルドを育てよう。
              <br />
              60秒ごとにエリート、3分でボスが出現！
            </p>
            <button type="button" className="big-btn" onClick={startGame}>▶ スタート</button>
          </div>
        )}
        {phase === "levelup" && (
          <div className="canvas-overlay">
            <p className="overlay-title">🎉 レベルアップ！ 強化を1つ選ぼう</p>
            <div className="upgrade-cards">
              {cards.map((c) => (
                <button key={c.id} type="button" className="upgrade-card" onClick={() => chooseCard(c)}>
                  <span className="upgrade-icon">{c.icon}</span>
                  <span className="upgrade-name">{c.name}</span>
                  <span className="upgrade-desc">{c.desc}</span>
                </button>
              ))}
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
              <p className="result-title">ゲームオーバー…！</p>
              <p className="result-main">生存時間 <strong>{fmtTime(result.time)}</strong></p>
              <p className="result-sub">撃破 {result.kills} ／ Lv {result.level} ／ スコア {result.score.toLocaleString()}点</p>
              <div className="btn-row">
                <button type="button" className="big-btn" onClick={startGame}>🔄 もう一度</button>
                <ShareButton text={shareText} />
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="catch-help">
        PC：WASD／矢印キーで移動（攻撃は自動）｜ スマホ：画面ドラッグでバーチャルスティック ｜ P／Escでポーズ
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
