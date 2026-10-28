import * as Phaser from "phaser";
import { sfx } from "../sfx";
import {
  attachDprResize,
  baseGameConfig,
  ensureDot,
  ensureRing,
  genTex,
  Hitstop,
  HurtVignette,
  ImagePool,
  ParticlePool,
  TextPool,
  turnToward,
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
  /** 描画した実スプライトの data URL（タワー全体像・敵）を React パネルへ渡す */
  onIcons?(icons: Record<string, string>): void;
  /** 資金不足で配置できなかったときに React カードを揺らす */
  onDeny?(): void;
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
  /** 動くパーツA（砲身／ローター／羽根／オーブ） */
  partA: Phaser.GameObjects.Image | null;
  /** 動くパーツB（ファンの霧／雷のグロー） */
  partB: Phaser.GameObjects.Image | null;
  emitter: Phaser.GameObjects.Particles.ParticleEmitter | null;
  id: number;
  kind: TowerKind;
  c: number;
  r: number;
  lv: number;
  invested: number;
  cd: number;
  aimAng: number;
  recoil: number;
  rotorAng: number;
  lastFire: number;
  bornAt: number;
  flashAt: number;
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
  poof: boolean;
  spawnAt: number;
  flashUntil: number;
  frame: number;
};
type DyingE = { img: Phaser.GameObjects.Image; ttl: number; max: number };
type ProjE = { img: Phaser.GameObjects.Image; targetId: number; dmg: number; kind: TowerKind; slow?: number; dead: boolean; trailCd: number };
type BoltE = { pts: { x: number; y: number }[]; branches: { x: number; y: number }[][]; ttl: number };

/** 決定的な疑似乱数（レイアウトごとに同じ畑の表情を保つ） */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

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
  dying: DyingE[] = [];
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
  bannerStart = -9;
  bannerDur = 1.6;
  hitUntil = 0;
  invalidAt = -9;
  invalidCell = "";
  hover: { c: number; r: number } | null = null;
  selectedId: number | null = null;
  nextId = 1;
  hudDirty = true;
  smokeCd = 0;

  // レイアウト
  cell = 56;
  ox = 0;
  oy = 0;
  waypoints: { x: number; y: number }[] = [];
  segLen: number[] = [];
  pathTotal = 1;
  chimneyPos = { x: 0, y: 0 };
  housePos = { x: 0, y: 0 };

  fieldImg!: Phaser.GameObjects.Image;
  fxG!: Phaser.GameObjects.Graphics;
  bannerObj!: Phaser.GameObjects.Text;
  entranceLabel!: Phaser.GameObjects.Text;
  bossLabel!: Phaser.GameObjects.Text;
  bossAura!: Phaser.GameObjects.Image;
  ghostImg!: Phaser.GameObjects.Image;
  wheatTufts: { img: Phaser.GameObjects.Image; c: number; r: number; dx: number; dy: number; ph: number }[] = [];
  booted = false;
  autoStartOnBoot = false;
  projPool!: ImagePool;
  particlePool!: ParticlePool;
  texts!: TextPool;
  dmgTexts!: TextPool;
  hurtVig!: HurtVignette;
  hitstop = new Hitstop();

  constructor() {
    super("tower-defense");
  }

  create(): void {
    this.createTextures();
    ensureDot(this);
    ensureRing(this);
    this.fieldImg = this.add.image(0, 0, "tex-dot").setOrigin(0, 0).setDepth(0);
    this.fxG = this.add.graphics().setDepth(40);
    this.bossAura = this.add.image(0, 0, "tex-ring").setDepth(21).setVisible(false).setTint(0xffd557);
    this.ghostImg = this.add.image(0, 0, "tower-scarecrow-full").setDepth(18).setAlpha(0.65).setVisible(false);
    this.bannerObj = this.add
      .text(0, 0, "", { fontFamily: "sans-serif", fontStyle: "bold", fontSize: "30px", resolution: 2, color: "#ffffff" })
      .setOrigin(0.5)
      .setStroke("rgba(35,64,90,0.9)", 6)
      .setDepth(90)
      .setVisible(false);
    this.bossLabel = this.add
      .text(0, 0, "👑 王様", { fontFamily: "sans-serif", fontStyle: "bold", fontSize: "13px", resolution: 2, color: "#ffe9a8" })
      .setOrigin(0.5)
      .setStroke("rgba(60,20,60,0.85)", 4)
      .setDepth(63)
      .setVisible(false);
    this.entranceLabel = this.add
      .text(0, 0, "入口 →", { fontFamily: "sans-serif", fontStyle: "bold", fontSize: "12px", resolution: 2, color: "#4b4227" })
      .setDepth(5);
    this.projPool = new ImagePool(this, "tex-dot", 25);
    this.particlePool = new ParticlePool(new ImagePool(this, "tex-dot", 35));
    this.texts = new TextPool(this, 60, 15);
    this.dmgTexts = new TextPool(this, 61, 14);
    // 被弾ヴィネット（ゲーム要素の上・バナーの下）。カメラは等倍・固定なので画面サイズそのまま
    this.hurtVig = new HurtVignette(this, 85);
    this.hurtVig.layout(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height);
    this.computeLayout(false);
    this.buildFieldTexture();
    this.placeTufts();
    this.setupInput();
    this.scale.on("resize", () => {
      this.computeLayout(true);
      this.buildFieldTexture();
      this.placeTufts();
      this.hurtVig.layout(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => sfx.stopBgm("tower"));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => sfx.stopBgm("tower"));
    this.exportIcons();
    this.resetState();
    this.booted = true;
    if (this.autoStartOnBoot) {
      this.autoStartOnBoot = false;
      this.beginFromBuild();
    }
  }

  /** 描画済みテクスチャを data URL にして React パネルへ渡す（実スプライトをアイコンに使う） */
  exportIcons(): void {
    if (!this.hooks.onIcons) return;
    const icons: Record<string, string> = {};
    const grab = (key: string, name: string) => {
      try {
        const src = this.textures.get(key).getSourceImage() as HTMLCanvasElement;
        if (src && typeof src.toDataURL === "function") icons[name] = src.toDataURL("image/png");
      } catch {
        /* 取れなければ絵文字にフォールバック */
      }
    };
    for (const k of ["scarecrow", "sprinkler", "fan", "thunder"] as TowerKind[]) grab(`tower-${k}-full`, `tower-${k}`);
    for (const k of ["normal", "fast", "tank", "swarm", "boss"] as EKind[]) {
      grab(k === "normal" || k === "fast" ? `td-enemy-${k}-a` : `td-enemy-${k}`, `enemy-${k}`);
    }
    this.hooks.onIcons(icons);
  }

  createTextures(): void {
    const SS = 2;
    const towerTex = (key: string, draw: (g: Phaser.GameObjects.Graphics, c: number) => void) => {
      genTex(this, key, 112 * SS, 112 * SS, (g) => {
        g.save();
        g.scaleCanvas(SS, SS);
        draw(g, 56);
        g.restore();
      });
    };
    // 共通の土台（藁の台座）。レベルで装飾が増える
    const base = (g: Phaser.GameObjects.Graphics, c: number, lv: number) => {
      g.fillStyle(0x000000, 0.22);
      g.fillEllipse(c, c + 38, 86, 18);
      g.fillStyle(0xcaa96a, 1);
      g.fillRoundedRect(c - 38, c + 24, 76, 15, 6);
      g.lineStyle(2, 0x9a7734, 1);
      g.strokeRoundedRect(c - 38, c + 24, 76, 15, 6);
      g.lineStyle(1.5, 0xb08d46, 0.8);
      for (let i = -3; i <= 3; i++) g.lineBetween(c + i * 10 - 3, c + 38, c + i * 10 + 3, c + 26);
      if (lv >= 2) {
        g.fillStyle(0x8a5a2b, 1);
        g.fillRect(c - 42, c + 28, 5, 12);
        g.fillRect(c + 37, c + 28, 5, 12);
        g.lineStyle(2, 0x8a5a2b, 1);
        g.lineBetween(c - 42, c + 31, c + 40, c + 31);
      }
      if (lv >= 3) {
        const starPts: { x: number; y: number }[] = [];
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          const rr = i % 2 === 0 ? 7 : 3.2;
          starPts.push({ x: c + Math.cos(a) * rr, y: c + 31 + Math.sin(a) * rr });
        }
        g.fillStyle(0xffd557, 1);
        g.fillPoints(starPts, true);
        g.lineStyle(1.5, 0xd9a41c, 1);
        g.strokeCircle(c, c + 31, 8.5);
      }
    };

    // ---- かかし砲台（本体。砲身は別パーツ） ----
    const scarecrowBody = (lv: number) => (g: Phaser.GameObjects.Graphics, c: number) => {
      base(g, c, lv);
      g.lineStyle(8, 0x8a5a2b, 1);
      g.lineBetween(c, c + 26, c, c - 22);
      g.lineBetween(c - 24, c - 10, c + 24, c - 12);
      g.fillStyle(0x4d8a8f, 1);
      g.fillRoundedRect(c - 18, c - 14, 36, 32, 5);
      g.lineStyle(2, 0x356368, 1);
      g.strokeRoundedRect(c - 18, c - 14, 36, 32, 5);
      g.fillStyle(0xd96f4e, 0.95);
      g.fillRect(c - 12, c + 2, 11, 11);
      g.lineStyle(1, 0xffffff, 0.7);
      g.lineBetween(c - 12, c + 7, c - 1, c + 7);
      if (lv >= 2) {
        g.fillStyle(0xd9483b, 1);
        g.fillTriangle(c - 9, c - 16, c + 9, c - 16, c, c - 4);
      }
      // 頭
      g.fillStyle(0xf2d492, 1);
      g.fillCircle(c, c - 28, 13);
      g.lineStyle(2, 0xc9a24e, 1);
      g.strokeCircle(c, c - 28, 13);
      g.fillStyle(0x273c45, 1);
      g.fillCircle(c - 4.5, c - 30, 1.8);
      g.fillCircle(c + 4.5, c - 30, 1.8);
      g.lineStyle(1.6, 0x8a6a2a, 1);
      g.beginPath();
      g.arc(c, c - 25, 6, 0.15 * Math.PI, 0.85 * Math.PI, false);
      g.strokePath();
      // 麦わら帽子
      g.fillStyle(0xd9a441, 1);
      g.fillEllipse(c, c - 38, 46, 11);
      g.fillRoundedRect(c - 12, c - 50, 24, 12, 4);
      g.lineStyle(2, 0xb9832f, 1);
      g.strokeEllipse(c, c - 38, 46, 11);
      if (lv >= 2) {
        g.fillStyle(0xff8fb3, 1);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          g.fillCircle(c + 15 + Math.cos(a) * 3.4, c - 40 + Math.sin(a) * 3.4, 2.6);
        }
        g.fillStyle(0xffe066, 1);
        g.fillCircle(c + 15, c - 40, 2.2);
      }
      if (lv >= 3) {
        g.lineStyle(2.5, 0xffd557, 1);
        g.lineBetween(c - 18, c + 16, c + 18, c + 16);
        g.fillStyle(0xffe066, 1);
        g.fillCircle(c, c + 8, 3);
      }
    };
    // ---- スプリンクラー（本体。回転バーは別パーツ） ----
    const sprinklerBody = (lv: number) => (g: Phaser.GameObjects.Graphics, c: number) => {
      base(g, c, lv);
      g.fillStyle(0x2f7ea6, 1);
      g.fillRoundedRect(c - 16, c + 4, 32, 22, 5);
      g.lineStyle(2, 0x1d5675, 1);
      g.strokeRoundedRect(c - 16, c + 4, 32, 22, 5);
      g.fillStyle(0xbfeaff, 1);
      g.fillCircle(c - 7, c + 15, 4.5);
      g.lineStyle(1.5, 0x1d5675, 1);
      g.lineBetween(c - 7, c + 15, c - 4, c + 10);
      if (lv >= 2) {
        g.fillStyle(0x3b8db5, 1);
        g.fillRoundedRect(c + 14, c + 10, 16, 16, 4);
        g.lineStyle(2, 0x1d5675, 1);
        g.strokeRoundedRect(c + 14, c + 10, 16, 16, 4);
      }
      g.fillStyle(0x3b8db5, 1);
      g.fillRect(c - 4, c - 26, 8, 32);
      g.fillStyle(0x9adcf5, 1);
      g.fillCircle(c, c - 28, 7);
      g.lineStyle(2, 0x1d5675, 1);
      g.strokeCircle(c, c - 28, 7);
      if (lv >= 3) {
        g.lineStyle(2.5, 0xffd557, 1);
        g.strokeCircle(c, c - 28, 10);
      }
    };
    // ---- 氷結ファン（本体。羽根と霧は別パーツ） ----
    const fanBody = (lv: number) => (g: Phaser.GameObjects.Graphics, c: number) => {
      base(g, c, lv);
      g.fillStyle(0x3d6f8c, 1);
      g.fillRect(c - 6, c - 12, 12, 38);
      g.lineStyle(5, 0x9adcf5, 1);
      g.strokeCircle(c, c - 24, 25);
      g.lineStyle(2, 0xe6fbff, 0.85);
      g.strokeCircle(c, c - 24, 20);
      if (lv >= 2) {
        g.fillStyle(0x9adcf5, 1);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          g.fillCircle(c + Math.cos(a) * 25, c - 24 + Math.sin(a) * 25, 2.4);
        }
      }
      if (lv >= 3) {
        g.lineStyle(2.5, 0xffd557, 1);
        g.strokeCircle(c, c - 24, 28);
      }
    };
    // ---- 雷タワー（本体。オーブとグローは別パーツ） ----
    const thunderBody = (lv: number) => (g: Phaser.GameObjects.Graphics, c: number) => {
      base(g, c, lv);
      g.fillStyle(0x6a559e, 1);
      g.fillPoints(
        [
          { x: c - 16, y: c + 26 }, { x: c + 16, y: c + 26 },
          { x: c + 8, y: c - 24 }, { x: c - 8, y: c - 24 },
        ],
        true,
      );
      g.lineStyle(2, 0x4a3872, 1);
      g.strokeRect(c - 16, c + 24, 32, 3);
      const coils = lv === 1 ? 3 : lv === 2 ? 4 : 5;
      g.lineStyle(3, lv >= 3 ? 0xffd557 : 0xd9c6ff, 1);
      for (let i = 0; i < coils; i++) {
        const y = c + 14 - i * 9;
        const w = 30 - i * 3.4;
        g.strokeEllipse(c, y, w, 8);
      }
      g.lineStyle(2.5, 0x4a3872, 1);
      g.lineBetween(c, c - 24, c, c - 36);
      if (lv >= 2) {
        g.lineStyle(2, 0x9adcf5, 1);
        g.lineBetween(c - 20, c + 20, c - 26, c - 6);
        g.lineBetween(c + 20, c + 20, c + 26, c - 6);
      }
    };
    for (const lv of [1, 2, 3]) {
      towerTex(`tower-scarecrow-${lv}`, scarecrowBody(lv));
      towerTex(`tower-sprinkler-${lv}`, sprinklerBody(lv));
      towerTex(`tower-fan-${lv}`, fanBody(lv));
      towerTex(`tower-thunder-${lv}`, thunderBody(lv));
    }
    // 全体像（ゴースト＆パネルアイコン用：本体Lv1＋パーツを静止合成）
    towerTex("tower-scarecrow-full", (g, c) => {
      scarecrowBody(1)(g, c);
      g.save();
      g.translateCanvas(c + 4, c - 14);
      g.rotateCanvas(-0.32);
      this.drawCannon(g, 0, 0);
      g.restore();
    });
    towerTex("tower-sprinkler-full", (g, c) => {
      sprinklerBody(1)(g, c);
      g.save();
      g.translateCanvas(c, c - 28);
      g.rotateCanvas(0.5);
      this.drawRotorBar(g, 0, 0);
      g.restore();
    });
    towerTex("tower-fan-full", (g, c) => {
      fanBody(1)(g, c);
      this.drawFanBlades(g, c, c - 24);
    });
    towerTex("tower-thunder-full", (g, c) => {
      thunderBody(1)(g, c);
      g.fillStyle(0xffe14d, 0.35);
      g.fillCircle(c, c - 42, 17);
      g.fillStyle(0xffdf5e, 1);
      g.fillCircle(c, c - 42, 11);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(c, c - 42, 5.5);
    });

    // ---- 動くパーツ ----
    genTex(this, "td-cannon", 112 * SS, 32 * SS, (g) => {
      g.save();
      g.scaleCanvas(SS, SS);
      this.drawCannon(g, 14, 16);
      g.restore();
    });
    genTex(this, "rotor-bar", 76 * SS, 30 * SS, (g) => {
      g.save();
      g.scaleCanvas(SS, SS);
      this.drawRotorBar(g, 38, 15);
      g.restore();
    });
    genTex(this, "fan-blades", 104 * SS, 104 * SS, (g) => {
      g.save();
      g.scaleCanvas(SS, SS);
      this.drawFanBlades(g, 52, 52);
      g.restore();
    });
    genTex(this, "fan-mist", 120 * SS, 120 * SS, (g) => {
      g.save();
      g.scaleCanvas(SS, SS);
      g.fillStyle(0xdff7ff, 0.1);
      g.fillCircle(60, 60, 58);
      g.fillStyle(0xdff7ff, 0.09);
      g.fillCircle(60, 60, 44);
      g.fillStyle(0xffffff, 0.1);
      g.fillCircle(60, 60, 30);
      g.restore();
    });
    genTex(this, "thunder-orb", 64 * SS, 64 * SS, (g) => {
      g.save();
      g.scaleCanvas(SS, SS);
      g.fillStyle(0xffe14d, 0.35);
      g.fillCircle(32, 32, 30);
      g.fillStyle(0xffdf5e, 1);
      g.fillCircle(32, 32, 19);
      g.fillStyle(0xfffbe8, 1);
      g.fillCircle(32, 32, 10);
      g.restore();
    });
    genTex(this, "thunder-glow", 128 * SS, 128 * SS, (g) => {
      g.save();
      g.scaleCanvas(SS, SS);
      for (let r = 62; r > 8; r -= 9) {
        g.fillStyle(0xffe98a, 0.045);
        g.fillCircle(64, 64, r);
      }
      g.restore();
    });
    // ---- 畑の小物 ----
    genTex(this, "td-wheat", 48 * SS, 48 * SS, (g) => {
      g.save();
      g.scaleCanvas(SS, SS);
      g.lineStyle(2, 0xc49a3a, 1);
      for (const dx of [-12, -4, 5, 13]) {
        g.lineBetween(24 + dx, 47, 24 + dx * 0.7, 14);
        g.fillStyle(0xe2c263, 1);
        for (let i = 0; i < 3; i++) {
          g.fillEllipse(24 + dx * 0.7 - 3, 16 + i * 6, 5.5, 3.6);
          g.fillEllipse(24 + dx * 0.7 + 3, 16 + i * 6, 5.5, 3.6);
        }
      }
      g.restore();
    });
    genTex(this, "td-flower", 40 * SS, 40 * SS, (g) => {
      g.save();
      g.scaleCanvas(SS, SS);
      g.lineStyle(2, 0x5d8f3e, 1);
      g.lineBetween(20, 39, 20, 22);
      g.lineBetween(12, 39, 13, 27);
      g.lineBetween(28, 39, 27, 27);
      const petal = (x: number, y: number, col: number) => {
        g.fillStyle(col, 1);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          g.fillCircle(x + Math.cos(a) * 3.6, y + Math.sin(a) * 3.6, 2.7);
        }
        g.fillStyle(0xffe066, 1);
        g.fillCircle(x, y, 2.1);
      };
      petal(20, 17, 0xff8fb3);
      petal(12, 23, 0xffffff);
      petal(28, 23, 0xc5a3ff);
      g.restore();
    });

    this.createEnemyTextures();
  }

  /** 砲身（中心=支点として描く。右向き） */
  drawCannon(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.fillStyle(0x5d4630, 1);
    g.fillRoundedRect(x - 6, y - 8, 92, 16, 7);
    g.lineStyle(2, 0x3c2c1c, 1);
    g.strokeRoundedRect(x - 6, y - 8, 92, 16, 7);
    g.fillStyle(0x8a8f99, 1);
    g.fillRect(x + 22, y - 9, 9, 18);
    g.fillRect(x + 62, y - 9, 9, 18);
    g.fillStyle(0x2b2f36, 1);
    g.fillRoundedRect(x + 82, y - 10, 16, 20, 4);
    g.fillStyle(0x0c0e11, 1);
    g.fillCircle(x + 97, y, 5.5);
    g.fillStyle(0xd9d9d9, 1);
    g.fillCircle(x + 2, y, 4);
  }

  /** スプリンクラーの回転バー（中心=回転軸） */
  drawRotorBar(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.fillStyle(0xe5f8ff, 1);
    g.fillRoundedRect(x - 36, y - 4, 72, 8, 4);
    g.lineStyle(1.5, 0x54a9cf, 1);
    g.strokeRoundedRect(x - 36, y - 4, 72, 8, 4);
    g.fillStyle(0x54c9f4, 1);
    for (const dx of [-30, -15, 15, 30]) g.fillCircle(x + dx, y + 5, 3.4);
    g.fillStyle(0x2f7ea6, 1);
    g.fillCircle(x, y, 6);
    g.fillStyle(0xbfeaff, 1);
    g.fillCircle(x, y, 2.6);
  }

  /** ファンの羽根（中心=回転軸） */
  drawFanBlades(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.fillStyle(0xc0f1ff, 0.95);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI * 2) / 4;
      g.save();
      g.translateCanvas(x, y);
      g.rotateCanvas(a);
      g.fillEllipse(24, 0, 36, 16);
      g.restore();
    }
    g.fillStyle(0x3c6f9c, 1);
    g.fillCircle(x, y, 9);
    g.fillStyle(0xbfeaff, 1);
    g.fillCircle(x, y, 3.6);
  }

  createEnemyTextures(): void {
    const SS = 2;
    const enemyTex = (key: string, draw: (g: Phaser.GameObjects.Graphics, c: number) => void) => {
      genTex(this, key, 96 * SS, 96 * SS, (g) => {
        g.save();
        g.scaleCanvas(SS, SS);
        draw(g, 48);
        g.restore();
      });
    };
    const shadow = (g: Phaser.GameObjects.Graphics, c: number, w: number) => {
      g.fillStyle(0x000000, 0.16);
      g.fillEllipse(c, c + 30, w, 10);
    };
    const eye = (g: Phaser.GameObjects.Graphics, x: number, y: number, r = 5) => {
      g.fillStyle(0xfff7d8, 1);
      g.fillCircle(x, y, r);
      g.fillStyle(0x232b35, 1);
      g.fillCircle(x + r * 0.35, y, r * 0.5);
    };
    // カラス（羽ばたき2フレーム）
    const crow = (wingUp: boolean) => (g: Phaser.GameObjects.Graphics, c: number) => {
      shadow(g, c, 56);
      g.fillStyle(0x35445f, 1);
      g.fillTriangle(c - 26, c, c - 44, c - 8, c - 38, c + 6);
      g.fillTriangle(c - 26, c + 2, c - 42, c + 12, c - 34, c + 8);
      g.fillEllipse(c - 2, c, 62, 40);
      g.fillStyle(0x7d93ad, 1);
      g.fillEllipse(c + 2, c + 7, 40, 22);
      g.fillStyle(0x2c3a50, 1);
      if (wingUp) {
        g.fillEllipse(c - 6, c - 20, 40, 15);
        g.fillTriangle(c - 24, c - 18, c - 40, c - 30, c - 18, c - 8);
      } else {
        g.fillEllipse(c - 6, c + 18, 40, 15);
        g.fillTriangle(c - 24, c + 14, c - 40, c + 26, c - 16, c + 8);
      }
      g.fillStyle(0x54687f, 1);
      g.fillCircle(c + 24, c - 6, 12);
      g.fillStyle(0xf4b948, 1);
      g.fillTriangle(c + 33, c - 8, c + 47, c - 3, c + 33, c + 1);
      eye(g, c + 27, c - 9);
    };
    enemyTex("td-enemy-normal-a", crow(true));
    enemyTex("td-enemy-normal-b", crow(false));
    // コウモリ（羽ばたき2フレーム）
    const bat = (wingUp: boolean) => (g: Phaser.GameObjects.Graphics, c: number) => {
      shadow(g, c, 50);
      g.fillStyle(0x54355e, 1);
      if (wingUp) {
        g.fillTriangle(c - 6, c - 4, c - 42, c - 30, c - 30, c + 4);
        g.fillTriangle(c + 14, c - 4, c + 44, c - 26, c + 30, c + 6);
      } else {
        g.fillTriangle(c - 6, c + 2, c - 42, c + 26, c - 28, c + 10);
        g.fillTriangle(c + 14, c + 2, c + 44, c + 24, c + 30, c + 12);
      }
      g.fillStyle(0x85558e, 1);
      g.fillEllipse(c + 2, c, 42, 32);
      g.fillTriangle(c - 8, c - 12, c - 13, c - 26, c - 2, c - 15);
      g.fillTriangle(c + 12, c - 12, c + 8, c - 26, c + 17, c - 15);
      g.fillStyle(0xffd7d7, 1);
      g.fillCircle(c + 6, c - 3, 4.6);
      g.fillCircle(c + 16, c - 3, 4.6);
      g.fillStyle(0x8c1f2f, 1);
      g.fillCircle(c + 8, c - 3, 2.1);
      g.fillCircle(c + 18, c - 3, 2.1);
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(c + 3, c + 7, c + 8, c + 7, c + 5, c + 13);
      g.fillTriangle(c + 13, c + 7, c + 18, c + 7, c + 16, c + 13);
    };
    enemyTex("td-enemy-fast-a", bat(true));
    enemyTex("td-enemy-fast-b", bat(false));
    // 甲虫タンク
    enemyTex("td-enemy-tank", (g, c) => {
      shadow(g, c, 62);
      g.lineStyle(3.5, 0x3a302c, 1);
      for (let i = -1; i <= 1; i++) {
        g.lineBetween(c + i * 11, c - 8, c + i * 13, c - 27);
        g.lineBetween(c + i * 11, c + 8, c + i * 13, c + 27);
      }
      g.fillStyle(0x55744a, 1);
      g.fillEllipse(c - 2, c, 64, 46);
      g.lineStyle(2.5, 0x42592f, 1);
      g.strokeEllipse(c - 2, c, 64, 46);
      g.beginPath();
      g.arc(c - 4, c, 22, -1.1, 1.1, false);
      g.strokePath();
      g.beginPath();
      g.arc(c - 4, c, 12, -1.2, 1.2, false);
      g.strokePath();
      g.fillStyle(0xffffff, 0.22);
      g.fillEllipse(c - 12, c - 12, 22, 10);
      g.fillStyle(0x6d8a52, 1);
      g.fillCircle(c + 28, c, 11);
      g.lineStyle(3, 0xe8dcc0, 1);
      g.lineBetween(c + 24, c - 8, c + 34, c - 18);
      g.lineBetween(c + 24, c + 8, c + 34, c + 18);
      eye(g, c + 31, c - 4, 4.4);
    });
    // アリの群れ
    enemyTex("td-enemy-swarm", (g, c) => {
      shadow(g, c, 48);
      g.lineStyle(2.5, 0x3a302c, 1);
      for (let i = -1; i <= 1; i++) {
        g.lineBetween(c + i * 7, c - 4, c + i * 9, c - 19);
        g.lineBetween(c + i * 7, c + 4, c + i * 9, c + 19);
      }
      g.fillStyle(0xaa5138, 1);
      g.fillCircle(c - 16, c, 12);
      g.fillEllipse(c + 1, c, 30, 23);
      g.fillCircle(c + 19, c, 10.5);
      g.lineStyle(2, 0x74331f, 1);
      g.strokeCircle(c - 16, c, 12);
      g.lineBetween(c + 24, c - 7, c + 31, c - 15);
      g.lineBetween(c + 26, c - 4, c + 34, c - 9);
      eye(g, c + 22, c - 3, 3.2);
      g.fillStyle(0x000000, 0.14);
      g.fillCircle(c - 30, c + 14, 7);
      g.fillCircle(c - 24, c - 20, 6);
    });
    // ボス（王様）
    enemyTex("td-enemy-boss", (g, c) => {
      shadow(g, c, 72);
      g.fillStyle(0x6e3560, 1);
      g.fillTriangle(c - 20, c - 6, c - 46, c - 22, c - 34, c + 12);
      g.fillTriangle(c - 20, c + 8, c - 44, c + 24, c - 30, c + 16);
      g.fillStyle(0x8a4478, 1);
      g.fillEllipse(c - 2, c + 2, 70, 52);
      g.lineStyle(2.5, 0x63304f, 1);
      g.strokeEllipse(c - 2, c + 2, 70, 52);
      g.fillStyle(0xb96aa2, 1);
      g.fillEllipse(c + 2, c + 10, 46, 28);
      g.fillStyle(0xffd557, 1);
      g.fillPoints(
        [
          { x: c - 17, y: c - 20 }, { x: c - 21, y: c - 36 }, { x: c - 8, y: c - 27 },
          { x: c, y: c - 42 }, { x: c + 9, y: c - 27 }, { x: c + 20, y: c - 36 },
          { x: c + 16, y: c - 20 },
        ],
        true,
      );
      g.lineStyle(2, 0xd9a41c, 1);
      g.strokeRect(c - 17, c - 21, 33, 3);
      g.fillStyle(0xe2543e, 1);
      g.fillCircle(c, c - 19, 3);
      eye(g, c + 13, c - 5, 6);
      eye(g, c - 13, c - 5, 6);
      g.lineStyle(2.5, 0x3a2030, 1);
      g.lineBetween(c + 6, c - 14, c + 19, c - 11);
      g.lineBetween(c - 19, c - 11, c - 6, c - 14);
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(c + 6, c + 9, c + 12, c + 9, c + 9, c + 17);
      g.fillTriangle(c - 12, c + 9, c - 6, c + 9, c - 9, c + 17);
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
    const last = this.waypoints[this.waypoints.length - 1];
    this.housePos = { x: last.x, y: last.y };
    this.chimneyPos = { x: last.x + this.cell * 0.36, y: last.y - this.cell * 0.78 };
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
    this.entranceLabel.setPosition(this.ox + 6, this.oy + this.cell - 12);
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

  /**
   * 戦場を Canvas 2D で1枚絵に焼き込む（グラデーション・轍・石・小物まで）。
   * レイアウト変更時のみ再生成するので毎フレームのコストは画像1枚分。
   */
  buildFieldTexture(): void {
    const W = Math.max(2, Math.floor(this.scale.width));
    const H = Math.max(2, Math.floor(this.scale.height));
    if (this.textures.exists("td-field")) this.textures.remove("td-field");
    const tex = this.textures.createCanvas("td-field", W, H);
    if (!tex) return;
    const ctx = tex.getContext();
    const { cell, ox, oy } = this;
    const rnd = mulberry(20261025);

    // 全面の草原（放射グラデーションで光を落とす）
    const grad = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
    grad.addColorStop(0, "#a5d66d");
    grad.addColorStop(1, "#7fb54e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // 草のノイズ
    ctx.fillStyle = "rgba(70,110,40,0.20)";
    for (let i = 0; i < W * H * 0.0016; i++) {
      ctx.fillRect(rnd() * W, rnd() * H, 2.2, 2.2);
    }
    ctx.fillStyle = "rgba(230,255,180,0.16)";
    for (let i = 0; i < W * H * 0.001; i++) {
      ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
    }

    // セルのチェッカー＋麦の描き込み
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = ox + c * cell;
        const y = oy + r * cell;
        ctx.fillStyle = (c + r) % 2 === 0 ? "rgba(255,255,255,0.07)" : "rgba(30,70,20,0.06)";
        ctx.fillRect(x, y, cell, cell);
        if (!PATH_CELLS.has(`${c},${r}`)) {
          const gx = x + cell * (0.3 + rnd() * 0.4);
          const gy = y + cell * (0.55 + rnd() * 0.3);
          ctx.strokeStyle = "rgba(150,125,45,0.85)";
          ctx.lineWidth = Math.max(1.2, cell * 0.028);
          ctx.beginPath();
          for (let sIdx = -1; sIdx <= 1; sIdx++) {
            ctx.moveTo(gx + sIdx * cell * 0.09, gy);
            ctx.lineTo(gx + sIdx * cell * 0.06, gy - cell * 0.34);
          }
          ctx.stroke();
          ctx.fillStyle = "rgba(226,194,99,0.9)";
          for (let sIdx = -1; sIdx <= 1; sIdx++) {
            for (let i = 0; i < 3; i++) {
              ctx.beginPath();
              ctx.ellipse(gx + sIdx * cell * 0.06, gy - cell * 0.34 + i * cell * 0.07, cell * 0.045, cell * 0.028, 0, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
    }

    // 経路：縁→土→中央の摩耗、の順に重ねる
    const tracePath = () => {
      ctx.beginPath();
      this.waypoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    };
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#a97e3f";
    ctx.lineWidth = cell * 0.88;
    tracePath();
    ctx.stroke();
    ctx.strokeStyle = "#dcbd7f";
    ctx.lineWidth = cell * 0.8;
    tracePath();
    ctx.stroke();
    const wear = ctx.createLinearGradient(ox, oy, ox + cell * COLS, oy + cell * ROWS);
    wear.addColorStop(0, "rgba(240,214,150,0.55)");
    wear.addColorStop(1, "rgba(226,196,130,0.55)");
    ctx.strokeStyle = wear;
    ctx.lineWidth = cell * 0.52;
    tracePath();
    ctx.stroke();
    // 車の轍（破線2本）
    ctx.strokeStyle = "rgba(146,106,52,0.4)";
    ctx.lineWidth = Math.max(2, cell * 0.05);
    ctx.setLineDash([cell * 0.22, cell * 0.3]);
    for (const off of [-cell * 0.17, cell * 0.17]) {
      ctx.beginPath();
      for (let i = 0; i < this.waypoints.length - 1; i++) {
        const a = this.waypoints[i];
        const b = this.waypoints[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * off;
        const ny = (dx / len) * off;
        if (i === 0) ctx.moveTo(a.x + nx, a.y + ny);
        ctx.lineTo(b.x + nx, b.y + ny);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // 小石
    ctx.fillStyle = "rgba(140,135,125,0.8)";
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const a = this.waypoints[i];
      const b = this.waypoints[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.floor(len / (cell * 0.8));
      for (let sIdx = 0; sIdx < steps; sIdx++) {
        if (rnd() < 0.45) continue;
        const t = (sIdx + rnd()) / Math.max(1, steps);
        const px = a.x + (b.x - a.x) * t + (rnd() - 0.5) * cell * 0.5;
        const py = a.y + (b.y - a.y) * t + (rnd() - 0.5) * cell * 0.5;
        ctx.beginPath();
        ctx.ellipse(px, py, cell * (0.04 + rnd() * 0.04), cell * 0.035, rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 入口の木戸（左端・row1）
    const gateY = this.waypoints[0].y;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(ox + cell * 0.1, gateY + cell * 0.5, cell * 0.5, cell * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7a4f24";
    ctx.fillRect(ox - 2, gateY - cell * 0.52, cell * 0.14, cell * 1.04);
    ctx.fillRect(ox + cell * 0.28, gateY - cell * 0.52, cell * 0.14, cell * 1.04);
    ctx.fillRect(ox - 2, gateY - cell * 0.56, cell * 0.44, cell * 0.13);
    ctx.fillStyle = "#a06a30";
    ctx.fillRect(ox - 2, gateY - cell * 0.56, cell * 0.44, cell * 0.045);
    // 看板
    ctx.fillStyle = "#e8cf9a";
    ctx.fillRect(ox + cell * 0.02, gateY - cell * 0.4, cell * 0.26, cell * 0.24);
    ctx.strokeStyle = "#7a4f24";
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + cell * 0.02, gateY - cell * 0.4, cell * 0.26, cell * 0.24);
    ctx.fillStyle = "#b03a2e";
    ctx.beginPath();
    ctx.moveTo(ox + cell * 0.07, gateY - cell * 0.34);
    ctx.lineTo(ox + cell * 0.2, gateY - cell * 0.28);
    ctx.lineTo(ox + cell * 0.07, gateY - cell * 0.22);
    ctx.closePath();
    ctx.fill();

    // 農家（出口）。扉の位置＝経路の終点
    const hx = this.housePos.x;
    const hy = this.housePos.y;
    const hw = cell * 1.35;
    const hh = cell * 1.3;
    const wallTop = hy - hh * 0.42;
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(hx, hy + cell * 0.42, hw * 0.55, cell * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f3e3b3";
    ctx.fillRect(hx - hw / 2, wallTop, hw, hh * 0.72);
    ctx.strokeStyle = "#c9a86a";
    ctx.lineWidth = 2;
    ctx.strokeRect(hx - hw / 2, wallTop, hw, hh * 0.72);
    // 屋根
    ctx.fillStyle = "#b0512f";
    ctx.beginPath();
    ctx.moveTo(hx - hw * 0.62, wallTop + 2);
    ctx.lineTo(hx, wallTop - hh * 0.34);
    ctx.lineTo(hx + hw * 0.62, wallTop + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(120,50,25,0.55)";
    ctx.lineWidth = 1.6;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      ctx.beginPath();
      ctx.moveTo(hx - hw * 0.62 * (1 - t), wallTop + 2 - hh * 0.34 * t + hh * 0.085 * i * 0);
      ctx.lineTo(hx + hw * 0.62 * (1 - t), wallTop + 2 - hh * 0.34 * t);
      ctx.stroke();
    }
    // 煙突
    ctx.fillStyle = "#9a6a4a";
    ctx.fillRect(this.chimneyPos.x - cell * 0.07, this.chimneyPos.y, cell * 0.14, cell * 0.3);
    ctx.fillStyle = "#7c5236";
    ctx.fillRect(this.chimneyPos.x - cell * 0.09, this.chimneyPos.y - cell * 0.05, cell * 0.18, cell * 0.07);
    // 扉（経路の終点に合わせる）
    ctx.fillStyle = "#6b4423";
    const doorW = cell * 0.3;
    const doorH = cell * 0.52;
    ctx.fillRect(hx - doorW / 2, hy + cell * 0.4 - doorH, doorW, doorH);
    ctx.fillStyle = "#ffd94d";
    ctx.beginPath();
    ctx.arc(hx + doorW * 0.3, hy + cell * 0.4 - doorH / 2, cell * 0.035, 0, Math.PI * 2);
    ctx.fill();
    // 窓（暖色の明かり）
    ctx.fillStyle = "#ffd977";
    ctx.fillRect(hx - hw * 0.36, wallTop + hh * 0.16, cell * 0.24, cell * 0.24);
    ctx.strokeStyle = "#6b4423";
    ctx.lineWidth = 2;
    ctx.strokeRect(hx - hw * 0.36, wallTop + hh * 0.16, cell * 0.24, cell * 0.24);
    ctx.beginPath();
    ctx.moveTo(hx - hw * 0.36 + cell * 0.12, wallTop + hh * 0.16);
    ctx.lineTo(hx - hw * 0.36 + cell * 0.12, wallTop + hh * 0.16 + cell * 0.24);
    ctx.stroke();
    // 花壇
    const flowerCols = ["#ff8fb3", "#ffffff", "#c5a3ff", "#ffb35c"];
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = flowerCols[i % flowerCols.length];
      ctx.beginPath();
      ctx.arc(hx - hw * 0.42 + i * cell * 0.13, hy + cell * 0.44, cell * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }

    // 畑の外周フェンス（下辺・家を除く／左辺）
    ctx.strokeStyle = "rgba(122,79,36,0.9)";
    ctx.lineWidth = Math.max(2, cell * 0.05);
    const fenceY = oy + ROWS * cell + cell * 0.12;
    ctx.beginPath();
    ctx.moveTo(ox - cell * 0.2, fenceY);
    ctx.lineTo(hx - hw * 0.62, fenceY);
    ctx.moveTo(hx + hw * 0.62, fenceY);
    ctx.lineTo(ox + COLS * cell + cell * 0.2, fenceY);
    ctx.stroke();
    ctx.fillStyle = "#7a4f24";
    for (let x = ox - cell * 0.2; x <= ox + COLS * cell + cell * 0.2; x += cell * 0.8) {
      if (Math.abs(x - hx) < hw * 0.65) continue;
      ctx.fillRect(x - cell * 0.035, fenceY - cell * 0.12, cell * 0.07, cell * 0.26);
    }
    // コーナーの干し草俵
    const hay = (x: number, y: number, r: number) => {
      ctx.fillStyle = "#dcb95e";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#b8933a";
      ctx.lineWidth = 2;
      for (const rr of [0.7, 0.42]) {
        ctx.beginPath();
        ctx.arc(x, y, r * rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    hay(ox - cell * 0.55, oy + cell * 4.6, cell * 0.3);
    hay(ox + COLS * cell + cell * 0.55, oy + cell * 0.6, cell * 0.34);
    hay(ox + COLS * cell + cell * 0.5, oy + cell * 5.9, cell * 0.27);

    tex.refresh();
    this.fieldImg.setTexture("td-field");
  }

  /** 揺れる麦束・花を草原セルに配置（タフト） */
  placeTufts(): void {
    for (const t of this.wheatTufts) t.img.destroy();
    this.wheatTufts = [];
    const rnd = mulberry(777);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (PATH_CELLS.has(`${c},${r}`)) continue;
        const roll = rnd();
        if (roll > 0.42) continue;
        const isFlower = roll < 0.09;
        const key = isFlower ? "td-flower" : "td-wheat";
        const img = this.add.image(0, 0, key).setDepth(3).setOrigin(0.5, 1);
        const p = this.cellCenterPx(c, r);
        const dx = (rnd() - 0.5) * this.cell * 0.4;
        const dy = (rnd() - 0.5) * this.cell * 0.3;
        img.setPosition(p.x + dx, p.y + dy + this.cell * 0.42);
        const s = ((isFlower ? 0.62 : 0.85) * this.cell) / 56;
        img.setDisplaySize(48 * s * 0.62, 48 * s * 0.62);
        if (isFlower) img.setDisplaySize(40 * s * 0.62, 40 * s * 0.62);
        this.wheatTufts.push({ img, c, r, dx, dy, ph: rnd() * Math.PI * 2 });
      }
    }
  }

  setupInput(): void {
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.hover = this.toCell(p.x, p.y);
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const cellPos = this.toCell(p.x, p.y);
      if (!cellPos || this.phase === "over" || this.phase === "paused") return;
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
      const p = s.cellCenterPx(c, r);
      s.texts.spawn(p.x, p.y - 10, "🌾が足りない！", "#ff9a86", 0.9);
      s.hooks.onDeny?.();
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
    const baseImg = this.add.image(0, 0, `tower-${kind}-1`);
    cont.add(baseImg);
    let partA: Phaser.GameObjects.Image | null = null;
    let partB: Phaser.GameObjects.Image | null = null;
    let emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
    if (kind === "scarecrow") {
      partA = this.add.image(0, 0, "td-cannon").setOrigin(0.125, 0.5);
      cont.add(partA);
    } else if (kind === "sprinkler") {
      partA = this.add.image(0, 0, "rotor-bar");
      cont.add(partA);
      emitter = this.add.particles(0, 0, "tex-dot", {
        speed: { min: 46, max: 105 },
        angle: { min: 0, max: 360 },
        gravityY: 190,
        lifespan: { min: 300, max: 520 },
        quantity: 2,
        frequency: 36,
        scale: { start: 0.3, end: 0.05 },
        alpha: { start: 0.85, end: 0.15 },
        tint: 0x8fd8ff,
        emitting: false,
      });
      emitter.setDepth(24);
    } else if (kind === "fan") {
      partB = this.add.image(0, 0, "fan-mist").setAlpha(0.85);
      partA = this.add.image(0, 0, "fan-blades");
      cont.add(partB);
      cont.add(partA);
    } else if (kind === "thunder") {
      partB = this.add.image(0, 0, "thunder-glow");
      partA = this.add.image(0, 0, "thunder-orb");
      cont.add(partB);
      cont.add(partA);
    }
    const t: TowerE = {
      cont, partA, partB, emitter,
      id: this.nextId++, kind, c, r, lv: 1, invested: TOWERS[kind].cost, cd: 0,
      aimAng: -0.5, recoil: 0, rotorAng: 0, lastFire: -9, bornAt: this.animTime, flashAt: -9,
    };
    this.towers.push(t);
    this.positionTower(t);
    return t;
  }

  positionTower(t: TowerE): void {
    const p = this.cellCenterPx(t.c, t.r);
    t.cont.setPosition(p.x, p.y);
    const cell = this.cell;
    const base = t.cont.list[0] as Phaser.GameObjects.Image;
    const grow = 1 + 0.06 * (t.lv - 1);
    base.setTexture(`tower-${t.kind}-${t.lv}`);
    base.setDisplaySize(cell * 2 * grow, cell * 2 * grow);
    if (t.kind === "scarecrow" && t.partA) {
      t.partA.setPosition(cell * 0.1, -cell * 0.29);
      t.partA.setDisplaySize(cell * 1.9, cell * 0.54);
    } else if (t.kind === "sprinkler" && t.partA) {
      t.partA.setPosition(0, -cell * 0.5);
      t.partA.setDisplaySize(cell * 1.3, cell * 0.51);
    } else if (t.kind === "fan") {
      if (t.partB) {
        t.partB.setPosition(0, -cell * 0.43);
        t.partB.setDisplaySize(cell * 1.25, cell * 1.25);
      }
      if (t.partA) {
        t.partA.setPosition(0, -cell * 0.43);
        t.partA.setDisplaySize(cell * 0.95, cell * 0.95);
      }
    } else if (t.kind === "thunder") {
      if (t.partB) {
        t.partB.setPosition(0, -cell * 0.66);
        t.partB.setDisplaySize(cell * 1.35, cell * 1.35);
      }
      if (t.partA) {
        t.partA.setPosition(0, -cell * 0.66);
        t.partA.setDisplaySize(cell * 0.52, cell * 0.52);
      }
    }
    if (t.emitter) t.emitter.setPosition(p.x, p.y - cell * 0.5);
  }

  setPhase(p: TdPhase): void {
    this.phase = p;
    this.hooks.onPhase(p);
  }

  showBanner(text: string, dur = 1.6): void {
    this.bannerText = text;
    this.bannerStart = this.gtime;
    this.bannerDur = dur;
  }

  resetState(): void {
    for (const t of this.towers) {
      t.emitter?.destroy();
      t.cont.destroy();
    }
    for (const e of this.enemies) e.img.destroy();
    for (const d of this.dying) d.img.destroy();
    for (const p of this.projs) this.projPool.release(p.img);
    this.towers = [];
    this.enemies = [];
    this.dying = [];
    this.projs = [];
    this.bolts = [];
    this.particlePool?.clear();
    this.texts?.clear();
    this.dmgTexts?.clear();
    this.hurtVig?.clear();
    this.hitstop.reset();
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
    this.bannerStart = -9;
    this.hitUntil = 0;
    this.selectedId = null;
    this.hudDirty = true;
    this.hooks.onSelectTower(null);
    this.emitHud();
  }

  start(): void {
    this.resetState();
    this.setPhase("playing");
    sfx.startBgm("tower");
    this.startWave();
  }

  beginFromBuild(): void {
    this.setPhase("playing");
    sfx.startBgm("tower");
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
    if (s.wave % 5 === 0) s.showBanner(`WAVE ${s.wave} 👹 ボス接近！`, 1.9);
    else s.showBanner(`WAVE ${s.wave} ${waveName(s.wave)}`, 1.6);
    sfx.play("wavestart");
    if (s.wave % 5 === 0) sfx.play("warning");
    s.hudDirty = true;
  }

  endGame(): void {
    const s = this;
    const score = s.kills * 15 + s.wave * 800 + s.totalEarned;
    sfx.stopBgm();
    sfx.play("gameover");
    s.hooks.onGameOver({ wave: s.wave, kills: s.kills, score });
    s.setPhase("over");
  }

  damageEnemy(e: EnemyE, dmg: number, kind: TowerKind, showNum = false): void {
    const s = this;
    if (e.dead) return;
    e.hp -= dmg;
    e.flashUntil = s.gtime + 0.07;
    if (showNum) {
      const p = s.posAt(e.dist);
      s.dmgTexts.spawn(p.x, p.y - e.r * (s.cell / 56) - 14, `${Math.max(1, Math.round(dmg))}`, kind === "thunder" ? "#e9d5ff" : "#ffd28a", 0.6);
    }
    if (e.kind === "boss" && !e.enraged && e.hp > 0 && e.hp <= e.maxHp * 0.5) {
      e.enraged = true;
      s.showBanner("王様が激怒！ 移動速度アップ", 1.7);
      const p = s.posAt(e.dist);
      s.particlePool.burst(p.x, p.y, "#ff654a", 24, 150);
    }
    if (e.hp <= 0) {
      e.dead = true;
      e.poof = true;
      s.kills += 1;
      s.wheat += e.bounty;
      s.totalEarned += e.bounty;
      const p = s.posAt(e.dist);
      const cols: Record<EKind, string> = { normal: "#5b7292", fast: "#b07cc4", tank: "#7fae5c", swarm: "#c46a4a", boss: "#c46ab0" };
      s.particlePool.burst(p.x, p.y, cols[e.kind], e.kind === "boss" ? 26 : 9, 120);
      s.particlePool.burst(p.x, p.y, TOWERS[kind].color, e.kind === "boss" ? 20 : 7, 150);
      s.particlePool.burst(p.x, p.y, "#e8e4da", e.kind === "boss" ? 14 : 6, 70, 4.2);
      s.texts.spawn(p.x, p.y - 14, `+${e.bounty}🌾`, "#fff4a8", 0.85);
      if (e.kind === "boss") {
        s.cameras.main.shake(180, 0.005);
        s.hitstop.trigger(80);
      }
      sfx.play(e.kind === "boss" ? "boom" : "coin");
      s.hudDirty = true;
    }
  }

  update(_time: number, deltaMs: number): void {
    const dtReal = Math.min(0.05, deltaMs / 1000);
    this.animTime += dtReal;
    // タワーの動くパーツ
    for (const t of this.towers) {
      const firing = this.gtime - t.lastFire < 0.25;
      if (t.kind === "scarecrow" && t.partA) {
        t.recoil *= Math.exp(-9 * dtReal);
        t.partA.rotation = turnToward(t.partA.rotation, t.aimAng, 9 * dtReal);
        const bx = this.cell * 0.1;
        const by = -this.cell * 0.29;
        t.partA.setPosition(
          bx - Math.cos(t.partA.rotation) * t.recoil * this.cell * 0.1,
          by - Math.sin(t.partA.rotation) * t.recoil * this.cell * 0.1,
        );
      }
      if (t.kind === "sprinkler" && t.partA) {
        t.rotorAng += (firing ? 10.5 : 2.6) * dtReal;
        t.partA.rotation = t.rotorAng;
      }
      if (t.kind === "fan") {
        t.rotorAng += (5 + t.lv * 2.4) * dtReal;
        if (t.partA) t.partA.rotation = t.rotorAng;
        if (t.partB) {
          t.partB.rotation = -t.rotorAng * 0.22;
          t.partB.setAlpha(0.7 + Math.sin(this.animTime * 3 + t.id) * 0.18);
        }
      }
      if (t.kind === "thunder") {
        const charge = Phaser.Math.Clamp(1 - t.cd / (1 / towerStats("thunder", t.lv).rate), 0, 1);
        const flash = this.gtime - t.flashAt < 0.12 ? 1.45 : 1;
        const pulse = (0.92 + charge * 0.35 + Math.sin(this.animTime * 4 + t.id * 2) * 0.05) * flash;
        if (t.partA) t.partA.setScale((this.cell * 0.52 * pulse) / 128);
        if (t.partB) t.partB.setAlpha(0.25 + charge * 0.55 + (flash > 1 ? 0.3 : 0));
      }
      if (t.emitter) {
        const tp = this.cellCenterPx(t.c, t.r);
        t.emitter.setPosition(tp.x, tp.y - this.cell * 0.5);
        t.emitter.emitting = this.phase === "playing" && firing;
      }
      // 設置ポップ（コンテナ全体）
      const age = this.animTime - t.bornAt;
      if (age < 0.3) {
        const s = easeOutBack(Math.max(0, age / 0.3));
        t.cont.setScale(Math.max(0.05, s));
      } else if (t.cont.scaleX !== 1) {
        t.cont.setScale(1);
      }
    }
    // 揺れる麦束
    for (const tf of this.wheatTufts) {
      tf.img.rotation = Math.sin(this.animTime * 1.7 + tf.ph) * 0.075;
    }
    if (this.phase === "playing") {
      // ヒットストップ中はゲーム時間を止める（実時間で解除）
      const frozen = this.hitstop.tick(deltaMs);
      const dt = frozen ? 0 : Math.min(0.05, deltaMs / 1000) * this.speed;
      if (dt > 0) this.step(dt);
    }
    // 消えゆく敵（撃破ポフ）の更新は実時間で
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.ttl -= dtReal;
      const t01 = Math.max(0, d.ttl / d.max);
      d.img.setAlpha(t01);
      d.img.setScale(d.img.scaleX * (1 - 1.6 * dtReal));
      if (d.ttl <= 0) {
        d.img.destroy();
        this.dying.splice(i, 1);
      }
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

    // 煙突の煙
    s.smokeCd -= dt;
    if (s.smokeCd <= 0) {
      s.smokeCd = 0.42;
      s.particlePool.spawnOne(
        s.chimneyPos.x + (Math.random() - 0.5) * 4,
        s.chimneyPos.y - 4,
        -5 + Math.random() * 4,
        -26 - Math.random() * 8,
        "#eef0ea",
        11 + Math.random() * 6,
        1.5,
        0.55,
      );
    }

    // スポーン
    if (s.waveActive && s.queue.length > 0) {
      s.spawnCd -= dt;
      if (s.spawnCd <= 0) {
        const kind = s.queue.shift()!;
        const base = enemyBase(kind);
        const hpMul = waveHpMultiplier(s.wave);
        const key = kind === "normal" || kind === "fast" ? `td-enemy-${kind}-a` : `td-enemy-${kind}`;
        const img = s.add.image(0, 0, key).setDepth(22);
        img.setDisplaySize(base.r * 3 * (s.cell / 56), base.r * 3 * (s.cell / 56));
        s.enemies.push({
          img, id: s.nextId++, kind, dist: 0,
          hp: base.hp * hpMul, maxHp: base.hp * hpMul,
          spd: base.spd, bounty: Math.round(base.bounty * (1 + s.wave * BALANCE.rewardGrowth)),
          leak: base.leak, r: base.r,
          wetUntil: 0, enraged: false, slowUntil: 0, slowFactor: 1, dead: false,
          poof: false, spawnAt: s.gtime, flashUntil: 0, frame: 0,
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
        e.poof = false;
        s.baseHp = Math.max(0, s.baseHp - e.leak);
        s.hitUntil = s.gtime + 0.45;
        s.cameras.main.shake(120, 0.0035);
        s.hurtVig.flash(0.3);
        s.hitstop.trigger(40);
        s.particlePool.burst(s.housePos.x, s.housePos.y - s.cell * 0.2, "#e2543e", 12, 110);
        s.texts.spawn(s.housePos.x, s.housePos.y - s.cell * 0.75, `-${e.leak} ❤`, "#ff8a7a", 0.95);
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
      s.showBanner(`WAVE ${s.wave} クリア！ ボーナス +${bonus}🌾`, 1.8);
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
      let targetPos = { x: 0, y: 0 };
      for (const e of s.enemies) {
        if (e.dead) continue;
        const ep = s.posAt(e.dist);
        if (Math.hypot(ep.x - tp.x, ep.y - tp.y) <= st.range * s.cell + e.r * (s.cell / 56)) {
          if (!target || e.dist > target.dist) {
            target = e;
            targetPos = ep;
          }
        }
      }
      if (target) t.aimAng = Math.atan2(targetPos.y - (tp.y - s.cell * 0.29), targetPos.x - (tp.x + s.cell * 0.1));
      if (!target || t.cd > 0) continue;
      t.cd = 1 / st.rate;
      t.lastFire = s.gtime;
      const def = TOWERS[t.kind];
      if (t.kind === "scarecrow") {
        t.recoil = 1;
        const mx = tp.x + s.cell * 0.1 + Math.cos(t.aimAng) * s.cell * 0.85;
        const my = tp.y - s.cell * 0.29 + Math.sin(t.aimAng) * s.cell * 0.85;
        s.particlePool.burst(mx, my, "#ffd28a", 3, 70, 2.6);
        s.particlePool.spawnOne(mx, my - 3, 6, -22, "#cfd4d8", 9, 0.5, 0.4);
      }
      if (t.kind === "fan") {
        // 冷気のきらめき
        const a = Math.random() * Math.PI * 2;
        const rr = st.range * s.cell * (0.4 + Math.random() * 0.5);
        s.particlePool.spawnOne(tp.x + Math.cos(a) * rr, tp.y + Math.sin(a) * rr, 0, -12, "#dff7ff", 5, 0.7, 0.5);
      }
      if (t.kind === "thunder") {
        t.flashAt = s.gtime;
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
        const pts: { x: number; y: number }[] = [{ x: tp.x, y: tp.y - s.cell * 0.66 }];
        for (const e of chainTargets) {
          const ep = s.posAt(e.dist);
          const prev = pts[pts.length - 1];
          pts.push(
            { x: (prev.x + ep.x) / 2 + (Math.random() - 0.5) * 22, y: (prev.y + ep.y) / 2 + (Math.random() - 0.5) * 22 },
            { x: ep.x, y: ep.y },
          );
        }
        // 分岐（枝雷）
        const branches: { x: number; y: number }[][] = [];
        for (let i = 1; i < pts.length - 1; i++) {
          if (Math.random() < 0.55) continue;
          const p0 = pts[i];
          const a = Math.random() * Math.PI * 2;
          const l1 = 14 + Math.random() * 16;
          branches.push([
            { x: p0.x, y: p0.y },
            { x: p0.x + Math.cos(a) * l1 * 0.6, y: p0.y + Math.sin(a) * l1 * 0.6 },
            { x: p0.x + Math.cos(a + 0.5) * l1, y: p0.y + Math.sin(a + 0.5) * l1 },
          ]);
        }
        s.bolts.push({ pts, branches, ttl: 0.14 });
        for (const e of chainTargets) {
          const ep = s.posAt(e.dist);
          s.particlePool.burst(ep.x, ep.y, "#ffe14d", 4, 90, 2.4);
          s.damageEnemy(e, st.dmg * (e.wetUntil > s.gtime ? BALANCE.wetLightning : 1), "thunder", true);
        }
        sfx.play("thunder");
      } else {
        const img = s.projPool.obtain();
        img.setPosition(tp.x, tp.y - 8).setDisplaySize(11, 11);
        img.setTint(Phaser.Display.Color.HexStringToColor(def.color).color);
        s.projs.push({ img, targetId: target.id, dmg: st.dmg, kind: t.kind, slow: def.slow, dead: false, trailCd: 0 });
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
      // 軌跡
      p.trailCd -= dt;
      if (p.trailCd <= 0) {
        p.trailCd = 0.024;
        s.particlePool.spawnOne(p.img.x, p.img.y, 0, 0, TOWERS[p.kind].color, 6, 0.16, 0.9);
      }
      if (d <= stepLen + e.r * (s.cell / 56) * 0.4) {
        if (p.kind === "sprinkler") e.wetUntil = s.gtime + BALANCE.wetDuration;
        s.damageEnemy(e, p.dmg * (p.kind === "scarecrow" && e.slowUntil > s.gtime ? BALANCE.frozenCannon : 1), p.kind, p.kind === "scarecrow");
        if (p.slow && !e.dead) {
          e.slowFactor = 1 - p.slow;
          e.slowUntil = s.gtime + BALANCE.slowDuration;
          sfx.play("freeze");
        }
        s.particlePool.burst(ep.x, ep.y, TOWERS[p.kind].color, 4, 95, 2.6);
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
    s.dmgTexts.update(dt, 30);
  }

  cleanupDead(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        if (e.poof) {
          this.dying.push({ img: e.img, ttl: e.kind === "boss" ? 0.45 : 0.26, max: e.kind === "boss" ? 0.45 : 0.26 });
        } else {
          e.img.destroy();
        }
        this.enemies.splice(i, 1);
      }
    }
  }

  drawDynamic(): void {
    const s = this;
    const g = s.fxG;
    g.clear();
    const cell = s.cell;
    const k = s.cell / 56;

    // ボスのオーラ
    const boss = s.enemies.find((e) => e.kind === "boss" && !e.dead);
    if (boss) {
      const bp = s.posAt(boss.dist);
      const pulse = 1 + Math.sin(s.animTime * 5) * 0.07;
      s.bossAura
        .setVisible(true)
        .setPosition(bp.x, bp.y)
        .setDisplaySize(boss.r * 3.4 * k * pulse, boss.r * 3.4 * k * pulse)
        .setAlpha(0.55)
        .setTint(boss.enraged ? 0xff654a : 0xffd557);
    } else {
      s.bossAura.setVisible(false);
    }

    // 敵スプライトの位置・向き・状態表示
    for (const e of s.enemies) {
      const er = e.r * k;
      const p = s.posAt(e.dist);
      const p2 = s.posAt(e.dist + 2);
      // スポーンポップ
      const popT = Math.min(1, Math.max(0, (s.gtime - e.spawnAt) / 0.24));
      const pop = easeOutBack(popT);
      // 上下の揺れ（歩行・羽ばたき感）
      const bobFreq = e.kind === "swarm" ? 14 : e.kind === "fast" ? 12 : e.kind === "tank" ? 5 : 9;
      const bobAmp = e.kind === "tank" ? 1.1 : 2;
      const bobY = Math.sin(s.animTime * bobFreq + e.id * 1.7) * bobAmp * k;
      const size = e.r * 3 * k * Math.max(0.05, pop);
      e.img.setDisplaySize(size, size);
      e.img.setPosition(p.x, p.y + bobY);
      e.img.setRotation(Math.atan2(p2.y - p.y, p2.x - p.x) + Math.sin(s.animTime * 9 + e.id) * 0.05);
      // 羽ばたきフレーム切替
      if (e.kind === "normal" || e.kind === "fast") {
        const fr = Math.floor(s.animTime * (e.kind === "fast" ? 14 : 9) + e.id) % 2;
        if (fr !== e.frame) {
          e.frame = fr;
          e.img.setTexture(`td-enemy-${e.kind}-${fr === 0 ? "a" : "b"}`);
        }
      }
      const slowed = s.gtime < e.slowUntil;
      const wet = s.gtime < e.wetUntil;
      e.img.clearTint();
      if (s.gtime < e.flashUntil) e.img.setTintFill(0xffffff);
      else if (slowed) e.img.setTint(0xbfe9ff);
      else if (e.enraged) e.img.setTint(0xff9a86);
      // 濡れ：青い膜＋雫で明確に
      if (wet) {
        g.fillStyle(0x3fb9ff, 0.22);
        g.fillCircle(p.x, p.y + bobY, er * 1.05);
        g.fillStyle(0x219ee6, 1);
        g.fillTriangle(p.x + er - 5, p.y + bobY - er - 9, p.x + er + 5, p.y + bobY - er + 1, p.x + er - 5, p.y + bobY - er + 1);
        g.fillCircle(p.x + er, p.y + bobY - er, 4);
      }
      if (slowed) {
        g.fillStyle(0xbfe9ff, 0.16);
        g.fillCircle(p.x, p.y + bobY, er * 1.08);
        g.lineStyle(2, 0xe6fbff, 0.9);
        g.strokeCircle(p.x, p.y + bobY, er + 3);
      }
      // HPバー（角丸＋枠）
      if (e.hp < e.maxHp) {
        if (e.kind === "boss") {
          const bw = er * 2.7;
          const bh = 9;
          const bx = p.x - bw / 2;
          const by = p.y + bobY - er - 26;
          g.fillStyle(0x2a1030, 0.85);
          g.fillRoundedRect(bx - 2, by - 2, bw + 4, bh + 4, 4);
          g.fillStyle(0x52275e, 1);
          g.fillRoundedRect(bx, by, bw, bh, 3);
          g.fillStyle(0xc05ce0, 1);
          g.fillRoundedRect(bx, by, bw * Math.max(0, e.hp / e.maxHp), bh, 3);
          s.bossLabel.setVisible(true).setPosition(p.x, by - 11);
        } else {
          const bw = Math.max(30 * k, er * 2);
          const bx = p.x - bw / 2;
          const by = p.y + bobY - er - 11;
          g.fillStyle(0x000000, 0.5);
          g.fillRoundedRect(bx - 1, by - 1, bw + 2, 6.5, 3);
          g.fillStyle(0xff5252, 1);
          g.fillRoundedRect(bx, by, bw * Math.max(0, e.hp / e.maxHp), 4.5, 2);
        }
      }
    }
    if (!boss) s.bossLabel.setVisible(false);

    // 配置ゴースト（破線リム＋柔らかい射程）
    const sel = s.towers.find((t) => t.id === s.selectedId) ?? null;
    if (s.hover && s.phase !== "over") {
      const { c, r } = s.hover;
      const occupied = s.towers.some((t) => t.c === c && t.r === r);
      if (!occupied && !PATH_CELLS.has(`${c},${r}`)) {
        const kind = s.hooks.getSelectedKind();
        const def = TOWERS[kind];
        const p = s.cellCenterPx(c, r);
        const R = def.range * cell;
        g.fillStyle(0x4db8e8, 0.13);
        g.fillCircle(p.x, p.y, R);
        g.lineStyle(2, 0x2b8fc7, 0.75);
        const segs = 42;
        const dash = Math.floor(s.animTime * 6) % 2;
        for (let i = dash; i < segs; i += 2) {
          g.beginPath();
          g.arc(p.x, p.y, R, (i / segs) * Math.PI * 2, ((i + 1) / segs) * Math.PI * 2, false);
          g.strokePath();
        }
        s.ghostImg.setTexture(`tower-${kind}-full`);
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
      g.fillStyle(0xffffff, 0.12);
      g.fillCircle(p.x, p.y, st.range * cell);
      g.lineStyle(1.5, 0xffffff, 0.75);
      g.strokeCircle(p.x, p.y, st.range * cell);
      g.lineStyle(3, 0xffd94d, 1);
      g.strokeRect(s.ox + sel.c * cell + 2, s.oy + sel.r * cell + 2, cell - 4, cell - 4);
    }
    // 稲妻（グロー＋芯＋枝）
    for (const b of s.bolts) {
      const a = Math.max(0, b.ttl / 0.14);
      g.lineStyle(6.5, 0xffe14d, a * 0.3);
      g.beginPath();
      g.moveTo(b.pts[0].x, b.pts[0].y);
      for (let i = 1; i < b.pts.length; i++) g.lineTo(b.pts[i].x, b.pts[i].y);
      g.strokePath();
      g.lineStyle(2.6, 0xfff3a7, a);
      g.beginPath();
      g.moveTo(b.pts[0].x, b.pts[0].y);
      for (let i = 1; i < b.pts.length; i++) g.lineTo(b.pts[i].x, b.pts[i].y);
      g.strokePath();
      g.lineStyle(1.4, 0xffe14d, a * 0.65);
      for (const br of b.branches) {
        g.beginPath();
        g.moveTo(br[0].x, br[0].y);
        for (let i = 1; i < br.length; i++) g.lineTo(br[i].x, br[i].y);
        g.strokePath();
      }
    }
    // 被弾フラッシュ
    if (s.gtime < s.hitUntil) {
      g.fillStyle(0xe62823, (s.hitUntil - s.gtime) * 0.45);
      g.fillRect(s.ox, s.oy, cell * COLS, cell * ROWS);
    }
    // バナー（ポップイン＋フェード）
    const bt = (s.gtime - s.bannerStart) / s.bannerDur;
    if (s.bannerText && bt >= 0 && bt < 1) {
      const popIn = bt < 0.16 ? easeOutBack(bt / 0.16) : 1;
      const fade = bt > 0.78 ? 1 - (bt - 0.78) / 0.22 : 1;
      s.bannerObj
        .setText(s.bannerText)
        .setVisible(true)
        .setAlpha(Math.max(0, fade))
        .setScale(Math.max(0.05, popIn));
      s.bannerObj.setPosition(s.scale.width / 2, s.oy + cell * ROWS * 0.4);
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
    t.flashAt = this.gtime;
    this.positionTower(t);
    const p = this.cellCenterPx(t.c, t.r);
    this.particlePool.burst(p.x, p.y - 6, "#ffd94d", 14, 110);
    this.texts.spawn(p.x, p.y - this.cell * 0.8, `Lv${t.lv}!`, "#ffd94d", 0.8);
    sfx.play("levelup");
    this.hudDirty = true;
    this.emitSelection();
  }

  sellSelected(): void {
    const t = this.selectedTower();
    if (!t) return;
    this.wheat += Math.floor(t.invested * 0.7);
    const p = this.cellCenterPx(t.c, t.r);
    this.particlePool.burst(p.x, p.y, "#d8c394", 8, 80, 2.4);
    t.emitter?.destroy();
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
      scene.buildFieldTexture();
      scene.placeTufts();
    },
    autoPause: () => { if (scene.phase === "playing") scene.setPhase("paused"); },
  };
  return { game, api, destroy: () => { detach(); sfx.stopBgm("tower"); game.destroy(true); } };
}
