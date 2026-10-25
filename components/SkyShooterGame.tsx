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
type EKind = "diver" | "sine" | "mid" | "carrier" | "boss";
type Enemy = {
  id: number; kind: EKind; x: number; y: number; hp: number; maxHp: number;
  t: number; baseX: number; phase: number; fireT: number; score: number;
  pattern: number; patternT: number; burstT: number; deadFlag?: boolean;
};
type Bullet = { x: number; y: number; vx: number; vy: number; enemy: boolean; grazed?: boolean };
type Power = { x: number; y: number; kind: "P" | "S" | "B"; t: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number };
type FloatText = { x: number; y: number; text: string; life: number; color: string };

type S = {
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
    time: 0, stageTime: 0, stage: 1, score: 0, graze: 0,
    px: W / 2, py: H - 110,
    lives: 3, bombs: 3, power: 1, shield: false,
    invulnUntil: 0, fireT: 0,
    enemies: [], bullets: [], ebullets: [], powers: [], particles: [], texts: [],
    keys: new Set(), pointer: { active: false, x: 0, y: 0 },
    spawnT: 1, midT: 14, carrierT: 10,
    bossSpawned: false, bossRef: -1,
    banner: "", bannerUntil: 0, flash: 0, shake: 0, bgScroll: 0,
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
    e.deadFlag = true;
    addScore(s, e.score);
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
      s.texts.push({ x: s.px, y: s.py - 30, text: "シールド！", life: 0, color: "#4db8e8" });
      sfx.play("freeze");
      return;
    }
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
    const roll = Math.random();
    if (roll < 0.45) {
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
  }, []);

  const spawnBoss = useCallback((s: S) => {
    const hp = 680 * (1 + (s.stage - 1) * 0.85);
    const id = s.nextId++;
    s.enemies.push({
      id, kind: "boss", x: W / 2, y: -70, hp, maxHp: hp, t: 0, baseX: W / 2,
      phase: 0, fireT: 0, score: 10000, pattern: 0, patternT: 2.2, burstT: 0,
    });
    s.bossRef = id;
    s.banner = `⚠️ STAGE ${s.stage} ボス出現！`;
    s.bannerUntil = s.time + 2.2;
    sfx.play("thunder");
  }, []);

  const update = useCallback((s: S, dt: number) => {
    s.time += dt;
    s.stageTime += dt;
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
        s.spawnT = Math.max(0.62, 1.18 - s.stage * 0.05);
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
    const bulletSpd = 165 + s.stage * 9;
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
      } else if (e.kind === "boss") {
        if (e.y < 128) {
          e.y += 62 * dt;
        } else {
          e.x = W / 2 + Math.sin(e.t * 0.55) * 120;
          e.patternT -= dt;
          if (e.patternT <= 0) {
            e.pattern = (e.pattern + 1) % (e.hp < e.maxHp * 0.55 ? 3 : 2);
            e.patternT = e.pattern === 2 ? 3.2 : 2.6;
            e.burstT = 0;
          }
          e.burstT -= dt;
          if (e.pattern === 0 && e.burstT <= 0) {
            // 放射バースト
            e.burstT = 0.75;
            const n = 16;
            const off = e.t * 0.9;
            for (let i = 0; i < n; i++) {
              const a = off + (i * Math.PI * 2) / n;
              s.ebullets.push({ x: e.x, y: e.y + 20, vx: Math.cos(a) * 132, vy: Math.sin(a) * 132, enemy: true });
            }
            sfx.play("thunder");
          } else if (e.pattern === 1 && e.burstT <= 0) {
            // 狙撃5ウェイ
            e.burstT = 0.38;
            const base = Math.atan2(s.py - e.y, s.px - e.x);
            for (const off of [-0.34, -0.17, 0, 0.17, 0.34]) {
              s.ebullets.push({ x: e.x, y: e.y + 24, vx: Math.cos(base + off) * (bulletSpd + 30), vy: Math.sin(base + off) * (bulletSpd + 30), enemy: true });
            }
            sfx.play("hit");
          } else if (e.pattern === 2) {
            // スパイラル連射
            if (e.burstT <= 0) {
              e.burstT = 0.09;
              for (const sgn of [0, Math.PI]) {
                const a = e.t * 3.4 + sgn;
                s.ebullets.push({ x: e.x, y: e.y + 16, vx: Math.cos(a) * 148, vy: Math.sin(a) * 148, enemy: true });
              }
            }
          }
        }
      }
    }
    // 画面外の敵を除去
    for (const e of s.enemies) {
      if (e.y > H + 60 || e.x < -80 || e.x > W + 80) {
        if (e.kind !== "boss") e.deadFlag = true;
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
        if (s.graze % 20 === 0) {
          s.texts.push({ x: s.px, y: s.py - 34, text: `倍率 ×${multOf(s.graze)}！`, life: 0, color: "#ffd94d" });
          sfx.play("pickup");
        }
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
    s.particles = s.particles.filter((p) => p.life < p.maxLife);
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
    ctx.fillStyle = "rgba(255,255,255,0.75)";
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

    // 敵
    for (const e of s.enemies) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (e.kind === "boss") {
        ctx.fillStyle = "rgba(90,60,140,0.9)";
        ctx.beginPath(); ctx.arc(e.x, e.y, 54, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ffd94d";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(e.x, e.y, 54 + Math.sin(e.t * 3) * 3, 0, Math.PI * 2); ctx.stroke();
        ctx.font = "64px serif";
        ctx.fillText("🌩️", e.x, e.y + 2);
      } else {
        const emoji = { diver: "🐦", sine: "🦇", mid: "🛸", carrier: "🎈" }[e.kind];
        const font = { diver: 30, sine: 28, mid: 52, carrier: 42 }[e.kind];
        ctx.font = `${font}px serif`;
        ctx.fillText(emoji, e.x, e.y);
        if (e.hp < e.maxHp && (e.kind === "mid" || e.kind === "carrier")) {
          const bw = 52;
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(e.x - bw / 2, e.y - 34, bw, 5);
          ctx.fillStyle = "#ff5252";
          ctx.fillRect(e.x - bw / 2, e.y - 34, bw * Math.max(0, e.hp / e.maxHp), 5);
        }
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
    // シールド
    if (s.shield) {
      ctx.strokeStyle = `rgba(77,184,232,${0.6 + 0.3 * Math.sin(s.time * 5)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.px, s.py, 25, 0, Math.PI * 2); ctx.stroke();
    }

    // パーティクル
    for (const p of s.particles) {
      ctx.globalAlpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
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
      ctx.fillText("🌩️ ボス", W / 2, 72);
    }
    // バナー
    if (s.time < s.bannerUntil && s.banner) {
      ctx.font = "bold 30px sans-serif";
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
      if (k === " ") useBomb();
      if (k === "p" || k === "escape") {
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
      if (document.hidden && phaseRef.current === "playing") setPhaseBoth("paused");
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
              敵弾を「かすり」続けるとスコア倍率アップ。
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
