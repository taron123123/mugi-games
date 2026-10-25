import * as Phaser from "phaser";
import { sfx } from "../sfx";
import {
  attachDprResize,
  baseGameConfig,
  ensureDot,
  genTex,
  ImagePool,
  ParticlePool,
  TextPool,
} from "./common";
import {
  BALANCE,
  BASE_HP,
  COLS,
  PATH_CELLS,
  PATH_SEGMENTS,
  ROWS,
  TOWERS,
  enemyBase,
  towerStats,
  upgradeCost,
  waveHpMultiplier,
  waveName,
  waveQueue,
  type EKind,
  type TowerKind,
} from "./tdData";

export type TdPhase = "build" | "playing" | "paused" | "over";
export type TdHud = {
  wheat: number;
  baseHp: number;
  wave: number;
  waveActive: boolean;
  remain: number;
};
export type TdTowerInfo = {
  id: number;
  kind: TowerKind;
  lv: number;
  dmg: number;
  range: number;
  rate: number;
  nextDmg: number | null;
  nextRange: number | null;
  nextRate: number | null;
  upgradeCost: number | null;
  sellValue: number;
};

export interface TdHooks {
  onPhase(p: TdPhase): void;
  onHud(h: TdHud): void;
  onSelectTower(info: TdTowerInfo | null): void;
  onGameOver(r: { wave: number; kills: number; score: number }): void;
  getSelectedKind(): TowerKind;
}

export interface TdApi {
  start(): void;
  beginFromBuild(): void;
  startWave(): void;
  pause(): void;
  resume(): void;
  setSpeed(n: number): void;
  setAutoStart(b: boolean): void;
  upgradeSelected(): void;
  sellSelected(): void;
  closeSelection(): void;
  relayout(): void;
  autoPause(): void;
}

export type TdInsets = { top: number; bottom: number };

type TowerE = {
  cont: Phaser.GameObjects.Container;
  rotor: Phaser.GameObjects.Image | null;
  id: number;
  kind: TowerKind;
  c: number;
  r: number;
  lv: number;
  invested: number;
  cd: number;
};
type EnemyE = {
  img: Phaser.GameObjects.Image;
  id: number;
  kind: EKind;
  dist: number;
  hp: number;
  maxHp: number;
  spd: number;
  bounty: number;
  leak: number;
  r: number;
  wetUntil: number;
  enraged: boolean;
  slowUntil: number;
  slowFactor: number;
  dead: boolean;
};
type ProjE = { img: Phaser.GameObjects.Image; targetId: number; dmg: number; kind: TowerKind; slow?: number; dead: boolean };
type BoltE = { pts: { x: number; y: number }[]; ttl: number };

class TowerDefenseScene extends Phaser.Scene {
  hooks!: TdHooks;
  insets: TdInsets = { top: 64, bottom: 150 };

  phase: TdPhase = "build";
  gtime = 0;
  animTime = 0;
  wheat = BALANCE.initialWheat;
  baseHp = BASE_HP;
  wave = 0;
  kills = 0;
  totalEarned = 0;
  towers: TowerE[] = [];
  enemies: EnemyE[] = [];
  projs: ProjE[] = [];
  bolts: BoltE[] = [];
  queue: EKind[] = [];
  waveTotal = 0;
  spawnCd = 0;
  waveActive = false;
  autoTimer = 0;
  autoStart = false;
  speed = 1;
  bannerText = "";
  bannerUntil = 0;
  hitUntil = 0;
  invalidAt = -9;
  invalidCell = "";
  hover: { c: number; r: number } | null = null;
  selectedId: number | null = null;
  nextId = 1;
  hudDirty = true;

  // レイアウト
  cell = 56;
  ox = 0;
  oy = 0;
  waypoints: { x: number; y: number }[] = [];
  segLen: number[] = [];
  pathTotal = 1;

  fieldG!: Phaser.GameObjects.Graphics;
  fxG!: Phaser.GameObjects.Graphics;
  bannerObj!: Phaser.GameObjects.Text;
  entranceLabel!: Phaser.GameObjects.Text;
  ghostImg!: Phaser.GameObjects.Image;
  booted = false;
  autoStartOnBoot = false;
  projPool!: ImagePool;
  particlePool!: ParticlePool;
  texts!: TextPool;

  constructor() {
    super("tower-defense");
  }

  create(): void {
    this.createTextures();
    ensureDot(this);
    this.fieldG = this.add.graphics().setDepth(0);
    this.fxG = this.add.graphics().setDepth(40);
    this.ghostImg = this.add.image(0, 0, "tower-scarecrow").setDepth(18).setAlpha(0.65).setVisible(false);
    this.bannerObj = this.add
      .text(0, 0, "", { fontFamily: "sans-serif", fontStyle: "bold", fontSize: "30px", resolution: 2, color: "#ffffff" })
      .setOrigin(0.5)
      .setStroke("rgba(35,64,90,0.9)", 6)
      .setDepth(90)
      .setVisible(false);
    this.entranceLabel = this.add
      .text(0, 0, "入口 →", { fontFamily: "sans-serif", fontStyle: "bold", fontSize: "12px", resolution: 2, color: "#4b4227" })
      .setDepth(5);
    this.projPool = new ImagePool(this, "tex-dot", 25);
    this.particlePool = new ParticlePool(new ImagePool(this, "tex-dot", 35));
    this.texts = new TextPool(this, 60, 15);
    this.computeLayout(false);
    this.drawField();
    this.setupInput();
    this.scale.on("resize", () => {
      this.computeLayout(true);
      this.drawField();
    });
    this.resetState();
    this.booted = true;
    if (this.autoStartOnBoot) {
      this.autoStartOnBoot = false;
      this.beginFromBuild();
    }
  }

  createTextures(): void {
    const SS = 2;
    const towerTex = (kind: TowerKind, draw: (g: Phaser.GameObjects.Graphics, c: number) => void) => {
      genTex(this, `tower-${kind}`, 112 * SS, 112 * SS, (g) => {
        g.save();
        g.scaleCanvas(SS, SS);
        draw(g, 56);
        g.restore();
      });
    };
    const base = (g: Phaser.GameObjects.Graphics, c: number) => {
      g.fillStyle(0x536b48, 1);
      g.fillEllipse(c, c + 20, 48, 15);
      g.fillStyle(0xd8c394, 1);
      g.fillRect(c - 18, c + 11, 36, 9);
    };
    towerTex("scarecrow", (g, c) => {
      base(g, c);
      g.lineStyle(5, 0x80552f, 1);
      g.lineBetween(c, c + 14, c, c - 16);
      g.lineBetween(c - 20, c - 2, c + 20, c - 4);
      g.fillStyle(0x477f82, 1);
      g.fillRect(c - 11, c - 7, 22, 19);
      g.fillStyle(0xf0cf87, 1);
      g.fillCircle(c, c - 16, 10);
      g.fillStyle(0xa56832, 1);
      g.fillRect(c - 15, c - 26, 30, 5);
      g.fillRect(c - 8, c - 33, 16, 8);
      g.fillStyle(0x273c45, 1);
      g.fillRect(c + 4, c - 3, 22, 10);
      g.fillStyle(0x111f28, 1);
      g.fillRect(c + 24, c - 2, 5, 8);
      g.fillStyle(0x24313b, 1);
      g.fillRect(c - 4, c - 18, 3, 3);
      g.fillRect(c + 3, c - 18, 3, 3);
    });
    towerTex("sprinkler", (g, c) => {
      base(g, c);
      g.fillStyle(0x24768f, 1);
      g.fillRect(c - 7, c - 16, 14, 32);
      g.fillStyle(0xb6f0ff, 1);
      g.fillCircle(c, c, 7);
    });
    towerTex("fan", (g, c) => {
      base(g, c);
      g.fillStyle(0x3d8198, 1);
      g.fillRect(c - 6, c - 4, 12, 22);
      g.lineStyle(3, 0x9aeeff, 0.6);
      g.strokeCircle(c, c - 8, 26);
    });
    towerTex("thunder", (g, c) => {
      base(g, c);
      g.fillStyle(0x655391, 1);
      g.fillRect(c - 11, c - 22, 22, 38);
      g.lineStyle(3, 0xd5bbff, 1);
      for (let i = 0; i < 4; i++) g.strokeEllipse(c, c + 8 - i * 7, 30, 9);
      g.fillStyle(0xfff3a7, 1);
      g.fillCircle(c, c - 26, 6);
      g.lineStyle(2, 0xf2deff, 1);
      g.lineBetween(c - 18, c - 20, c - 24, c - 30);
      g.lineBetween(c - 24, c - 30, c - 14, c - 32);
      g.lineBetween(c + 12, c - 26, c + 24, c - 18);
      g.lineBetween(c + 24, c - 18, c + 19, c - 8);
    });
    genTex(this, "rotor-bar", 72, 14, (g) => {
      g.fillStyle(0xe5f8ff, 1);
      g.fillRoundedRect(0, 3, 72, 8, 4);
      g.fillStyle(0x54c9f4, 1);
      g.fillCircle(8, 7, 5);
      g.fillCircle(64, 7, 5);
    });
    genTex(this, "fan-blades", 104, 104, (g) => {
      g.fillStyle(0xc0f1ff, 0.95);
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        g.save();
        g.translateCanvas(52, 52);
        g.rotateCanvas(a);
        g.fillEllipse(26, 0, 34, 15);
        g.restore();
      }
      g.fillStyle(0x3c6f9c, 1);
      g.fillCircle(52, 52, 9);
    });

    const SS2 = 2;
    const enemyTex = (kind: EKind, draw: (g: Phaser.GameObjects.Graphics, c: number) => void) => {
      genTex(this, `td-enemy-${kind}`, 96 * SS2, 96 * SS2, (g) => {
        g.save();
        g.scaleCanvas(SS2, SS2);
        draw(g, 48);
        g.restore();
      });
    };
    enemyTex("normal", (g, c) => {
      g.fillStyle(0x35445f, 1);
      g.fillTriangle(c + 8, c, c - 26, c - 22, c - 10, c);
      g.fillTriangle(c + 8, c, c - 26, c + 22, c - 10, c);
      g.fillEllipse(c - 2, c, 44, 30);
      g.fillStyle(0xfff7d8, 1);
      g.fillCircle(c + 12, c - 4, 5);
      g.fillStyle(0x232b35, 1);
      g.fillCircle(c + 14, c - 4, 2.5);
      g.fillStyle(0xf4b948, 1);
      g.fillTriangle(c + 18, c - 2, c + 30, c + 1, c + 18, c + 4);
    });
    enemyTex("fast", (g, c) => {
      g.fillStyle(0x85558e, 1);
      g.fillTriangle(c + 6, c, c - 30, c - 26, c - 12, c);
      g.fillTriangle(c + 6, c, c - 30, c + 26, c - 12, c);
      g.fillEllipse(c - 2, c, 38, 26);
      g.fillStyle(0xffd7d7, 1);
      g.fillCircle(c + 10, c - 4, 4.5);
      g.fillStyle(0x232b35, 1);
      g.fillCircle(c + 12, c - 4, 2.2);
    });
    enemyTex("tank", (g, c) => {
      g.lineStyle(3, 0x3a302c, 1);
      for (let i = -1; i <= 1; i++) {
        g.lineBetween(c + i * 8, c - 6, c + i * 9, c - 26);
        g.lineBetween(c + i * 8, c + 6, c + i * 9, c + 26);
      }
      g.fillStyle(0x55744a, 1);
      g.fillEllipse(c - 2, c, 52, 38);
      g.lineStyle(3, 0xd2be70, 1);
      g.lineBetween(c - 26, c, c + 18, c);
      g.fillStyle(0xfff7d8, 1);
      g.fillCircle(c + 14, c - 5, 5);
      g.fillStyle(0x232b35, 1);
      g.fillCircle(c + 16, c - 5, 2.5);
    });
    enemyTex("swarm", (g, c) => {
      g.lineStyle(2.5, 0x3a302c, 1);
      for (let i = -1; i <= 1; i++) {
        g.lineBetween(c + i * 6, c - 3, c + i * 7, c - 17);
        g.lineBetween(c + i * 6, c + 3, c + i * 7, c + 17);
      }
      g.fillStyle(0xaa5138, 1);
      g.fillCircle(c - 12, c, 11);
      g.fillEllipse(c + 2, c, 26, 20);
      g.fillCircle(c + 16, c, 9);
      g.fillStyle(0xfff7d8, 1);
      g.fillCircle(c + 18, c - 3, 3);
    });
    enemyTex("boss", (g, c) => {
      g.fillStyle(0x793b68, 1);
      g.fillEllipse(c - 2, c + 2, 58, 44);
      g.fillStyle(0x9c4f86, 1);
      g.fillEllipse(c, c - 4, 44, 32);
      g.fillStyle(0xffd557, 1);
      g.fillPoints(
        [
          { x: c - 16, y: c - 20 }, { x: c - 20, y: c - 34 }, { x: c - 7, y: c - 26 },
          { x: c, y: c - 40 }, { x: c + 8, y: c - 26 }, { x: c + 19, y: c - 34 },
          { x: c + 15, y: c - 20 },
        ],
        true,
      );
      g.fillStyle(0xfff7d8, 1);
      g.fillCircle(c + 12, c - 4, 6);
      g.fillCircle(c - 12, c - 4, 6);
      g.fillStyle(0x232b35, 1);
      g.fillCircle(c + 14, c - 4, 3);
      g.fillCircle(c - 10, c - 4, 3);
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(c + 6, c + 10, c + 11, c + 10, c + 8, c + 17);
      g.fillTriangle(c - 11, c + 10, c - 6, c + 10, c - 8, c + 17);
    });
  }

  computeLayout(rescale: boolean): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const availW = W;
    const availH = Math.max(200, H - this.insets.top - this.insets.bottom);
    const oldOx = this.ox;
    const oldOy = this.oy;
    const oldTotal = this.pathTotal;
    this.cell = Math.max(22, Math.floor(Math.min(availW / COLS, availH / ROWS)));
    this.ox = Math.round((W - this.cell * COLS) / 2);
    this.oy = Math.round(this.insets.top + (availH - this.cell * ROWS) / 2);
    // 経路の再計算
    this.waypoints = [];
    for (const [c0, r0, c1, r1] of PATH_SEGMENTS) {
      if (this.waypoints.length === 0) this.waypoints.push(this.cellCenterPx(c0, r0));
      this.waypoints.push(this.cellCenterPx(c1, r1));
    }
    this.segLen = [];
    this.pathTotal = 0;
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const len = Math.hypot(
        this.waypoints[i + 1].x - this.waypoints[i].x,
        this.waypoints[i + 1].y - this.waypoints[i].y,
      );
      this.segLen.push(len);
      this.pathTotal += len;
    }
    if (rescale) {
      const ratio = oldTotal > 0 ? this.pathTotal / oldTotal : 1;
      if (Math.abs(ratio - 1) > 0.001) {
        for (const e of this.enemies) e.dist *= ratio;
        for (const p of this.projs) {
          p.img.x = this.ox + (p.img.x - oldOx) * ratio;
          p.img.y = this.oy + (p.img.y - oldOy) * ratio;
        }
      }
      for (const t of this.towers) this.positionTower(t);
    }
    this.entranceLabel.setPosition(this.ox + 6, this.oy + this.cell - 10);
  }

  cellCenterPx(c: number, r: number): { x: number; y: number } {
    return { x: this.ox + c * this.cell + this.cell / 2, y: this.oy + r * this.cell + this.cell / 2 };
  }

  posAt(dist: number): { x: number; y: number } {
    let d = dist;
    for (let i = 0; i < this.segLen.length; i++) {
      if (d <= this.segLen[i] || i === this.segLen.length - 1) {
        const t = this.segLen[i] === 0 ? 0 : Phaser.Math.Clamp(d / this.segLen[i], 0, 1);
        return {
          x: this.waypoints[i].x + (this.waypoints[i + 1].x - this.waypoints[i].x) * t,
          y: this.waypoints[i].y + (this.waypoints[i + 1].y - this.waypoints[i].y) * t,
        };
      }
      d -= this.segLen[i];
    }
    const last = this.waypoints[this.waypoints.length - 1];
    return { x: last.x, y: last.y };
  }

  drawField(): void {
    const g = this.fieldG;
    const { cell, ox, oy } = this;
    g.clear();
    // 背景（画面全体）
    g.fillStyle(0x8fbf5f, 1);
    g.fillRect(0, 0, this.scale.width, this.scale.height);
    // 草原チェッカー
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        g.fillStyle((c + r) % 2 === 0 ? 0xa9d977 : 0x9ed168, 1);
        g.fillRect(ox + c * cell, oy + r * cell, cell, cell);
        if (!PATH_CELLS.has(`${c},${r}`)) {
          const gx = ox + c * cell + cell / 2;
          const gy = oy + r * cell + cell / 2;
          g.lineStyle(1.5, 0x8fa74d, 0.8);
          g.lineBetween(gx - cell * 0.28, gy + cell * 0.3, gx - cell * 0.28, gy + cell * 0.05);
          g.fillStyle(0xe2c263, 0.9);
          for (let i = 0; i < 3; i++) {
            g.fillEllipse(gx - cell * 0.3 + (i % 2) * 4, gy + cell * 0.08 + i * 3, 5, 3.4);
          }
        }
      }
    }
    // 経路
    g.lineStyle(cell * 0.78, 0xd9b678, 1);
    g.beginPath();
    this.waypoints.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.strokePath();
    g.lineStyle(2, 0x7a5a1e, 0.35);
    // 破線は手動で刻む（Graphicsに setLineDash は無い）
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const a = this.waypoints[i];
      const b = this.waypoints[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / (len || 1);
      const uy = (b.y - a.y) / (len || 1);
      for (let d = 0; d < len; d += 18) {
        const e = Math.min(len, d + 8);
        g.lineBetween(a.x + ux * d, a.y + uy * d, a.x + ux * e, a.y + uy * e);
      }
    }
    // 農家小屋（出口）
    const hx = ox + 9 * cell + cell / 2;
    const hy = oy + ROWS * cell;
    g.fillStyle(0xefdbab, 1);
    g.fillRect(hx - cell * 0.38, hy - cell * 0.55, cell * 0.76, cell * 0.55);
    g.fillStyle(0xac553d, 1);
    g.fillTriangle(hx - cell * 0.52, hy - cell * 0.53, hx, hy - cell * 0.95, hx + cell * 0.52, hy - cell * 0.53);
    g.fillStyle(0x5b4230, 1);
    g.fillRect(hx - cell * 0.11, hy - cell * 0.38, cell * 0.22, cell * 0.38);
    g.fillStyle(0xa3dbeb, 1);
    g.fillRect(hx + cell * 0.18, hy - cell * 0.42, cell * 0.15, cell * 0.17);
  }

  setupInput(): void {
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.hover = this.toCell(p.x, p.y);
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const cellPos = this.toCell(p.x, p.y);
      if (!cellPos || this.phase === "over") return;
      this.handleTap(cellPos.c, cellPos.r);
    });
  }

  toCell(x: number, y: number): { c: number; r: number } | null {
    const c = Math.floor((x - this.ox) / this.cell);
    const r = Math.floor((y - this.oy) / this.cell);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return { c, r };
  }

  handleTap(c: number, r: number): void {
    const s = this;
    const existing = s.towers.find((t) => t.c === c && t.r === r);
    if (existing) {
      s.selectedId = existing.id;
      sfx.play("click");
      s.emitSelection();
      return;
    }
    if (PATH_CELLS.has(`${c},${r}`)) {
      s.invalidAt = s.animTime;
      s.invalidCell = `${c},${r}`;
      return;
    }
    const kind = s.hooks.getSelectedKind();
    const def = TOWERS[kind];
    if (s.wheat < def.cost) {
      s.invalidAt = s.animTime;
      s.invalidCell = `${c},${r}`;
      sfx.play("hit");
      return;
    }
    s.wheat -= def.cost;
    const t = s.createTower(kind, c, r);
    s.selectedId = t.id;
    sfx.play("place");
    s.hudDirty = true;
    s.emitSelection();
  }

  createTower(kind: TowerKind, c: number, r: number): TowerE {
    const cont = this.add.container(0, 0).setDepth(20);
    const baseImg = this.add.image(0, 0, `tower-${kind}`);
    cont.add(baseImg);
    let rotor: Phaser.GameObjects.Image | null = null;
    if (kind === "sprinkler") {
      rotor = this.add.image(0, 0, "rotor-bar");
      cont.add(rotor);
    } else if (kind === "fan") {
      rotor = this.add.image(0, -8, "fan-blades");
      cont.add(rotor);
    }
    const t: TowerE = {
      cont, rotor,
      id: this.nextId++, kind, c, r, lv: 1, invested: TOWERS[kind].cost, cd: 0,
    };
    this.towers.push(t);
    this.positionTower(t);
    return t;
  }

  positionTower(t: TowerE): void {
    const p = this.cellCenterPx(t.c, t.r);
    t.cont.setPosition(p.x, p.y);
    const base = t.cont.list[0] as Phaser.GameObjects.Image;
    const grow = 1 + 0.06 * (t.lv - 1);
    base.setDisplaySize(this.cell * 2 * grow, this.cell * 2 * grow);
    if (t.rotor) {
      if (t.rotor.texture.key === "rotor-bar") {
        t.rotor.setDisplaySize(this.cell * 0.72, this.cell * 0.14);
      } else {
        t.rotor.setDisplaySize(this.cell * 0.88, this.cell * 0.88);
        t.rotor.setPosition(0, -this.cell * 0.14);
      }
    }
  }

  setPhase(p: TdPhase): void {
    this.phase = p;
    this.hooks.onPhase(p);
  }

  resetState(): void {
    for (const t of this.towers) t.cont.destroy();
    for (const e of this.enemies) e.img.destroy();
    for (const p of this.projs) this.projPool.release(p.img);
    this.towers = [];
    this.enemies = [];
    this.projs = [];
    this.bolts = [];
    this.particlePool?.clear();
    this.texts?.clear();
    this.gtime = 0;
    this.wheat = BALANCE.initialWheat;
    this.baseHp = BASE_HP;
    this.wave = 0;
    this.kills = 0;
    this.totalEarned = 0;
    this.queue = [];
    this.waveTotal = 0;
    this.spawnCd = 0;
    this.waveActive = false;
    this.autoTimer = 0;
    this.bannerText = "";
    this.bannerUntil = 0;
    this.hitUntil = 0;
    this.selectedId = null;
    this.hudDirty = true;
    this.hooks.onSelectTower(null);
    this.emitHud();
  }

  start(): void {
    this.resetState();
    this.setPhase("playing");
    this.startWave();
  }

  beginFromBuild(): void {
    this.setPhase("playing");
    this.startWave();
  }

  startWave(): void {
    const s = this;
    if (s.waveActive || s.phase !== "playing") return;
    s.wave += 1;
    s.queue = waveQueue(s.wave);
    s.waveTotal = s.queue.length;
    s.waveActive = true;
    s.spawnCd = 0.3;
    s.bannerText = s.wave % 5 === 0 ? `WAVE ${s.wave} 👹ボス接近！` : `WAVE ${s.wave} ${waveName(s.wave)}`;
    s.bannerUntil = s.gtime + 1.6;
    sfx.play("clear");
    s.hudDirty = true;
  }

  endGame(): void {
    const s = this;
    const score = s.kills * 15 + s.wave * 800 + s.totalEarned;
    sfx.play("gameover");
    s.hooks.onGameOver({ wave: s.wave, kills: s.kills, score });
    s.setPhase("over");
  }

  damageEnemy(e: EnemyE, dmg: number, kind: TowerKind): void {
    const s = this;
    if (e.dead) return;
    e.hp -= dmg;
    if (e.kind === "boss" && !e.enraged && e.hp > 0 && e.hp <= e.maxHp * 0.5) {
      e.enraged = true;
      s.bannerText = "王様が激怒！ 移動速度アップ";
      s.bannerUntil = s.gtime + 1.7;
      const p = s.posAt(e.dist);
      s.particlePool.burst(p.x, p.y, "#ff654a", 24, 150);
    }
    if (e.hp <= 0) {
      e.dead = true;
      s.kills += 1;
      s.wheat += e.bounty;
      s.totalEarned += e.bounty;
      const p = s.posAt(e.dist);
      s.particlePool.burst(p.x, p.y, TOWERS[kind].color, e.kind === "boss" ? 32 : 12, 130);
      s.texts.spawn(p.x, p.y - 14, `+${e.bounty}🌾`, "#fff4a8", 0.85);
      sfx.play(e.kind === "boss" ? "boom" : "coin");
      s.hudDirty = true;
    }
  }

  update(_time: number, deltaMs: number): void {
    this.animTime += Math.min(0.05, deltaMs / 1000);
    // ローターのアニメーション
    for (const t of this.towers) {
      if (!t.rotor) continue;
      t.rotor.rotation = t.kind === "sprinkler" ? this.animTime * 2 : this.animTime * 4;
    }
    if (this.phase === "playing") {
      const dt = Math.min(0.05, deltaMs / 1000) * this.speed;
      if (dt > 0) this.step(dt);
    }
    this.drawDynamic();
    if (this.hudDirty) {
      this.hudDirty = false;
      this.emitHud();
    }
  }

  step(dt: number): void {
    const s = this;
    s.gtime += dt;

    // スポーン
    if (s.waveActive && s.queue.length > 0) {
      s.spawnCd -= dt;
      if (s.spawnCd <= 0) {
        const kind = s.queue.shift()!;
        const base = enemyBase(kind);
        const hpMul = waveHpMultiplier(s.wave);
        const img = s.add.image(0, 0, `td-enemy-${kind}`).setDepth(22);
        img.setDisplaySize(base.r * 3, base.r * 3);
        s.enemies.push({
          img, id: s.nextId++, kind, dist: 0,
          hp: base.hp * hpMul, maxHp: base.hp * hpMul,
          spd: base.spd, bounty: Math.round(base.bounty * (1 + s.wave * BALANCE.rewardGrowth)),
          leak: base.leak, r: base.r,
          wetUntil: 0, enraged: false, slowUntil: 0, slowFactor: 1, dead: false,
        });
        s.spawnCd = kind === "swarm" ? 0.19 : kind === "fast" ? 0.38 : kind === "tank" ? 1.05 : 0.8;
        s.hudDirty = true;
      }
    }

    // 敵の移動
    for (const e of s.enemies) {
      if (e.dead) continue;
      const slowed = s.gtime < e.slowUntil;
      e.dist += e.spd * (e.enraged ? BALANCE.bossRageSpeed : 1) * (slowed ? e.slowFactor : 1) * dt * (s.cell / 56);
      if (e.dist >= s.pathTotal) {
        e.dead = true;
        s.baseHp = Math.max(0, s.baseHp - e.leak);
        s.hitUntil = s.gtime + 0.45;
        sfx.play("hurt");
        s.hudDirty = true;
        if (s.baseHp <= 0) {
          s.baseHp = 0;
          s.cleanupDead();
          s.endGame();
          return;
        }
      }
    }
    s.cleanupDead();

    // ウェーブ終了判定
    if (s.waveActive && s.queue.length === 0 && s.enemies.length === 0) {
      s.waveActive = false;
      const bonus = BALANCE.bonusBase + s.wave * BALANCE.bonusPerWave;
      s.wheat += bonus;
      s.totalEarned += bonus;
      s.bannerText = `WAVE ${s.wave} クリア！ ボーナス +${bonus}🌾`;
      s.bannerUntil = s.gtime + 1.8;
      sfx.play("clear");
      s.autoTimer = 3;
      s.hudDirty = true;
    }
    if (!s.waveActive && s.phase === "playing" && s.autoStart) {
      s.autoTimer -= dt;
      if (s.autoTimer <= 0) s.startWave();
    }

    // タワーの攻撃
    for (const t of s.towers) {
      t.cd -= dt;
      const st = towerStats(t.kind, t.lv);
      const tp = s.cellCenterPx(t.c, t.r);
      let target: EnemyE | null = null;
      for (const e of s.enemies) {
        if (e.dead) continue;
        const ep = s.posAt(e.dist);
        if (Math.hypot(ep.x - tp.x, ep.y - tp.y) <= st.range * s.cell + e.r * (s.cell / 56)) {
          if (!target || e.dist > target.dist) target = e;
        }
      }
      if (!target || t.cd > 0) continue;
      t.cd = 1 / st.rate;
      const def = TOWERS[t.kind];
      if (t.kind === "thunder") {
        const chainTargets: EnemyE[] = [target];
        let from = target;
        for (let i = 1; i < (def.chain ?? 3); i++) {
          let next: EnemyE | null = null;
          let bestD = 100 * (s.cell / 56);
          const fp = s.posAt(from.dist);
          for (const e of s.enemies) {
            if (e.dead || chainTargets.includes(e)) continue;
            const ep = s.posAt(e.dist);
            const d = Math.hypot(ep.x - fp.x, ep.y - fp.y);
            if (d < bestD) { bestD = d; next = e; }
          }
          if (!next) break;
          chainTargets.push(next);
          from = next;
        }
        const pts: { x: number; y: number }[] = [{ x: tp.x, y: tp.y - 10 }];
        for (const e of chainTargets) {
          const ep = s.posAt(e.dist);
          const prev = pts[pts.length - 1];
          pts.push(
            { x: (prev.x + ep.x) / 2 + (Math.random() - 0.5) * 22, y: (prev.y + ep.y) / 2 + (Math.random() - 0.5) * 22 },
            { x: ep.x, y: ep.y },
          );
        }
        s.bolts.push({ pts, ttl: 0.13 });
        for (const e of chainTargets) {
          s.damageEnemy(e, st.dmg * (e.wetUntil > s.gtime ? BALANCE.wetLightning : 1), "thunder");
        }
        sfx.play("thunder");
      } else {
        const img = s.projPool.obtain();
        img.setPosition(tp.x, tp.y - 8).setDisplaySize(11, 11);
        img.setTint(Phaser.Display.Color.HexStringToColor(def.color).color);
        s.projs.push({ img, targetId: target.id, dmg: st.dmg, kind: t.kind, slow: def.slow, dead: false });
        sfx.play("shoot");
      }
    }

    // 弾の移動
    for (let i = s.projs.length - 1; i >= 0; i--) {
      const p = s.projs[i];
      const e = s.enemies.find((en) => en.id === p.targetId && !en.dead);
      if (!e) {
        s.projPool.release(p.img);
        s.projs.splice(i, 1);
        continue;
      }
      const ep = s.posAt(e.dist);
      const d = Math.hypot(ep.x - p.img.x, ep.y - p.img.y);
      const stepLen = 420 * (s.cell / 56) * dt;
      if (d <= stepLen + e.r * (s.cell / 56) * 0.4) {
        if (p.kind === "sprinkler") e.wetUntil = s.gtime + BALANCE.wetDuration;
        s.damageEnemy(e, p.dmg * (p.kind === "scarecrow" && e.slowUntil > s.gtime ? BALANCE.frozenCannon : 1), p.kind);
        if (p.slow && !e.dead) {
          e.slowFactor = 1 - p.slow;
          e.slowUntil = s.gtime + BALANCE.slowDuration;
          sfx.play("freeze");
        }
        s.particlePool.burst(ep.x, ep.y, TOWERS[p.kind].color, 3, 90, 2.4);
        s.projPool.release(p.img);
        s.projs.splice(i, 1);
      } else {
        p.img.x += ((ep.x - p.img.x) / d) * stepLen;
        p.img.y += ((ep.y - p.img.y) / d) * stepLen;
      }
    }
    s.cleanupDead();

    // エフェクト寿命
    for (let i = s.bolts.length - 1; i >= 0; i--) {
      s.bolts[i].ttl -= dt;
      if (s.bolts[i].ttl <= 0) s.bolts.splice(i, 1);
    }
    s.particlePool.update(dt);
    s.texts.update(dt, 23);
  }

  cleanupDead(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) {
        this.enemies[i].img.destroy();
        this.enemies.splice(i, 1);
      }
    }
  }

  drawDynamic(): void {
    const s = this;
    const g = s.fxG;
    g.clear();
    const cell = s.cell;

    // 敵スプライトの位置・向き・状態表示
    const k = s.cell / 56;
    for (const e of s.enemies) {
      const er = e.r * k;
      const p = s.posAt(e.dist);
      const p2 = s.posAt(e.dist + 2);
      e.img.setDisplaySize(e.r * 3 * k, e.r * 3 * k);
      e.img.setPosition(p.x, p.y);
      e.img.setRotation(Math.atan2(p2.y - p.y, p2.x - p.x) + Math.sin(s.animTime * 9 + e.id) * 0.06);
      const slowed = s.gtime < e.slowUntil;
      const wet = s.gtime < e.wetUntil;
      if (slowed) e.img.setTint(0xbfe9ff);
      else if (e.enraged) e.img.setTint(0xff9a86);
      else e.img.clearTint();
      if (e.hp < e.maxHp) {
        const bw = Math.max(30 * k, er * 2);
        g.fillStyle(0x000000, 0.5);
        g.fillRect(p.x - bw / 2, p.y - er - 11, bw, 5);
        g.fillStyle(e.kind === "boss" ? 0xb388ff : 0xff5252, 1);
        g.fillRect(p.x - bw / 2, p.y - er - 11, bw * Math.max(0, e.hp / e.maxHp), 5);
      }
      if (wet) {
        g.fillStyle(0x219ee6, 1);
        g.fillTriangle(p.x + er - 5, p.y - er - 8, p.x + er + 5, p.y - er + 2, p.x + er - 5, p.y - er + 2);
        g.fillCircle(p.x + er, p.y - er + 1, 4);
      }
      if (slowed) {
        g.lineStyle(2, 0xe6fbff, 0.9);
        g.strokeCircle(p.x, p.y, er + 3);
      }
    }

    // 配置ゴースト
    const sel = s.towers.find((t) => t.id === s.selectedId) ?? null;
    if (s.hover && s.phase !== "over") {
      const { c, r } = s.hover;
      const occupied = s.towers.some((t) => t.c === c && t.r === r);
      if (!occupied && !PATH_CELLS.has(`${c},${r}`)) {
        const kind = s.hooks.getSelectedKind();
        const def = TOWERS[kind];
        const p = s.cellCenterPx(c, r);
        g.fillStyle(0x4db8e8, 0.14);
        g.fillCircle(p.x, p.y, def.range * cell);
        g.lineStyle(1.5, 0x2b8fc7, 0.6);
        g.strokeCircle(p.x, p.y, def.range * cell);
        s.ghostImg.setTexture(`tower-${kind}`);
        s.ghostImg.setDisplaySize(cell * 2, cell * 2);
        s.ghostImg.setPosition(p.x, p.y).setVisible(true);
      } else {
        s.ghostImg.setVisible(false);
      }
    } else {
      s.ghostImg.setVisible(false);
    }
    // 配置不可フラッシュ
    if (s.animTime - s.invalidAt < 0.35 && s.invalidCell) {
      const [c, r] = s.invalidCell.split(",").map(Number);
      g.fillStyle(0xff3c3c, 0.4);
      g.fillRect(s.ox + c * cell, s.oy + r * cell, cell, cell);
    }
    // 選択中タワーの射程
    if (sel) {
      const p = s.cellCenterPx(sel.c, sel.r);
      const st = towerStats(sel.kind, sel.lv);
      g.fillStyle(0xffffff, 0.13);
      g.fillCircle(p.x, p.y, st.range * cell);
      g.lineStyle(1.5, 0xffffff, 0.8);
      g.strokeCircle(p.x, p.y, st.range * cell);
      g.lineStyle(3, 0xffd94d, 1);
      g.strokeRect(s.ox + sel.c * cell + 2, s.oy + sel.r * cell + 2, cell - 4, cell - 4);
    }
    // 稲妻
    for (const b of s.bolts) {
      g.lineStyle(3, 0xffe14d, Math.max(0, b.ttl / 0.13));
      g.beginPath();
      g.moveTo(b.pts[0].x, b.pts[0].y);
      for (let i = 1; i < b.pts.length; i++) g.lineTo(b.pts[i].x, b.pts[i].y);
      g.strokePath();
    }
    // 被弾フラッシュ
    if (s.gtime < s.hitUntil) {
      g.fillStyle(0xe62823, (s.hitUntil - s.gtime) * 0.45);
      g.fillRect(s.ox, s.oy, cell * COLS, cell * ROWS);
    }
    // バナー
    if (s.bannerText && s.gtime < s.bannerUntil) {
      s.bannerObj.setText(s.bannerText).setVisible(true);
      s.bannerObj.setPosition(s.scale.width / 2, s.oy + cell * ROWS * 0.42);
      s.bannerObj.setFontSize(Math.max(20, Math.min(34, cell * 0.55)));
    } else {
      s.bannerObj.setVisible(false);
    }
  }

  selectedTower(): TowerE | null {
    return this.towers.find((t) => t.id === this.selectedId) ?? null;
  }

  emitSelection(): void {
    const t = this.selectedTower();
    if (!t) {
      this.hooks.onSelectTower(null);
      return;
    }
    const st = towerStats(t.kind, t.lv);
    const next = t.lv < 3 ? towerStats(t.kind, t.lv + 1) : null;
    this.hooks.onSelectTower({
      id: t.id, kind: t.kind, lv: t.lv,
      dmg: st.dmg, range: st.range, rate: st.rate,
      nextDmg: next?.dmg ?? null, nextRange: next?.range ?? null, nextRate: next?.rate ?? null,
      upgradeCost: upgradeCost(t.kind, t.lv),
      sellValue: Math.floor(t.invested * 0.7),
    });
  }

  upgradeSelected(): void {
    const t = this.selectedTower();
    if (!t) return;
    const cost = upgradeCost(t.kind, t.lv);
    if (cost === null || this.wheat < cost) return;
    this.wheat -= cost;
    t.invested += cost;
    t.lv += 1;
    this.positionTower(t);
    sfx.play("levelup");
    this.hudDirty = true;
    this.emitSelection();
  }

  sellSelected(): void {
    const t = this.selectedTower();
    if (!t) return;
    this.wheat += Math.floor(t.invested * 0.7);
    t.cont.destroy();
    this.towers = this.towers.filter((x) => x.id !== t.id);
    this.selectedId = null;
    sfx.play("coin");
    this.hudDirty = true;
    this.hooks.onSelectTower(null);
  }

  emitHud(): void {
    this.hooks.onHud({
      wheat: Math.floor(this.wheat),
      baseHp: this.baseHp,
      wave: this.wave,
      waveActive: this.waveActive,
      remain: this.enemies.length + this.queue.length,
    });
  }
}

export function createTowerDefenseGame(
  parent: HTMLElement,
  hooks: TdHooks,
  insets: TdInsets,
): { game: Phaser.Game; api: TdApi; destroy: () => void } {
  const scene = new TowerDefenseScene();
  scene.hooks = hooks;
  scene.insets = insets;
  const game = new Phaser.Game(baseGameConfig(parent, [scene as unknown as Phaser.Types.Scenes.SettingsConfig]));
  const detach = attachDprResize(game, parent);
  const api: TdApi = {
    start: () => {
      if (scene.booted) scene.start();
      else scene.autoStartOnBoot = true;
    },
    beginFromBuild: () => {
      if (scene.booted) scene.beginFromBuild();
      else scene.autoStartOnBoot = true;
    },
    startWave: () => scene.startWave(),
    pause: () => { if (scene.phase === "playing") scene.setPhase("paused"); },
    resume: () => { if (scene.phase === "paused") scene.setPhase("playing"); },
    setSpeed: (n) => { scene.speed = n; },
    setAutoStart: (b) => { scene.autoStart = b; },
    upgradeSelected: () => scene.upgradeSelected(),
    sellSelected: () => scene.sellSelected(),
    closeSelection: () => {
      scene.selectedId = null;
      hooks.onSelectTower(null);
    },
    relayout: () => {
      scene.computeLayout(true);
      scene.drawField();
    },
    autoPause: () => { if (scene.phase === "playing") scene.setPhase("paused"); },
  };
  return { game, api, destroy: () => { detach(); game.destroy(true); } };
}
