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

const SLUG = "sky-shooter";
const HIST_KEY = "mugi-games:sky:history";

const W = 480;
const H = 640;
const CORE_R = 6;

type Phase = "idle" | "playing" | "paused" | "over";
type EKind = "diver" | "sine" | "mid" | "carrier" | "weaver" | "mine" | "boss";
type Enemy = {
  id: number; kind: EKind; x: number; y: number; hp: number; maxHp: number;
  t: number; baseX: number; phase: number; fireT: number; score: number;
  pattern: number; patternT: number; burstT: number; deadFlag?: boolean; hitUntil?: number; formation?: number; aim?: number;
};
type Bullet = { x: number; y: number; vx: number; vy: number; enemy: boolean; grazed?: boolean; close?: boolean };
type Power = { x: number; y: number; kind: "P" | "S" | "B"; t: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; ring?: boolean };
type FloatText = { x: number; y: number; text: string; life: number; color: string };

type S = {
  chain: number; chainUntil: number; slow: number; slowCooldown: number; grazeSoundT: number; exhaustT: number; bank: number;
  formations: Map<number, { remaining: number; failed: boolean }>;
  time: number;
  stageTime: number;
  stage: number;
  score: number;
  graze: number;
  px: number; py: number;
  lives: number;
  bombs: number;
  power: number;
  shield: boolean;
  invulnUntil: number;
  fireT: number;
  enemies: Enemy[];
  bullets: Bullet[]; // 自機弾
  ebullets: Bullet[]; // 敵弾
  powers: Power[];
  particles: Particle[];
  texts: FloatText[];
  keys: Set<string>;
  pointer: { active: boolean; x: number; y: number };
  spawnT: number;
  midT: number;
  carrierT: number;
  bossSpawned: boolean;
  bossRef: number; // boss の id（-1 なら不在）
  banner: string;
  bannerUntil: number;
  flash: number;
  shake: number;
  bgScroll: number;
  powerCycle: number;
  nextId: number;
  lastTs: number;
};

function freshState(): S {
  return {
    chain: 0, chainUntil: 0, slow: 0, slowCooldown: 0, grazeSoundT: 0, exhaustT: 0, bank: 0, formations: new Map(),
    time: 0, stageTime: 0, stage: 1, score: 0, graze: 0,
    px: W / 2, py: H - 110,
    lives: 3, bombs: 3, power: 1, shield: false,
    invulnUntil: 0, fireT: 0,
    enemies: [], bullets: [], ebullets: [], powers: [], particles: [], texts: [],
    keys: new Set(), pointer: { active: false, x: 0, y: 0 },
    spawnT: 1, midT: 14, carrierT: 10,
    bossSpawned: false, bossRef: -1,
    banner: "STAGE 1 — TAKE OFF", bannerUntil: 2.8, flash: 0, shake: 0, bgScroll: 0,
    powerCycle: 0, nextId: 1, lastTs: 0,
  };
}

function multOf(graze: number): number {
  return 1 + Math.min(7, Math.floor(graze / 20));
}

const POWER_STYLE: Record<Power["kind"], { label: string; color: string; name: string }> = {
  P: { label: "P", color: "#ff9f43", name: "パワーアップ" },
  S: { label: "S", color: "#4db8e8", name: "シールド" },
  B: { label: "B", color: "#b388ff", name: "ボム+1" },
};

export default function SkyShooterGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sRef = useRef<S>(freshState());
  const imgRef = useRef<HTMLImageElement | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<{ score: number; stage: number; graze: number } | null>(null);
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

  const burst = useCallback((s: S, x: number, y: number, color: string, n: number, power = 150) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 30 + Math.random() * power;
      s.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0, maxLife: 0.3 + Math.random() * 0.35, color, size: 2 + Math.random() * 3,
      });
    }
  }, []);

  const addScore = useCallback((s: S, base: number) => {
    s.score += base * multOf(s.graze);
  }, []);

  const endGame = useCallback((s: S) => {
    setResult({ score: s.score, stage: s.stage, graze: s.graze });
    pushHistory(HIST_KEY, s.score);
    setRefreshKey((k) => k + 1);
    sfx.play("gameover");
    setPhaseBoth("over");
  }, [setPhaseBoth]);

  const killEnemy = useCallback((s: S, e: Enemy) => {
    if (e.deadFlag) return;
    e.deadFlag = true;
    s.chain = s.time < s.chainUntil ? s.chain + 1 : 1;
    s.chainUntil = s.time + 2.2;
    const chainMult = 1 + Math.min(3, Math.floor(s.chain / 5));
    addScore(s, e.score * chainMult);
    if (s.chain % 5 === 0) s.texts.push({ x: e.x, y: e.y - 20, text: `${s.chain} CHAIN ×${chainMult}`, life: 0, color: "#fff39b" });
    s.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, maxLife: 0.5, color: "#ffdc89", size: e.kind === "boss" ? 140 : 42, ring: true });
    if (e.formation !== undefined) {
      const f = s.formations.get(e.formation);
      if (f && --f.remaining === 0) {
        if (!f.failed) {
          const bonus = 800 * s.stage * multOf(s.graze);
          s.score += bonus;
          s.texts.push({ x: Math.max(120, Math.min(W - 120, e.x)), y: Math.max(100, e.y), text: `編隊撃破！ +${bonus}`, life: 0, color: "#fff39b" });
          s.powers.push({ x: e.x, y: Math.max(50, e.y), kind: (["P", "S", "B"] as const)[s.powerCycle++ % 3], t: 0 });
          sfx.play("pickup");
        }
        s.formations.delete(e.formation);
      }
    }
    burst(s, e.x, e.y, e.kind === "boss" ? "#b388ff" : "#ffb74d", e.kind === "boss" ? 46 : 12, e.kind === "boss" ? 260 : 160);
    sfx.play(e.kind === "boss" || e.kind === "mid" ? "boom" : "hit");
    if (e.kind === "carrier") {
      const kinds: Array<Power["kind"]> = ["P", "S", "B"];
      const kind = kinds[s.powerCycle % 3];
      s.powerCycle += 1;
      s.powers.push({ x: e.x, y: e.y, kind, t: 0 });
    }
    if (e.kind === "boss") {
      s.bossRef = -1;
      s.ebullets = [];
      s.flash = 0.7;
      s.shake = 16;
      const bonus = 5000 * s.stage;
      s.score += bonus;
      s.banner = `STAGE ${s.stage} CLEAR! +${bonus.toLocaleString()}`;
      s.bannerUntil = s.time + 2.4;
      sfx.play("clear");
      s.stage += 1;
      s.stageTime = 0;
      s.formations.clear();
      s.bossSpawned = false;
      s.spawnT = 2.5;
      s.midT = 14;
      s.carrierT = 9;
    }
  }, [addScore, burst]);

  const hitPlayer = useCallback((s: S) => {
    if (s.time < s.invulnUntil) return;
    if (s.shield) {
      s.shield = false;
      s.invulnUntil = s.time + 1.4;
      s.ebullets = s.ebullets.filter((b) => Math.hypot(b.x - s.px, b.y - s.py) > 110);
      burst(s, s.px, s.py, "#4db8e8", 16, 170);
      s.texts.push({ x: s.px, y: s.py - 30, text: "盾が吸収！ 無敵 1.4秒", life: 0, color: "#4db8e8" });
      sfx.play("freeze");
      return;
    }
    s.chain = 0;
    s.texts.push({ x: s.px, y: s.py - 40, text: "被弾！ 無敵 2秒", life: 0, color: "#fff" });
    s.lives -= 1;
    s.power = Math.max(1, s.power - 1);
    s.invulnUntil = s.time + 2;
    s.shake = Math.max(s.shake, 12);
    burst(s, s.px, s.py, "#ff6b6b", 24, 200);
    sfx.play("boom");
    if (s.lives <= 0) {
      endGame(s);
    }
  }, [burst, endGame]);

  const useBomb = useCallback(() => {
    const s = sRef.current;
    if (phaseRef.current !== "playing" || s.bombs <= 0) return;
    s.bombs -= 1;
    s.flash = 0.8;
    s.shake = 15;
    s.score += s.ebullets.length * 10;
    s.ebullets = [];
    for (const e of [...s.enemies]) {
      e.hp -= 50;
      if (e.hp <= 0 && !e.deadFlag) killEnemy(s, e);
    }
    s.enemies = s.enemies.filter((e) => !e.deadFlag);
    sfx.play("bomb");
  }, [killEnemy]);

  const spawnFormation = useCallback((s: S) => {
    const hpScale = 1 + (s.stage - 1) * 0.55;
    const first = s.enemies.length;
    const formation = s.nextId;
    const roll = Math.random();
    if (roll > 0.87 && s.stageTime > 18) {
      for (let i = 0; i < 3; i++) s.enemies.push({
        id: s.nextId++, kind: "weaver", x: 100 + i * 140, y: -40 - i * 42,
        hp: 6 * hpScale, maxHp: 6 * hpScale, t: 0, baseX: 100 + i * 140,
        phase: i, fireT: 1.8, score: 220, pattern: 0, patternT: 0, burstT: 0,
      });
    } else if (roll < 0.45) {
      // 横一列ダイバー
      const n = 5;
      const startX = 50 + Math.random() * 60;
      for (let i = 0; i < n; i++) {
        s.enemies.push({
          id: s.nextId++, kind: "diver", x: startX + i * 82, y: -30 - i * 6,
          hp: 2 * hpScale, maxHp: 2 * hpScale, t: 0, baseX: startX + i * 82,
          phase: Math.random() * 6, fireT: 0, score: 100, pattern: 0, patternT: 0, burstT: 0,
        });
      }
    } else if (roll < 0.8) {
      // サイン波フライヤー隊
      const fromLeft = Math.random() < 0.5;
      for (let i = 0; i < 4; i++) {
        s.enemies.push({
          id: s.nextId++, kind: "sine", x: fromLeft ? -30 - i * 56 : W + 30 + i * 56, y: 60 + i * 8,
          hp: 4 * hpScale, maxHp: 4 * hpScale, t: -i * 0.4, baseX: fromLeft ? -1 : 1,
          phase: i * 0.7, fireT: 0, score: 150, pattern: 0, patternT: 0, burstT: 0,
        });
      }
    } else {
      // V字ダイバー
      const cx = 90 + Math.random() * (W - 180);
      for (let i = -2; i <= 2; i++) {
        s.enemies.push({
          id: s.nextId++, kind: "diver", x: cx + i * 52, y: -30 - Math.abs(i) * 26,
          hp: 2 * hpScale, maxHp: 2 * hpScale, t: 0, baseX: cx + i * 52,
          phase: Math.random() * 6, fireT: 0, score: 100, pattern: 0, patternT: 0, burstT: 0,
        });
      }
    }
    const members = s.enemies.slice(first);
    for (const e of members) e.formation = formation;
    s.formations.set(formation, { remaining: members.length, failed: false });
  }, []);

  const spawnBoss = useCallback((s: S) => {
    const hp = 680 * (1 + (s.stage - 1) * 0.85);
    const id = s.nextId++;
    s.enemies.push({
      id, kind: "boss", x: W / 2, y: -70, hp, maxHp: hp, t: 0, baseX: W / 2,
      phase: 0, fireT: 0, score: 10000, pattern: 0, patternT: 0, burstT: 0,
    });
    s.bossRef = id;
    s.banner = `WARNING — 嵐の要塞`;
    s.bannerUntil = s.time + 2.2;
    sfx.play("thunder");
  }, []);

  const update = useCallback((s: S, dt: number) => {
    s.slow = Math.max(0, s.slow - dt);
    s.slowCooldown = Math.max(0, s.slowCooldown - dt);
    if (s.slow > 0) dt *= 0.48;
    const oldX = s.px;
    s.time += dt;
    if (s.time >= s.chainUntil) s.chain = 0;
    const previousStageTime = s.stageTime;
    s.stageTime += dt;
    if (s.stage > 1 && previousStageTime < 2.5 && s.stageTime >= 2.5) {
      s.banner = `STAGE ${s.stage} — TAKE OFF`; s.bannerUntil = s.time + 2;
    }
    s.bgScroll += dt * 46;
    const hpScale = 1 + (s.stage - 1) * 0.55;

    // ---- 自機移動 ----
    let mx = 0, my = 0;
    if (s.keys.has("arrowleft") || s.keys.has("a")) mx -= 1;
    if (s.keys.has("arrowright") || s.keys.has("d")) mx += 1;
    if (s.keys.has("arrowup") || s.keys.has("w")) my -= 1;
    if (s.keys.has("arrowdown") || s.keys.has("s")) my += 1;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      s.px += (mx / len) * 350 * dt;
      s.py += (my / len) * 350 * dt;
      s.pointer.active = false;
    } else if (s.pointer.active) {
      const tx = s.pointer.x;
      const ty = s.pointer.y - 56;
      const dx = tx - s.px, dy = ty - s.py;
      const d = Math.hypot(dx, dy);
      const step = Math.min(d, 900 * dt);
      if (d > 1) { s.px += (dx / d) * step; s.py += (dy / d) * step; }
    }
    s.px = Math.min(W - 16, Math.max(16, s.px));
    s.py = Math.min(H - 16, Math.max(40, s.py));

    s.bank += (Math.max(-0.35, Math.min(0.35, (s.px - oldX) * 0.06)) - s.bank) * Math.min(1, dt * 12);
    s.exhaustT -= dt;
    if (s.exhaustT <= 0) {
      s.exhaustT = 0.04;
      s.particles.push({ x: s.px, y: s.py + 23, vx: (Math.random() - 0.5) * 20, vy: 75, life: 0, maxLife: 0.28, color: "#cff4ff", size: 3 });
    }
    // ---- 自動発射 ----
    s.fireT -= dt;
    if (s.fireT <= 0) {
      s.fireT = 0.13;
      // { dx: 発射位置の横ずれ, ang: 角度（0=真上） }
      const patterns: Record<number, Array<{ dx: number; ang: number }>> = {
        1: [{ dx: 0, ang: 0 }],
        2: [{ dx: -9, ang: 0 }, { dx: 9, ang: 0 }],
        3: [{ dx: 0, ang: 0 }, { dx: -11, ang: 0 }, { dx: 11, ang: 0 }],
        4: [{ dx: 0, ang: 0 }, { dx: -11, ang: 0 }, { dx: 11, ang: 0 }, { dx: 0, ang: -0.17 }, { dx: 0, ang: 0.17 }],
        5: [{ dx: 0, ang: 0 }, { dx: -11, ang: 0 }, { dx: 11, ang: 0 }, { dx: 0, ang: -0.17 }, { dx: 0, ang: 0.17 }, { dx: 0, ang: -0.34 }, { dx: 0, ang: 0.34 }],
      };
      for (const sh of patterns[s.power] ?? patterns[1]) {
        s.bullets.push({
          x: s.px + sh.dx, y: s.py - 14,
          vx: Math.sin(sh.ang) * 640, vy: -Math.cos(sh.ang) * 640,
          enemy: false,
        });
      }
      sfx.play("shoot");
    }
    for (const b of s.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    s.bullets = s.bullets.filter((b) => b.y > -30 && b.x > -20 && b.x < W + 20);

    // ---- スポーン ----
    const bossAlive = s.bossRef !== -1;
    if (!bossAlive) {
      s.spawnT -= dt;
      if (s.spawnT <= 0 && s.stageTime > 2) {
        spawnFormation(s);
        s.spawnT = Math.max(0.85, 2.5 - s.stage * 0.16 - Math.min(0.65, s.stageTime / 100));
      }
      s.midT -= dt;
      if (s.midT <= 0 && s.stageTime > 8) {
        s.midT = 17;
        s.enemies.push({
          id: s.nextId++, kind: "mid", x: 80 + Math.random() * (W - 160), y: -40,
          hp: 44 * hpScale, maxHp: 44 * hpScale, t: 0, baseX: 0,
          phase: Math.random() * 6, fireT: 1.2, score: 800, pattern: 0, patternT: 0, burstT: 0,
        });
      }
      s.carrierT -= dt;
      if (s.carrierT <= 0) {
        s.carrierT = 23;
        s.enemies.push({
          id: s.nextId++, kind: "carrier", x: 60 + Math.random() * (W - 120), y: -40,
          hp: 26 * hpScale, maxHp: 26 * hpScale, t: 0, baseX: 0,
          phase: 0, fireT: 0, score: 500, pattern: 0, patternT: 0, burstT: 0,
        });
      }
      if (s.stageTime >= 78 && !s.bossSpawned) {
        s.bossSpawned = true;
        spawnBoss(s);
      }
    }

    // ---- 敵の更新 ----
    const bulletSpd = 112 + (s.stage - 1) * 16 + Math.min(28, s.stageTime * 0.36);
    for (const e of s.enemies) {
      if (e.deadFlag) continue;
      e.t += dt;
      if (e.kind === "diver") {
        e.y += (150 + s.stage * 8) * dt;
        e.x += Math.sin(e.t * 2 + e.phase) * 22 * dt;
      } else if (e.kind === "sine") {
        const dir = e.baseX; // -1: 左から右へ、1: 右から左へ
        e.x += (dir < 0 ? 105 : -105) * dt;
        e.y += 52 * dt + Math.sin(e.t * 4.2 + e.phase) * 46 * dt;
      } else if (e.kind === "mid") {
        if (e.y < 140) e.y += 95 * dt;
        else e.x += Math.sin(e.t * 0.8 + e.phase) * 65 * dt;
        e.fireT -= dt;
        if (e.fireT <= 0 && e.y > 20) {
          e.fireT = 1.7;
          const base = Math.atan2(s.py - e.y, s.px - e.x);
          for (const off of [-0.26, 0, 0.26]) {
            s.ebullets.push({ x: e.x, y: e.y + 14, vx: Math.cos(base + off) * bulletSpd, vy: Math.sin(base + off) * bulletSpd, enemy: true });
          }
          sfx.play("hit");
        }
      } else if (e.kind === "carrier") {
        e.y += 55 * dt;
        e.x += Math.sin(e.t * 1.4) * 18 * dt;
      } else if (e.kind === "weaver") {
        e.y += 65 * dt;
        e.x = e.baseX + Math.sin(e.t * 2 + e.phase) * 60;
        e.fireT -= dt;
        if (e.fireT <= 0 && e.y > 40 && e.y < H - 170) {
          e.fireT = 2.6;
          s.enemies.push({ id: s.nextId++, kind: "mine", x: e.x, y: e.y, hp: 3 * hpScale, maxHp: 3 * hpScale, t: 0, baseX: e.x, phase: 0, fireT: 3, score: 80, pattern: 0, patternT: 0, burstT: 0 });
        }
      } else if (e.kind === "mine") {
        e.y += 32 * dt;
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = 3;
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            s.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * bulletSpd * 0.65, vy: Math.sin(a) * bulletSpd * 0.65, enemy: true });
          }
        }
      } else if (e.kind === "boss") {
        if (e.y < 128) {
          e.y = Math.min(128, e.y + 62 * dt);
        } else {
          e.x = W / 2 + Math.sin(e.t * 0.55) * 110;
          const nextPhase = e.hp > e.maxHp * 0.67 ? 0 : e.hp > e.maxHp * 0.34 ? 1 : 2;
          if (nextPhase !== e.phase) {
            e.phase = nextPhase;
            const bonus = s.ebullets.length * 20;
            s.score += bonus;
            for (const b of s.ebullets.filter((_, i) => i % 5 === 0)) burst(s, b.x, b.y, "#ffe89b", 2, 45);
            s.ebullets = [];
            e.patternT = 0; e.burstT = 0;
            s.texts.push({ x: W / 2, y: 210, text: `PHASE ${e.phase + 1} 弾消し +${bonus}`, life: 0, color: "#ffe89b" });
            s.flash = 0.2;
          }
          e.patternT -= dt;
          if (e.patternT <= 0) {
            e.patternT = 5.2;
            e.fireT = 1.1;
            e.aim = Math.atan2(s.py - e.y, s.px - e.x);
            e.pattern += 1;
            sfx.play("warning");
            if (e.phase === 2) {
              for (const side of [-1, 1]) s.enemies.push({ id: s.nextId++, kind: "sine", x: e.x + side * 65, y: e.y + 20, hp: 5 * hpScale, maxHp: 5 * hpScale, t: 0, baseX: side, phase: 0, fireT: 1, score: 180, pattern: 0, patternT: 0, burstT: 0 });
            }
          }
          e.fireT -= dt;
          e.burstT -= dt;
          if (e.fireT <= 0 && e.burstT <= 0) {
            const speed = bulletSpd * (e.phase === 2 ? 0.95 : 0.85);
            e.burstT = e.phase === 0 ? 0.95 : e.phase === 1 ? 0.85 : 0.16;
            if (e.phase === 0) {
              for (let i = 0; i < 12; i++) {
                const a = i * Math.PI / 6 + e.pattern * 0.21;
                s.ebullets.push({ x: e.x, y: e.y + 20, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, enemy: true });
              }
            } else if (e.phase === 1) {
              // 固定した照準と、3スロットの隙間が回転するリング壁。
              for (let i = 0; i < 20; i++) {
                if (i >= 4 && i <= 6) continue;
                const a = i * Math.PI / 10 + e.pattern * 0.38 + Math.max(0, 4.1 - e.patternT) * 0.2;
                s.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * speed * 0.8, vy: Math.sin(a) * speed * 0.8, enemy: true });
              }
              const a = e.aim ?? Math.PI / 2;
              s.ebullets.push({ x: e.x, y: e.y + 24, vx: Math.cos(a) * speed * 1.4, vy: Math.sin(a) * speed * 1.4, enemy: true });
            } else {
              for (const offset of [0, Math.PI]) {
                const a = e.t * 2.6 + offset;
                s.ebullets.push({ x: e.x, y: e.y + 16, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, enemy: true });
              }
            }
          }
        }
      }
    }
    // 画面外の敵を除去
    for (const e of s.enemies) {
      const exitedSide = e.kind === "sine"
        ? (e.baseX < 0 ? e.x > W + 80 : e.x < -80)
        : e.x < -80 || e.x > W + 80;
      if (e.y > H + 60 || exitedSide) {
        if (e.kind !== "boss" && !e.deadFlag) {
          e.deadFlag = true;
          if (e.formation !== undefined) {
            const f = s.formations.get(e.formation);
            if (f) { f.failed = true; if (--f.remaining === 0) s.formations.delete(e.formation); }
          }
        }
      }
    }

    // ---- 自機弾と敵の当たり判定 ----
    for (const b of s.bullets) {
      for (const e of s.enemies) {
        if (e.deadFlag) continue;
        const er = e.kind === "boss" ? 52 : e.kind === "mid" ? 30 : e.kind === "carrier" ? 26 : 17;
        if (Math.hypot(e.x - b.x, e.y - b.y) < er + 4) {
          burst(s, b.x, b.y, "#fff3b0", 2, 70);
          b.y = -9999; // 消費済み（後段で除去）
          e.hp -= 1;
          e.hitUntil = s.time + 0.08;
          if (e.hp <= 0) killEnemy(s, e);
          break;
        }
      }
    }
    s.bullets = s.bullets.filter((b) => b.y > -100);
    s.enemies = s.enemies.filter((e) => !e.deadFlag);

    // ---- 敵弾 ----
    for (const b of s.ebullets) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      const d = Math.hypot(b.x - s.px, b.y - s.py);
      if (!b.grazed && d < 42 && d >= CORE_R + 5) {
        b.grazed = true;
        s.graze += 1;
        burst(s, (b.x + s.px) / 2, (b.y + s.py) / 2, "#fff5a4", 3, 60);
        if (s.time > s.grazeSoundT) {
          s.grazeSoundT = s.time + 0.09;
          sfx.play((`graze${Math.min(4, Math.floor((multOf(s.graze) - 1) / 2) + 1)}`) as "graze1" | "graze2" | "graze3" | "graze4");
        }
        if (s.graze % 20 === 0) {
          s.texts.push({ x: s.px, y: s.py - 34, text: `倍率 ×${multOf(s.graze)}！`, life: 0, color: "#ffd94d" });
          sfx.play("pickup");
        }
      }
      if (!b.close && d >= CORE_R + 5 && d < 19 && s.time >= s.invulnUntil) {
        b.close = true;
        if (s.slowCooldown <= 0) { s.slow = 0.16; s.slowCooldown = 1.2; }
      }
      if (d < CORE_R + 4.5 && s.time >= s.invulnUntil) {
        b.y = 99999;
        hitPlayer(s);
        if (phaseRef.current === "over") return;
      }
    }
    s.ebullets = s.ebullets.filter((b) => b.y < H + 30 && b.y > -40 && b.x > -30 && b.x < W + 30);

    // ---- 敵本体との衝突 ----
    if (s.time >= s.invulnUntil) {
      for (const e of s.enemies) {
        if (e.deadFlag) continue;
        const er = e.kind === "boss" ? 46 : 18;
        if (Math.hypot(e.x - s.px, e.y - s.py) < er + 10) {
          e.hp -= 6;
          if (e.hp <= 0) killEnemy(s, e);
          hitPlayer(s);
          if (phaseRef.current === "over") return;
          break;
        }
      }
      s.enemies = s.enemies.filter((e) => !e.deadFlag);
    }

    // ---- パワーアップ ----
    for (const p of s.powers) {
      p.t += dt;
      p.y += 92 * dt;
      p.x += Math.sin(p.t * 3) * 14 * dt;
      // ゆっくり自機へ寄る
      const d = Math.hypot(s.px - p.x, s.py - p.y);
      if (d < 90) { p.x += ((s.px - p.x) / (d || 1)) * 130 * dt; p.y += ((s.py - p.y) / (d || 1)) * 130 * dt; }
      if (d < 26) {
        p.y = 99999;
        if (p.kind === "P") {
          if (s.power >= 5) { s.score += 1000; s.texts.push({ x: s.px, y: s.py - 30, text: "+1000", life: 0, color: "#ff9f43" }); }
          else { s.power += 1; s.texts.push({ x: s.px, y: s.py - 30, text: "パワーアップ！", life: 0, color: "#ff9f43" }); }
        } else if (p.kind === "S") {
          if (s.shield) { s.score += 500; } else { s.shield = true; s.texts.push({ x: s.px, y: s.py - 30, text: "シールド！", life: 0, color: "#4db8e8" }); }
        } else {
          if (s.bombs >= 5) { s.score += 500; } else { s.bombs += 1; s.texts.push({ x: s.px, y: s.py - 30, text: "ボム+1", life: 0, color: "#b388ff" }); }
        }
        sfx.play("levelup");
      }
    }
    s.powers = s.powers.filter((p) => p.y < H + 30);

    // ---- エフェクト ----
    for (const p of s.particles) {
      p.life += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    s.particles = s.particles.filter((p) => p.life < p.maxLife).slice(-600);
    for (const t of s.texts) { t.life += dt; t.y -= 36 * dt; }
    s.texts = s.texts.filter((t) => t.life < 0.9);
    s.flash = Math.max(0, s.flash - 1.6 * dt);
    s.shake = Math.max(0, s.shake - 30 * dt);
  }, [spawnFormation, spawnBoss, killEnemy, hitPlayer]);

  const draw = useCallback((s: S) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s.shake > 0) {
      ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
    }

    // 空の背景（スクロールする雲）
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#7ec8f2");
    grad.addColorStop(1, "#dff3ff");
    ctx.fillStyle = grad;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.fillStyle = "rgba(77,139,114,0.17)";
    for (let i = 0; i < 12; i++) {
      const x = (i * 137) % W;
      const y = ((i * 211 + s.bgScroll * 0.3) % (H + 240)) - 120;
      ctx.beginPath(); ctx.ellipse(x, y, 75 + i % 3 * 17, 110, i * 0.7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    for (let i = 0; i < 7; i++) {
      const y = ((i * 173 + s.bgScroll * (1 + (i % 3) * 0.4)) % (H + 120)) - 60;
      const x = (i * 89) % W + Math.sin(i * 3.3) * 24;
      ctx.beginPath();
      ctx.ellipse(x, y, 44 + (i % 3) * 14, 15 + (i % 2) * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // パワーアップ
    for (const p of s.powers) {
      const st = POWER_STYLE[p.kind];
      ctx.fillStyle = st.color;
      ctx.beginPath(); ctx.roundRect(p.x - 13, p.y - 13, 26, 26, 7); ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(p.x - 13, p.y - 13, 26, 26, 7); ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(st.label, p.x, p.y + 1);
    }

    // ベクター機体。ローカル座標で傾きと回転部品を描く。
    for (const e of s.enemies) {
      ctx.save(); ctx.translate(e.x, e.y);
      ctx.rotate(e.kind === "boss" ? Math.sin(e.t) * 0.035 : Math.sin(e.t * 2 + e.phase) * 0.15);
      const hit = (e.hitUntil ?? 0) > s.time;
      ctx.fillStyle = hit ? "#fff" : e.kind === "boss" ? "#34435d" : "#df7258";
      ctx.strokeStyle = "#23374f"; ctx.lineWidth = 2;
      const ellipse = (x: number, y: number, rx: number, ry: number) => {
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      };
      const rotor = (x: number, y: number, r: number) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(e.t * 38);
        ctx.strokeStyle = "#deefff"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke(); ctx.restore();
      };
      if (e.kind === "boss") {
        // 嵐の要塞：装甲翼、発電塔、回転するコア。
        ctx.beginPath(); ctx.moveTo(-76, 18); ctx.lineTo(-62, -18); ctx.lineTo(-28, -10); ctx.lineTo(-20, -43); ctx.lineTo(20, -43); ctx.lineTo(28, -10); ctx.lineTo(62, -18); ctx.lineTo(76, 18); ctx.lineTo(38, 35); ctx.lineTo(-38, 35); ctx.closePath(); ctx.fill(); ctx.stroke();
        for (const x of [-52, 52]) {
          ctx.fillStyle = "#63768e"; ctx.fillRect(x - 12, -8, 24, 32);
          ctx.fillStyle = ["#8ff4ff", "#ffd276", "#ff88b9"][e.phase]; ellipse(x, 0, 8, 8); rotor(x, 0, 16);
        }
        ctx.fillStyle = hit ? "#fff" : "#1c2c48"; ellipse(0, 0, 29, 30);
        ctx.fillStyle = ["#8ff4ff", "#ffd276", "#ff88b9"][e.phase]; ellipse(0, 0, 15 + Math.sin(e.t * 6) * 2, 17);
        ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.moveTo(3, -14); ctx.lineTo(-6, 1); ctx.lineTo(5, 0); ctx.lineTo(-4, 15); ctx.stroke();
      } else if (e.kind === "carrier") {
        ctx.fillStyle = hit ? "#fff" : "#e9aa55"; ellipse(0, -12, 23, 29);
        ctx.strokeStyle = "#fff1c8";
        ctx.beginPath(); ctx.ellipse(0, -12, 9, 29, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-15, 9); ctx.lineTo(-10, 29); ctx.moveTo(15, 9); ctx.lineTo(10, 29); ctx.stroke();
        ctx.fillStyle = "#956c45"; ctx.fillRect(-12, 22, 24, 19); ctx.strokeRect(-12, 22, 24, 19);
        ctx.beginPath(); ctx.moveTo(-12, 22); ctx.lineTo(12, 41); ctx.moveTo(12, 22); ctx.lineTo(-12, 41); ctx.stroke();
      } else if (e.kind === "mid") {
        ctx.fillStyle = hit ? "#fff" : "#80becb"; ellipse(0, -7, 17, 16);
        ctx.fillStyle = hit ? "#fff" : "#606a8e"; ellipse(0, 5, 33, 12);
        for (const x of [-21, -7, 7, 21]) { ctx.fillStyle = "#ffe49b"; ellipse(x, 8, 3, 2); }
        rotor(0, -6, 23);
      } else if (e.kind === "mine") {
        ctx.rotate(e.t * 0.7);
        ctx.strokeStyle = e.fireT < 0.8 ? "#ff546b" : "#425775";
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10); ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20); ctx.stroke(); }
        ctx.fillStyle = hit ? "#fff" : "#425775"; ellipse(0, 0, 12, 12);
        ctx.fillStyle = e.fireT < 0.8 ? "#ff546b" : "#ffe49b"; ellipse(0, 0, 5, 5);
      } else if (e.kind === "sine" || e.kind === "weaver") {
        ctx.strokeStyle = "#344b64"; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(-21, -8); ctx.lineTo(21, 8); ctx.moveTo(21, -8); ctx.lineTo(-21, 8); ctx.stroke();
        ctx.fillStyle = hit ? "#fff" : e.kind === "weaver" ? "#b591cf" : "#78c8be"; ellipse(0, 0, 11, 16);
        for (const x of [-22, 22]) for (const y of [-10, 10]) { ellipse(x, y, 7, 5); rotor(x, y, 11); }
      } else {
        ctx.beginPath(); ctx.moveTo(0, 24); ctx.lineTo(-7, 7); ctx.lineTo(-26, 0); ctx.lineTo(-26, -7); ctx.lineTo(-6, -4); ctx.lineTo(-4, -22); ctx.lineTo(4, -22); ctx.lineTo(6, -4); ctx.lineTo(26, -7); ctx.lineTo(26, 0); ctx.lineTo(7, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#b9e9f8"; ellipse(0, 0, 4, 8); rotor(0, 21, 12);
      }
      ctx.restore();
      if (e.kind === "boss" && e.fireT > 0 && e.y >= 128) {
        ctx.save(); ctx.strokeStyle = "rgba(255,86,115,0.65)"; ctx.lineWidth = 2; ctx.setLineDash([9, 8]);
        const a = e.aim ?? Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(a) * 800, e.y + Math.sin(a) * 800); ctx.stroke();
        ctx.setLineDash([]);
        if (e.phase === 1) {
          const gap = e.pattern * 0.38 + Math.PI / 2;
          ctx.strokeStyle = "#69f4c5"; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(e.x, e.y, 82, gap - 0.42, gap + 0.42); ctx.stroke();
        }
        ctx.fillStyle = "#fff"; ctx.fillRect(70, 90, W - 140, 24);
        ctx.fillStyle = "#ac284c"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(["警告：放射バースト", "警告：狙撃＋回転壁 / 隙間へ", "警告：二重螺旋＋子機召喚"][e.phase], W / 2, 107); ctx.restore();
      }
      if (e.hp < e.maxHp && (e.kind === "mid" || e.kind === "carrier")) {
        ctx.fillStyle = "#293c58"; ctx.fillRect(e.x - 26, e.y - 40, 52, 4);
        ctx.fillStyle = "#ffce79"; ctx.fillRect(e.x - 26, e.y - 40, 52 * Math.max(0, e.hp / e.maxHp), 4);
      }
    }

    // 自機弾
    ctx.fillStyle = "#ffcf3f";
    for (const b of s.bullets) {
      ctx.beginPath(); ctx.ellipse(b.x, b.y, 3.4, 8, 0, 0, Math.PI * 2); ctx.fill();
    }
    // 敵弾
    for (const b of s.ebullets) {
      ctx.fillStyle = "#ff5d8f";
      ctx.beginPath(); ctx.arc(b.x, b.y, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd3e4";
      ctx.beginPath(); ctx.arc(b.x, b.y, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    // かすり範囲の目安（うっすら）
    // 自機
    const blink = s.time < s.invulnUntil && Math.floor(s.time * 14) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.3 : 1;
    ctx.translate(s.px, s.py); ctx.rotate(s.bank); ctx.translate(-s.px, -s.py);
    // 翼
    ctx.fillStyle = "#4db8e8";
    ctx.beginPath();
    ctx.moveTo(s.px - 6, s.py + 4);
    ctx.lineTo(s.px - 30, s.py + 16);
    ctx.lineTo(s.px - 6, s.py + 16);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s.px + 6, s.py + 4);
    ctx.lineTo(s.px + 30, s.py + 16);
    ctx.lineTo(s.px + 6, s.py + 16);
    ctx.closePath(); ctx.fill();
    // 噴射炎
    ctx.fillStyle = `rgba(255,${150 + Math.floor(Math.random() * 80)},60,0.9)`;
    ctx.beginPath();
    ctx.moveTo(s.px - 5, s.py + 17);
    ctx.lineTo(s.px, s.py + 27 + Math.random() * 7);
    ctx.lineTo(s.px + 5, s.py + 17);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#eafaff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(s.px - Math.cos(s.time * 65) * 24, s.py - 22); ctx.lineTo(s.px + Math.cos(s.time * 65) * 24, s.py - 22); ctx.stroke();
    if (s.fireT > 0.09) {
      ctx.fillStyle = "#fff5ab"; ctx.beginPath(); ctx.ellipse(s.px, s.py - 25, 7, 12, 0, 0, Math.PI * 2); ctx.fill();
    }
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.beginPath();
      ctx.arc(s.px, s.py, 17, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.clip();
      ctx.drawImage(img, s.px - 16, s.py - 16, 32, 32);
    } else {
      ctx.beginPath();
      ctx.arc(s.px, s.py, 16, 0, Math.PI * 2);
      ctx.fillStyle = "#aee3ff"; ctx.fill();
    }
    ctx.restore();
    // コア
    ctx.fillStyle = "#ff5252";
    ctx.beginPath(); ctx.arc(s.px, s.py, 3, 0, Math.PI * 2); ctx.fill();
    if (s.time < s.invulnUntil) {
      ctx.strokeStyle = "#fff4a1"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.px, s.py, 31, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, (s.invulnUntil - s.time) / 2)); ctx.stroke();
    }
    // シールド
    if (s.shield) {
      const bubble = ctx.createRadialGradient(s.px - 10, s.py - 12, 2, s.px, s.py, 29);
      bubble.addColorStop(0, "rgba(240,255,255,0.5)"); bubble.addColorStop(0.65, "rgba(77,184,232,0.08)"); bubble.addColorStop(1, "rgba(77,184,232,0.5)");
      ctx.fillStyle = bubble; ctx.beginPath(); ctx.arc(s.px, s.py, 29, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(77,184,232,${0.6 + 0.3 * Math.sin(s.time * 5)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.px, s.py, 25, 0, Math.PI * 2); ctx.stroke();
    }

    // パーティクル
    for (const p of s.particles) {
      ctx.globalAlpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = p.color;
      if (p.ring) {
        ctx.strokeStyle = p.color; ctx.lineWidth = 3 * (1 - p.life / p.maxLife);
        ctx.beginPath(); ctx.arc(p.x, p.y, 4 + p.size * p.life / p.maxLife, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 9); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    // テキスト
    ctx.font = "bold 17px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const t of s.texts) {
      ctx.globalAlpha = 1 - t.life / 0.9;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // ---- HUD ----
    ctx.fillStyle = "rgba(20,40,60,0.55)";
    ctx.fillRect(0, 0, W, 40);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(`SCORE ${s.score.toLocaleString()}`, 10, 13);
    ctx.fillText(`×${multOf(s.graze)} かすり${s.graze}`, 10, 31);
    ctx.textAlign = "right";
    ctx.fillText(`STAGE ${s.stage}`, W - 10, 13);
    ctx.fillText(`💣×${s.bombs}  ❤️×${s.lives}`, W - 10, 31);
    ctx.textAlign = "center"; ctx.font = "bold 12px sans-serif";
    ctx.fillStyle = "rgba(20,40,60,0.65)"; ctx.fillRect(0, H - 27, W, 27);
    ctx.fillStyle = s.chain ? "#fff39b" : "#fff";
    ctx.fillText(`${s.chain} CHAIN ×${1 + Math.min(3, Math.floor(s.chain / 5))}  |  P${s.power}  |  ${s.shield ? "盾：1回吸収" : "盾なし"}${s.time < s.invulnUntil ? `  無敵 ${(s.invulnUntil - s.time).toFixed(1)}秒` : ""}`, W / 2, H - 13);
    if (s.chain) { ctx.fillStyle = "#fff39b"; ctx.fillRect(0, H - 3, W * Math.max(0, (s.chainUntil - s.time) / 2.2), 3); }
    // ボスHP
    const boss = s.enemies.find((e) => e.kind === "boss");
    if (boss) {
      ctx.fillStyle = "rgba(20,40,60,0.6)";
      ctx.fillRect(40, 48, W - 80, 12);
      ctx.fillStyle = "#b388ff";
      ctx.fillRect(42, 50, (W - 84) * Math.max(0, boss.hp / boss.maxHp), 8);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`嵐の要塞 / PHASE ${boss.phase + 1}`, W / 2, 72);
      ctx.fillStyle = "#fff";
      for (const ratio of [0.34, 0.67]) ctx.fillRect(42 + (W - 84) * ratio, 48, 2, 12);
    }
    // バナー
    if (s.time < s.bannerUntil && s.banner) {
      ctx.fillStyle = "rgba(19,40,66,0.76)";
      ctx.fillRect(0, H / 2 - 95, W, 66);
      ctx.fillStyle = "#ffdc89"; ctx.fillRect(0, H / 2 - 95, W, 2); ctx.fillRect(0, H / 2 - 30, W, 2);
      ctx.font = "bold 23px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff5252";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 6;
      ctx.strokeText(s.banner, W / 2, H / 2 - 60);
      ctx.fillText(s.banner, W / 2, H / 2 - 60);
    }
    // ボムフラッシュ
    if (s.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${s.flash * 0.75})`;
      ctx.fillRect(0, 0, W, H);
    }
  }, []);

  // メインループ
  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      const s = sRef.current;
      const dt = s.lastTs === 0 ? 0 : Math.min(0.033, (ts - s.lastTs) / 1000);
      s.lastTs = ts;
      if (phaseRef.current === "playing" && dt > 0) update(s, dt);
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
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k) && phaseRef.current === "playing") {
        e.preventDefault();
      }
      sRef.current.keys.add(k);
      if (k === " " && !e.repeat) useBomb();
      if (!e.repeat && (k === "p" || k === "escape")) {
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
  }, [setPhaseBoth, useBomb]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        sRef.current.keys.clear(); sRef.current.pointer.active = false;
        if (phaseRef.current === "playing") setPhaseBoth("paused");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [setPhaseBoth]);

  const startGame = useCallback(() => {
    sfx.unlock();
    sfx.play("click");
    sRef.current = freshState();
    setResult(null);
    void registerPlay();
    setPhaseBoth("playing");
  }, [registerPlay, setPhaseBoth]);

  const toGame = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height),
    };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const v = toGame(e);
    const s = sRef.current;
    s.pointer = { active: true, x: v.x, y: v.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!sRef.current.pointer.active) return;
    const v = toGame(e);
    sRef.current.pointer.x = v.x;
    sRef.current.pointer.y = v.y;
  };
  const onPointerUp = () => { sRef.current.pointer.active = false; };

  const shareText = result
    ? `✈️『むぎスカイ』で STAGE ${result.stage} 到達！ スコア${result.score.toLocaleString()}点・かすり${result.graze}回 でした🌾 #むぎゲームズ ${SITE_URL}/games/sky-shooter`
    : "";

  return (
    <div className="game-box">
      <PlayCountBadge count={count} loaded={loaded} />
      <div className="game-toolbar">
        <span className="toolbar-label">✈️ むぎスカイ</span>
        <span className="toolbar-btns">
          {phase === "playing" && (
            <button type="button" className="chip-btn bomb" onClick={useBomb}>💣 ボム</button>
          )}
          {phase === "playing" && (
            <button type="button" className="icon-btn" aria-label="ポーズ" onClick={() => setPhaseBoth("paused")}>⏸</button>
          )}
          {phase === "paused" && (
            <button type="button" className="icon-btn" aria-label="再開" onClick={() => setPhaseBoth("playing")}>▶️</button>
          )}
          <MuteButton />
        </span>
      </div>
      <div className="canvas-wrap sky">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="game-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {phase === "idle" && (
          <div className="canvas-overlay">
            <p className="overlay-title">✈️ むぎスカイ</p>
            <p>
              むぎが飛行機で出撃！ ショットは自動。
              <br />
              かすりで最大×8。連続撃破と編隊全滅でボーナス！
              <br />
              🎈運搬機を落とすと P（火力）/ S（盾）/ B（ボム）。
              <br />
              ステージ終盤にはボス🌩️が待ち構える！
            </p>
            <button type="button" className="big-btn" onClick={startGame}>▶ 出撃！</button>
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
              <p className="result-title">撃墜されちゃった…！</p>
              <p className="result-main">スコア <strong>{result.score.toLocaleString()}</strong></p>
              <p className="result-sub">STAGE {result.stage} 到達 ／ かすり {result.graze}回</p>
              <div className="btn-row">
                <button type="button" className="big-btn" onClick={startGame}>🔄 もう一度</button>
                <ShareButton text={shareText} />
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="catch-help">
        PC：WASD／矢印キーで移動、Spaceでボム ｜ スマホ：ドラッグで移動（指の少し上に自機が出ます）、ボムはボタン
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
