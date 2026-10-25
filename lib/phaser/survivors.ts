import * as Phaser from "phaser";
import { sfx } from "../sfx";
import {
  attachDprResize,
  baseGameConfig,
  dampFactor,
  ensureDot,
  genTex,
  ImagePool,
  ParticlePool,
  TextPool,
  turnToward,
} from "./common";

export type SurvivorsPhase = "idle" | "playing" | "levelup" | "paused" | "over";
export type CardDef = { id: string; icon: string; name: string; desc: string };
export type SurvivorsResult = {
  time: number;
  kills: number;
  level: number;
  score: number;
  killScore: number;
};
export type SurvivorsHud = {
  hp: number;
  maxHp: number;
  level: number;
  xpRatio: number;
  time: number;
  kills: number;
  chips: string[];
  bossRatio: number | null;
  bossStage: number;
};

export interface SurvivorsHooks {
  onPhase(p: SurvivorsPhase): void;
  onHud(h: SurvivorsHud): void;
  onLevelUp(cards: CardDef[], rerolled: boolean): void;
  onGameOver(r: SurvivorsResult): void;
}

export interface SurvivorsApi {
  start(): void;
  pause(): void;
  resume(): void;
  chooseCard(id: string): void;
  reroll(): void;
  autoPause(): void;
}

const WORLD = 2600;
const PLAYER_R = 21;

type EnemyKind = "crow" | "bat" | "cloud" | "bee" | "boar" | "elite" | "boss";
type EnemyE = {
  img: Phaser.GameObjects.Image;
  eid: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  spd: number;
  dmg: number;
  r: number;
  xp: number;
  score: number;
  flashT: number;
  orbitHitAt: number;
  age: number;
  action: number;
  aim: number;
  stage: number;
  seed: number;
  dead: boolean;
};
type BulletE = { img: Phaser.GameObjects.Image; vx: number; vy: number; dmg: number; life: number };
type MissileE = {
  obj: Phaser.GameObjects.Text;
  vx: number;
  vy: number;
  targetId: number;
  dmg: number;
  life: number;
  dead: boolean;
};
type GemE = { img: Phaser.GameObjects.Image; v: number; vx: number; vy: number; dead: boolean };
type HealE = { obj: Phaser.GameObjects.Text; x: number; y: number; dead: boolean };
type HazardE = {
  x: number; y: number; r: number; timer: number; active: number;
  vx: number; vy: number; fired: boolean; dead: boolean;
};

type Weapons = {
  critLv: number; dmgLv: number; rateLv: number; countLv: number;
  orbit: number; missile: number; thunder: number; speedLv: number; magnetLv: number;
};

type FullCard = CardDef & { apply: (sc: SurvivorsScene) => void };

const ENEMY_BASE: Record<EnemyKind, { hp: number; spd: number; dmg: number; r: number; xp: number; score: number }> = {
  crow: { hp: 16, spd: 80, dmg: 9, r: 16, xp: 1, score: 10 },
  bat: { hp: 9, spd: 130, dmg: 7, r: 13, xp: 1, score: 15 },
  bee: { hp: 15, spd: 115, dmg: 8, r: 14, xp: 2, score: 20 },
  boar: { hp: 100, spd: 54, dmg: 19, r: 25, xp: 4, score: 45 },
  cloud: { hp: 68, spd: 47, dmg: 16, r: 27, xp: 3, score: 30 },
  elite: { hp: 340, spd: 63, dmg: 20, r: 34, xp: 12, score: 300 },
  boss: { hp: 1500, spd: 41, dmg: 26, r: 54, xp: 40, score: 2000 },
};

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
export { fmtTime as survivorsFmtTime };

class SurvivorsScene extends Phaser.Scene {
  hooks!: SurvivorsHooks;

  phase: SurvivorsPhase = "idle";
  // ---- ゲーム状態（旧 S 型と同等） ----
  gtime = 0;
  px = WORLD / 2;
  py = WORLD / 2;
  pvx = 0;
  pvy = 0;
  hp = 100;
  maxHp = 100;
  level = 1;
  xp = 0;
  xpNext = 6;
  kills = 0;
  score = 0;
  weapons: Weapons = { critLv: 0, dmgLv: 0, rateLv: 0, countLv: 0, orbit: 0, missile: 0, thunder: 0, speedLv: 0, magnetLv: 0 };
  enemies: EnemyE[] = [];
  bullets: BulletE[] = [];
  missiles: MissileE[] = [];
  gems: GemE[] = [];
  heals: HealE[] = [];
  hazards: HazardE[] = [];
  bolts: { pts: { x: number; y: number }[]; ttl: number }[] = [];
  shotCd = 0;
  missileCd = 1;
  thunderCd = 2;
  orbitAngle = 0;
  spawnCd = 0.5;
  eliteAt = 60;
  bossAt = 180;
  eventAt = 45;
  eventIndex = 0;
  invulnUntil = 0;
  slow = 0;
  beam = 0;
  warningAt = 0;
  bannerText = "";
  bannerUntil = 0;
  nextId = 1;
  pendingCards: FullCard[] = [];
  rerolledFlag = false;

  // ---- 入力 ----
  keys = { left: false, right: false, up: false, down: false };
  joy = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };

  // ---- 表示オブジェクト ----
  player!: Phaser.GameObjects.Container;
  playerImg!: Phaser.GameObjects.Image;
  beamImg!: Phaser.GameObjects.Image;
  beamRing!: Phaser.GameObjects.Image;
  fxG!: Phaser.GameObjects.Graphics;
  bannerObj!: Phaser.GameObjects.Text;
  joyBase!: Phaser.GameObjects.Image;
  joyKnob!: Phaser.GameObjects.Image;
  vignette!: Phaser.GameObjects.Image;
  bulletPool!: ImagePool;
  gemPool!: ImagePool;
  particlePool!: ParticlePool;
  texts!: TextPool;
  bladeObjs: Phaser.GameObjects.Text[] = [];
  missileFree: Phaser.GameObjects.Text[] = [];
  healFree: Phaser.GameObjects.Text[] = [];
  hudTimer = 0;
  uiScale = 1;
  booted = false;
  autoStartOnBoot = false;

  constructor() {
    super("survivors");
  }

  preload(): void {
    this.load.image("mugi-raw", "/mugi.webp");
  }

  create(): void {
    this.createTextures();
    ensureDot(this);

    // 背景：麦畑タイル＋ワールド境界
    const bg = this.add.tileSprite(0, 0, WORLD, WORLD, "surv-bg").setOrigin(0, 0).setDepth(0);
    void bg;
    const border = this.add.graphics().setDepth(1);
    border.lineStyle(10, 0x7a5a1e, 1);
    border.strokeRect(0, 0, WORLD, WORLD);

    this.fxG = this.add.graphics().setDepth(40);

    // プレイヤー
    this.playerImg = this.add.image(0, 0, "mugi-circle").setDisplaySize(48, 48);
    const shadow = this.add.image(0, 24, "tex-dot").setDisplaySize(46, 15).setTint(0x354624).setAlpha(0.3);
    this.player = this.add.container(this.px, this.py, [shadow, this.playerImg]).setDepth(30);

    this.beamImg = this.add.image(0, 0, "beam-grad").setDisplaySize(56, 430).setOrigin(0.5, 1).setDepth(29).setVisible(false);
    this.beamRing = this.add.image(0, 0, "tex-ring").setDepth(29).setTint(0xfff6b6).setVisible(false);

    this.bulletPool = new ImagePool(this, "shot-dot", 25);
    this.gemPool = new ImagePool(this, "gem1", 15);
    this.particlePool = new ParticlePool(new ImagePool(this, "tex-dot", 35));
    this.texts = new TextPool(this, 60, 20);

    this.bannerObj = this.add
      .text(0, 0, "", { fontFamily: "sans-serif", fontStyle: "bold", fontSize: "40px", resolution: 2, color: "#ff5252" })
      .setOrigin(0.5)
      .setStroke("#ffffff", 7)
      .setDepth(90)
      .setScrollFactor(0)
      .setVisible(false);

    this.vignette = this.add
      .image(0, 0, "vignette")
      .setOrigin(0, 0)
      .setDepth(80)
      .setScrollFactor(0)
      .setVisible(false);

    this.joyBase = this.add.image(0, 0, "tex-dot").setDisplaySize(104, 104).setTint(0x23405a).setAlpha(0.3).setDepth(95).setScrollFactor(0).setVisible(false);
    this.joyKnob = this.add.image(0, 0, "tex-dot").setDisplaySize(44, 44).setTint(0x23405a).setAlpha(0.55).setDepth(96).setScrollFactor(0).setVisible(false);

    for (let i = 0; i < 5; i++) {
      const t = this.add.text(0, 0, "🗡️", { fontSize: "26px", resolution: 2 }).setOrigin(0.5).setDepth(28).setVisible(false);
      this.bladeObjs.push(t);
    }

    this.setupInput();
    this.layoutCamera();
    this.scale.on("resize", () => this.layoutCamera());
    this.resetState();
    this.booted = true;
    if (this.autoStartOnBoot) {
      this.autoStartOnBoot = false;
      this.start();
    }
  }

  createTextures(): void {
    // 麦畑タイル（180x180）
    genTex(this, "surv-bg", 180, 180, (g) => {
      g.fillStyle(0xc9dd7e, 1);
      g.fillRect(0, 0, 180, 180);
      g.fillStyle(0x785a14, 0.1);
      g.fillEllipse(40, 50, 42, 14);
      g.fillEllipse(130, 120, 52, 16);
      g.fillEllipse(90, 160, 36, 12);
      g.lineStyle(2, 0x719344, 0.5);
      for (const [x, y] of [[30, 90], [80, 40], [140, 70], [60, 140], [160, 160], [110, 100]] as const) {
        g.lineBetween(x, y + 10, x + 3, y - 12);
        g.lineBetween(x + 3, y - 6, x - 3, y - 10);
        g.lineBetween(x + 3, y - 6, x + 9, y - 10);
      }
      g.fillStyle(0xf9eed7, 1);
      g.fillCircle(150, 30, 4);
      g.fillCircle(24, 150, 3);
    });

    const SS = 2; // テクスチャのスーパーサンプリング
    const enemyTex = (kind: EnemyKind, draw: (g: Phaser.GameObjects.Graphics, c: number) => void) => {
      const size = 120 * SS;
      genTex(this, `enemy-${kind}`, size, size, (g) => {
        g.save();
        g.scaleCanvas(SS, SS);
        draw(g, 60);
        g.restore();
      });
    };
    const bodyGrad = (g: Phaser.GameObjects.Graphics, c: number, top: number, bottom: number) => {
      g.fillStyle(top, 1);
      g.fillEllipse(c, c + 2, 34, 40);
      g.fillStyle(bottom, 0.55);
      g.fillEllipse(c, c + 12, 30, 24);
    };
    enemyTex("crow", (g, c) => {
      g.fillStyle(0x42536a, 1);
      g.fillTriangle(c, c, c - 46, c - 22, c - 14, c + 8);
      g.fillTriangle(c, c, c + 46, c - 22, c + 14, c + 8);
      bodyGrad(g, c, 0x53677f, 0x172238);
      g.fillStyle(0xf4b948, 1);
      g.fillTriangle(c + 4, c - 14, c + 22, c - 8, c + 3, c - 4);
      g.fillStyle(0xfff0a8, 1);
      g.fillCircle(c + 5, c - 7, 3);
    });
    enemyTex("bat", (g, c) => {
      g.fillStyle(0x6d5580, 1);
      g.fillTriangle(c, c, c - 50, c - 26, c - 30, c + 4);
      g.fillTriangle(c - 30, c + 4, c - 42, c + 16, c - 12, c + 12);
      g.fillTriangle(c, c, c + 50, c - 26, c + 30, c + 4);
      g.fillTriangle(c + 30, c + 4, c + 42, c + 16, c + 12, c + 12);
      bodyGrad(g, c, 0x7d6394, 0x241a33);
      g.fillStyle(0xf4b948, 1);
      g.fillTriangle(c + 3, c - 12, c + 18, c - 7, c + 2, c - 3);
      g.fillStyle(0xffd7d7, 1);
      g.fillCircle(c + 4, c - 6, 3);
    });
    enemyTex("bee", (g, c) => {
      g.fillStyle(0xe6faff, 0.75);
      g.fillEllipse(c - 16, c - 16, 30, 13);
      g.fillEllipse(c + 16, c - 16, 30, 13);
      g.fillStyle(0xffcd4d, 1);
      g.fillEllipse(c, c, 40, 26);
      g.fillStyle(0x49341e, 1);
      g.fillRect(c - 8, c - 11, 6, 22);
      g.fillRect(c + 4, c - 11, 6, 22);
      g.fillTriangle(c - 20, c, c - 30, c - 4, c - 30, c + 4);
    });
    enemyTex("boar", (g, c) => {
      g.fillStyle(0x79513d, 1);
      g.fillRect(c - 20, c + 8, 8, 14);
      g.fillRect(c + 14, c + 8, 8, 14);
      g.fillEllipse(c, c, 56, 36);
      g.fillStyle(0xd77b4e, 1);
      g.fillEllipse(c + 4, c - 4, 44, 26);
      g.fillStyle(0xe9c7a1, 1);
      g.fillRect(c + 18, c - 6, 13, 13);
      g.lineStyle(4, 0xfff4d5, 1);
      g.lineBetween(c + 27, c + 8, c + 34, c - 3);
      g.fillStyle(0x2b1c10, 1);
      g.fillCircle(c + 10, c - 6, 3);
    });
    enemyTex("cloud", (g, c) => {
      g.fillStyle(0x53677f, 1);
      g.fillCircle(c - 18, c + 4, 20);
      g.fillCircle(c + 4, c - 10, 24);
      g.fillCircle(c + 20, c + 6, 18);
      g.fillCircle(c, c + 8, 22);
      g.fillStyle(0x6d84a0, 1);
      g.fillCircle(c + 2, c - 12, 16);
      g.fillStyle(0xffe36e, 1);
      g.fillPoints(
        [
          { x: c + 2, y: c + 2 },
          { x: c - 7, y: c + 18 },
          { x: c + 2, y: c + 15 },
          { x: c - 2, y: c + 30 },
          { x: c + 13, y: c + 9 },
          { x: c + 4, y: c + 11 },
        ],
        true,
      );
    });
    enemyTex("elite", (g, c) => {
      g.fillStyle(0x8a5a34, 1);
      g.fillTriangle(c, c, c - 48, c - 24, c - 14, c + 9);
      g.fillTriangle(c, c, c + 48, c - 24, c + 14, c + 9);
      bodyGrad(g, c, 0xa06a3c, 0x2e1d0e);
      g.fillStyle(0xfff3d4, 1);
      g.fillCircle(c, c - 11, 11);
      g.fillStyle(0xffd94d, 1);
      g.fillTriangle(c - 10, c - 26, c - 6, c - 17, c, c - 29);
      g.fillTriangle(c, c - 29, c + 6, c - 17, c + 10, c - 26);
      g.fillTriangle(c + 4, c - 13, c + 22, c - 8, c + 3, c - 3);
      g.fillStyle(0xfff0a8, 1);
      g.fillCircle(c + 5, c - 7, 3);
    });
    enemyTex("boss", (g, c) => {
      // 竜巻：積み重なった渦
      for (let i = 0; i < 9; i++) {
        const y = c + 26 - i * 6.5;
        const r = 8 + i * 4.6;
        g.lineStyle(6, i % 2 ? 0xd5edf1 : 0x637e98, 1);
        g.beginPath();
        g.arc(0 + c + Math.sin(i * 1.7) * 3, y, r, i * 0.8, i * 0.8 + 4.4, false);
        g.strokePath();
      }
      g.fillStyle(0x6b512f, 1);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.9;
        g.fillRect(c + Math.cos(a) * 34 - 3, c + Math.sin(a) * 15 - 2, 7, 4);
      }
    });

    genTex(this, "shot-dot", 24, 24, (g) => {
      g.fillStyle(0xffcf3f, 1);
      g.fillCircle(12, 12, 9);
      g.fillStyle(0xfff3b0, 1);
      g.fillCircle(12, 12, 4.5);
    });
    genTex(this, "gem1", 28, 28, (g) => {
      g.fillStyle(0xffdf6a, 0.35);
      g.fillCircle(14, 14, 12);
      g.fillStyle(0xffd05a, 1);
      g.fillEllipse(14, 14, 9, 16);
      g.lineStyle(2, 0xa9742e, 1);
      g.lineBetween(12, 19, 16, 9);
    });
    genTex(this, "gem5", 36, 36, (g) => {
      g.fillStyle(0xffdf6a, 0.4);
      g.fillCircle(18, 18, 16);
      g.fillStyle(0xfff1aa, 1);
      g.fillEllipse(18, 18, 13, 22);
      g.lineStyle(2, 0xa9742e, 1);
      g.lineBetween(16, 24, 20, 12);
    });
    // レベルアップの光柱グラデーション
    genTex(this, "beam-grad", 64, 256, (g) => {
      g.fillGradientStyle(0xfff5b0, 0xfff5b0, 0xfff5b0, 0xfff5b0, 0, 0, 0.85, 0.85);
      g.fillRect(0, 0, 64, 256);
    });
    genTex(this, "vignette", 256, 256, (g) => {
      g.fillGradientStyle(0xc51e23, 0xc51e23, 0xc51e23, 0xc51e23, 0, 0, 1, 1);
      g.fillRect(0, 0, 256, 256);
    });

    // むぎアイコンを円形に切り抜いたキャンバステクスチャ
    if (!this.textures.exists("mugi-circle")) {
      try {
        const src = this.textures.get("mugi-raw").getSourceImage() as HTMLImageElement;
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 96;
        const c2 = canvas.getContext("2d");
        if (c2 && src.width > 0) {
          c2.beginPath();
          c2.arc(48, 48, 47, 0, Math.PI * 2);
          c2.fillStyle = "#ffffff";
          c2.fill();
          c2.clip();
          c2.drawImage(src, 2, 2, 92, 92);
          this.textures.addCanvas("mugi-circle", canvas);
        }
      } catch {
        /* フォールバックへ */
      }
    }
    if (!this.textures.exists("mugi-circle")) {
      genTex(this, "mugi-circle", 96, 96, (g) => {
        g.fillStyle(0xffffff, 1);
        g.fillCircle(48, 48, 47);
        g.fillStyle(0xaee3ff, 1);
        g.fillCircle(48, 48, 42);
        g.fillStyle(0x23405a, 1);
        g.fillCircle(36, 44, 5);
        g.fillCircle(60, 44, 5);
        g.fillEllipse(48, 58, 16, 9);
      });
    }
  }

  layoutCamera(): void {
    const cam = this.cameras.main;
    const vw = this.scale.width;
    const vh = this.scale.height;
    let targetW = vw >= vh ? 1040 : 620;
    let zoom = vw / targetW;
    if (vh / zoom < 520) zoom = vh / 520;
    if (vh / zoom > 980) zoom = vh / 980;
    cam.setZoom(zoom);
    cam.setBounds(0, 0, WORLD, WORLD);
    this.vignette?.setDisplaySize(vw, vh);
    this.bannerObj?.setPosition(vw / 2, vh * 0.32);
    this.uiScale = this.scale.displayScale.x || 1;
    this.joyBase?.setDisplaySize(104 * this.uiScale, 104 * this.uiScale);
    this.joyKnob?.setDisplaySize(44 * this.uiScale, 44 * this.uiScale);
  }

  setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture(["UP", "DOWN", "LEFT", "RIGHT", "SPACE", "W", "A", "S", "D"]);
      const cursors = kb.createCursorKeys();
      const wasd = kb.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;
      const poll = () => {
        this.keys.left = cursors.left.isDown || wasd.A.isDown;
        this.keys.right = cursors.right.isDown || wasd.D.isDown;
        this.keys.up = cursors.up.isDown || wasd.W.isDown;
        this.keys.down = cursors.down.isDown || wasd.S.isDown;
      };
      this.events.on("update", poll);
      kb.on("keydown-P", () => this.togglePause());
      kb.on("keydown-ESC", () => this.togglePause());
    }
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.phase !== "playing") return;
      this.joy.active = true;
      this.joy.id = p.id;
      this.joy.ox = p.x;
      this.joy.oy = p.y;
      this.joy.dx = 0;
      this.joy.dy = 0;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.joy.active || p.id !== this.joy.id) return;
      let dx = (p.x - this.joy.ox) / (52 * this.uiScale);
      let dy = (p.y - this.joy.oy) / (52 * this.uiScale);
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      this.joy.dx = dx;
      this.joy.dy = dy;
    });
    const release = (p: Phaser.Input.Pointer) => {
      if (p.id === this.joy.id) {
        this.joy.active = false;
        this.joy.dx = 0;
        this.joy.dy = 0;
      }
    };
    this.input.on("pointerup", release);
    this.input.on("pointerupoutside", release);
  }

  togglePause(): void {
    if (this.phase === "playing") this.setPhase("paused");
    else if (this.phase === "paused") this.setPhase("playing");
  }

  setPhase(p: SurvivorsPhase): void {
    this.phase = p;
    if (p !== "playing") {
      this.joy.active = false;
      this.joyBase.setVisible(false);
      this.joyKnob.setVisible(false);
    }
    this.hooks.onPhase(p);
  }

  resetState(): void {
    for (const e of this.enemies) e.img.destroy();
    for (const b of this.bullets) this.bulletPool.release(b.img);
    for (const m of this.missiles) m.obj.destroy();
    for (const g of this.gems) this.gemPool.release(g.img);
    for (const h of this.heals) h.obj.destroy();
    this.enemies = [];
    this.bullets = [];
    this.missiles = [];
    this.gems = [];
    this.heals = [];
    this.hazards = [];
    this.bolts = [];
    this.particlePool?.clear();
    this.texts?.clear();
    this.gtime = 0;
    this.px = WORLD / 2;
    this.py = WORLD / 2;
    this.pvx = 0;
    this.pvy = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.level = 1;
    this.xp = 0;
    this.xpNext = 6;
    this.kills = 0;
    this.score = 0;
    this.weapons = { critLv: 0, dmgLv: 0, rateLv: 0, countLv: 0, orbit: 0, missile: 0, thunder: 0, speedLv: 0, magnetLv: 0 };
    this.shotCd = 0;
    this.missileCd = 1;
    this.thunderCd = 2;
    this.orbitAngle = 0;
    this.spawnCd = 0.5;
    this.eliteAt = 60;
    this.bossAt = 180;
    this.eventAt = 45;
    this.eventIndex = 0;
    this.invulnUntil = 0;
    this.slow = 0;
    this.beam = 0;
    this.warningAt = 0;
    this.bannerText = "";
    this.bannerUntil = 0;
    this.pendingCards = [];
    this.rerolledFlag = false;
    this.player.setPosition(this.px, this.py);
    this.cameras.main.centerOn(this.px, this.py);
    this.emitHud();
  }

  start(): void {
    this.resetState();
    this.setPhase("playing");
  }

  // ================= 更新 =================
  update(_time: number, deltaMs: number): void {
    const rawDt = Math.min(0.033, deltaMs / 1000);
    // ジョイスティック表示はフェーズ不問で追従
    if (this.joy.active && this.phase === "playing") {
      this.joyBase.setVisible(true).setPosition(this.joy.ox, this.joy.oy);
      this.joyKnob.setVisible(true).setPosition(this.joy.ox + this.joy.dx * 34 * this.uiScale, this.joy.oy + this.joy.dy * 34 * this.uiScale);
    } else {
      this.joyBase.setVisible(false);
      this.joyKnob.setVisible(false);
    }
    if (this.phase !== "playing") return;
    let dt = rawDt;
    if (this.slow > 0) {
      this.slow = Math.max(0, this.slow - rawDt);
      dt = rawDt * 0.12;
    }
    if (dt <= 0) return;
    this.step(dt, rawDt);
    this.hudTimer += rawDt;
    if (this.hudTimer >= 0.12) {
      this.hudTimer = 0;
      this.emitHud();
    }
  }

  step(dt: number, rawDt: number): void {
    const s = this;
    s.gtime += dt;
    s.beam = Math.max(0, s.beam - dt);
    if (s.hp / s.maxHp < 0.25 && s.gtime >= s.warningAt) {
      sfx.play("warning");
      s.warningAt = s.gtime + 2;
    }
    const w = s.weapons;

    // ---- 移動（加速度＋減衰で滑らかに） ----
    let mx = 0;
    let my = 0;
    if (s.keys.left) mx -= 1;
    if (s.keys.right) mx += 1;
    if (s.keys.up) my -= 1;
    if (s.keys.down) my += 1;
    if (s.joy.active && (Math.abs(s.joy.dx) > 0.12 || Math.abs(s.joy.dy) > 0.12)) {
      mx = s.joy.dx;
      my = s.joy.dy;
    }
    const mlen = Math.hypot(mx, my);
    const maxSpd = 205 * (1 + 0.08 * w.speedLv);
    let tvx = 0;
    let tvy = 0;
    if (mlen > 0.01) {
      const n = Math.max(1, mlen);
      tvx = (mx / n) * maxSpd * Math.min(1, mlen);
      tvy = (my / n) * maxSpd * Math.min(1, mlen);
    }
    const f = dampFactor(11, dt);
    s.pvx += (tvx - s.pvx) * f;
    s.pvy += (tvy - s.pvy) * f;
    s.px = Phaser.Math.Clamp(s.px + s.pvx * dt, PLAYER_R, WORLD - PLAYER_R);
    s.py = Phaser.Math.Clamp(s.py + s.pvy * dt, PLAYER_R, WORLD - PLAYER_R);
    s.player.setPosition(s.px, s.py);
    const lean = Phaser.Math.Clamp(s.pvx / maxSpd, -1, 1) * 0.13;
    s.player.rotation += (lean - s.player.rotation) * dampFactor(10, dt);
    const blink = s.gtime < s.invulnUntil && Math.floor(s.gtime * 14) % 2 === 0;
    s.playerImg.setAlpha(blink ? 0.35 : 1);
    // カメラは補間で滑らかに追従（境界でクランプ）
    const cam = s.cameras.main;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    cam.scrollX = Phaser.Math.Clamp(
      cam.scrollX + (s.px - viewW / 2 - cam.scrollX) * dampFactor(7, dt),
      0, Math.max(0, WORLD - viewW),
    );
    cam.scrollY = Phaser.Math.Clamp(
      cam.scrollY + (s.py - viewH / 2 - cam.scrollY) * dampFactor(7, dt),
      0, Math.max(0, WORLD - viewH),
    );

    // レベルアップ光柱
    if (s.beam > 0) {
      s.beamImg.setVisible(true).setPosition(s.px, s.py + 22).setAlpha((s.beam / 0.85) * 0.85);
      s.beamRing.setVisible(true).setPosition(s.px, s.py + 16);
      const rr = 40 + (0.85 - s.beam) * 130;
      s.beamRing.setDisplaySize(rr * 2, rr * 0.85).setAlpha(s.beam / 0.85);
    } else {
      s.beamImg.setVisible(false);
      s.beamRing.setVisible(false);
    }

    s.spawnLogic(dt);
    s.weaponLogic(dt);
    s.projectileLogic(dt);
    s.enemyLogic(dt, rawDt);
    if (s.phase !== "playing") return; // 接触死などで終了していたら打ち切る
    s.pickupLogic(dt);
    s.fxLogic(dt);
  }

  spawnLogic(dt: number): void {
    const s = this;
    s.spawnCd -= dt;
    if (s.spawnCd <= 0 && s.enemies.length < 150) {
      s.spawnCd = Math.max(0.38, 1.45 - s.gtime * 0.004) * (1 + 0.32 * Math.sin((s.gtime * Math.PI * 2) / 24));
      const batch = Math.min(6, 1 + Math.floor(s.gtime / 50));
      for (let i = 0; i < batch && s.enemies.length < 150; i++) {
        const roll = Math.random();
        let kind: EnemyKind = "crow";
        if (s.gtime > 75 && roll > 0.85) kind = "boar";
        else if (s.gtime > 30 && roll > 0.65) kind = "bee";
        else if (s.gtime > 55 && roll < 0.13) kind = "cloud";
        else if (s.gtime > 18 && roll < 0.4) kind = "bat";
        s.spawnEnemy(kind);
      }
    }
    if (s.gtime >= s.eventAt) {
      s.eventAt += 45;
      const ring = s.eventIndex++ % 2 === 0;
      s.setBanner(ring ? "包囲襲来！ 隙間を抜けよう" : "収穫祭！ 麦粒シャワー", 3);
      for (let i = 0; i < (ring ? 16 : 24); i++) {
        const a = (i * Math.PI * 2) / (ring ? 16 : 24);
        if (ring && s.enemies.length < 150) {
          const e = s.spawnEnemy("crow");
          e.img.x = Phaser.Math.Clamp(s.px + Math.cos(a) * 440, 30, WORLD - 30);
          e.img.y = Phaser.Math.Clamp(s.py + Math.sin(a) * 440, 30, WORLD - 30);
        } else if (!ring) {
          s.dropGem(
            Phaser.Math.Clamp(s.px + Math.cos(a) * 180, 25, WORLD - 25),
            Phaser.Math.Clamp(s.py + Math.sin(a) * 180, 25, WORLD - 25),
            1, 0, 0,
          );
        }
      }
    }
    if (s.gtime >= s.eliteAt) {
      s.eliteAt += 60;
      s.spawnEnemy("elite");
      s.setBanner("⚠️ エリート出現！", 2);
    }
    if (s.gtime >= s.bossAt) {
      s.bossAt += 120;
      s.spawnEnemy("boss");
      s.setBanner("🌪️ ボス出現！！", 2.5);
      s.cameras.main.shake(200, 0.006);
      sfx.play("thunder");
    }
  }

  spawnEnemy(kind: EnemyKind): EnemyE {
    const s = this;
    const scale = 1 + Math.max(0, s.gtime - 20) / 105;
    const spdScale = 1 + Math.min(0.5, s.gtime / 600);
    const wv = s.cameras.main.worldView;
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.hypot(wv.width, wv.height) / 2 + 60 + Math.random() * 80;
    const x = Phaser.Math.Clamp(s.px + Math.cos(ang) * dist, 30, WORLD - 30);
    const y = Phaser.Math.Clamp(s.py + Math.sin(ang) * dist, 30, WORLD - 30);
    const base = ENEMY_BASE[kind];
    const img = s.add.image(x, y, `enemy-${kind}`).setDepth(20);
    const size = 120 * (base.r / 22);
    img.setDisplaySize(size, size);
    const e: EnemyE = {
      img, eid: s.nextId++, kind,
      hp: base.hp * scale, maxHp: base.hp * scale,
      spd: base.spd * spdScale * (0.9 + Math.random() * 0.2),
      dmg: base.dmg, r: base.r, xp: base.xp, score: base.score,
      flashT: 0, orbitHitAt: 0, age: 0, action: 2 + Math.random() * 3,
      aim: 0, stage: 1, seed: Math.random() * 10, dead: false,
    };
    s.enemies.push(e);
    return e;
  }

  weaponLogic(dt: number): void {
    const s = this;
    const w = s.weapons;
    // 基本ショット
    const shotDmg = 10 + 6 * w.dmgLv;
    const shotCdMax = 0.5 * Math.pow(0.9, w.rateLv);
    s.shotCd -= dt;
    if (s.shotCd <= 0) {
      let target: EnemyE | null = null;
      let best = 580;
      for (const e of s.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.img.x - s.px, e.img.y - s.py);
        if (d < best) { best = d; target = e; }
      }
      if (target) {
        s.shotCd = shotCdMax;
        const baseAng = Math.atan2(target.img.y - s.py, target.img.x - s.px);
        const count = 1 + w.countLv;
        for (let i = 0; i < count; i++) {
          const a = baseAng + (i - (count - 1) / 2) * 0.14;
          const img = s.bulletPool.obtain();
          img.setPosition(s.px, s.py).setDisplaySize(11, 11).setDepth(25);
          s.bullets.push({ img, vx: Math.cos(a) * 540, vy: Math.sin(a) * 540, dmg: shotDmg, life: 1.1 });
        }
        sfx.play("shoot");
      } else {
        s.shotCd = 0.08;
      }
    }
    // 回転ガマ
    if (w.orbit > 0) {
      s.orbitAngle += dt * 2.7;
      const bladeDmg = 12 + 5 * w.orbit;
      for (let i = 0; i < w.orbit; i++) {
        const a = s.orbitAngle + (i * Math.PI * 2) / w.orbit;
        const bx = s.px + Math.cos(a) * 80;
        const by = s.py + Math.sin(a) * 80;
        const blade = s.bladeObjs[i];
        blade.setVisible(true).setPosition(bx, by).setRotation(a + Math.PI / 2);
        for (const e of s.enemies) {
          if (e.dead) continue;
          if (s.gtime - e.orbitHitAt < 0.38) continue;
          if (Math.hypot(e.img.x - bx, e.img.y - by) < e.r + 20) {
            e.orbitHitAt = s.gtime;
            s.damageEnemy(e, bladeDmg);
          }
        }
      }
    } else {
      for (const b of s.bladeObjs) b.setVisible(false);
    }
    // 追尾ミサイル
    if (w.missile > 0) {
      s.missileCd -= dt;
      if (s.missileCd <= 0 && s.enemies.some((e) => !e.dead)) {
        s.missileCd = 1.7;
        for (let i = 0; i < w.missile; i++) {
          const alive = s.enemies.filter((e) => !e.dead);
          const e = alive[Math.floor(Math.random() * alive.length)];
          const a = Math.random() * Math.PI * 2;
          const obj = s.missileFree.pop() ?? s.add.text(0, 0, "🚀", { fontSize: "22px", resolution: 2 }).setOrigin(0.5).setDepth(26);
          obj.setPosition(s.px, s.py).setVisible(true).setActive(true);
          s.missiles.push({ obj, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, targetId: e.eid, dmg: 24 + 9 * w.missile, life: 3.5, dead: false });
        }
        sfx.play("shoot");
      }
    }
    // 雷撃
    if (w.thunder > 0) {
      s.thunderCd -= dt;
      if (s.thunderCd <= 0 && s.enemies.some((e) => !e.dead)) {
        s.thunderCd = Math.max(1.6, 3.4 - 0.25 * w.thunder);
        const strikes = 1 + Math.floor(w.thunder / 2);
        const tdmg = 30 + 11 * w.thunder;
        const sorted = s.enemies
          .filter((e) => !e.dead && Math.hypot(e.img.x - s.px, e.img.y - s.py) < 660)
          .sort((a, b) => b.hp - a.hp)
          .slice(0, strikes);
        for (const e of sorted) {
          s.texts.spawn(e.img.x, e.img.y - e.r - 26, "⚡", "#ffe14d");
          s.particlePool.burst(e.img.x, e.img.y, "#ffe14d", 8, 170);
          s.bolts.push({
            pts: [
              { x: e.img.x + (Math.random() - 0.5) * 30, y: e.img.y - 190 },
              { x: e.img.x + (Math.random() - 0.5) * 16, y: e.img.y - 90 },
              { x: e.img.x, y: e.img.y },
            ],
            ttl: 0.14,
          });
          for (const t of s.enemies) {
            if (!t.dead && Math.hypot(t.img.x - e.img.x, t.img.y - e.img.y) < 92 + t.r) s.damageEnemy(t, tdmg);
          }
        }
        if (sorted.length > 0) sfx.play("thunder");
      }
    }
  }

  projectileLogic(dt: number): void {
    const s = this;
    // 弾
    for (let i = s.bullets.length - 1; i >= 0; i--) {
      const b = s.bullets[i];
      b.img.x += b.vx * dt;
      b.img.y += b.vy * dt;
      b.life -= dt;
      if (b.life > 0) {
        for (const e of s.enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.img.x - b.img.x, e.img.y - b.img.y) < e.r + 5) {
            b.life = 0;
            s.damageEnemy(e, b.dmg);
            s.particlePool.burst(b.img.x, b.img.y, "#fff3b0", 3, 90, 2.4);
            break;
          }
        }
      }
      if (b.life <= 0) {
        s.bulletPool.release(b.img);
        s.bullets.splice(i, 1);
      }
    }
    // ミサイル
    for (let i = s.missiles.length - 1; i >= 0; i--) {
      const m = s.missiles[i];
      m.life -= dt;
      const t = s.enemies.find((e) => !e.dead && e.eid === m.targetId)
        ?? s.enemies.find((e) => !e.dead);
      if (m.life > 0 && t) {
        const want = Math.atan2(t.img.y - m.obj.y, t.img.x - m.obj.x);
        const cur = Math.atan2(m.vy, m.vx);
        const na = turnToward(cur, want, 5.2 * dt);
        const spd = Math.min(430, Math.hypot(m.vx, m.vy) + 620 * dt);
        m.vx = Math.cos(na) * spd;
        m.vy = Math.sin(na) * spd;
        m.obj.x += m.vx * dt;
        m.obj.y += m.vy * dt;
        m.obj.setRotation(Math.atan2(m.vy, m.vx) + Math.PI / 4);
        if (Math.hypot(t.img.x - m.obj.x, t.img.y - m.obj.y) < t.r + 12) {
          m.dead = true;
          s.particlePool.burst(m.obj.x, m.obj.y, "#ff9f43", 14, 190);
          for (const e of s.enemies) {
            if (!e.dead && Math.hypot(e.img.x - m.obj.x, e.img.y - m.obj.y) < 68 + e.r) s.damageEnemy(e, m.dmg);
          }
          if (s.weapons.thunder >= 3) {
            s.particlePool.burst(m.obj.x, m.obj.y, "#85eaff", 18, 240);
            s.texts.spawn(m.obj.x, m.obj.y - 30, "連携雷", "#85eaff");
            for (const e of s.enemies) {
              if (!e.dead && Math.hypot(e.img.x - m.obj.x, e.img.y - m.obj.y) < 110 + e.r) s.damageEnemy(e, 18 + s.weapons.thunder * 6);
            }
            sfx.play("thunder");
          }
          sfx.play("boom");
        }
      } else if (m.life > 0) {
        m.obj.x += m.vx * dt;
        m.obj.y += m.vy * dt;
      }
      if (m.dead || m.life <= 0 || Math.hypot(m.obj.x - s.px, m.obj.y - s.py) >= 1400) {
        m.obj.setVisible(false).setActive(false);
        s.missileFree.push(m.obj);
        s.missiles.splice(i, 1);
      }
    }
  }

  enemyLogic(dt: number, _rawDt: number): void {
    const s = this;
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i];
      if (e.dead) {
        e.img.destroy();
        s.enemies.splice(i, 1);
        continue;
      }
      if (e.flashT > 0) {
        e.flashT -= dt;
        if (e.flashT <= 0) e.img.clearTint();
      }
      const ex = e.img.x;
      const ey = e.img.y;
      e.age += dt;
      e.action -= dt;
      const toward = Math.atan2(s.py - ey, s.px - ex);
      let speed = e.spd;
      if (e.kind === "boar") {
        if (e.action > 0.75) e.aim = turnToward(e.aim, toward, 8 * dt);
        else if (e.action > 0) speed = 0;
        else if (e.action > -0.65) speed *= 6;
        else { e.action = 3.6; speed = 0; }
      } else if (e.kind === "bee") {
        if (e.action > 0) e.aim = turnToward(e.aim, toward + Math.sin(e.age * 9) * 0.9, 7 * dt);
        else if (e.action > -0.45) speed *= 2.7;
        else e.action = 2.8;
      } else {
        if (e.kind !== "boss" || e.stage < 2 || e.action > 3.1 || e.action <= 1.7) {
          e.aim = turnToward(e.aim, toward, 5.5 * dt);
        }
        if (e.kind === "cloud" && e.action <= 0) {
          e.action = 4.5;
          s.hazards.push({ x: s.px, y: s.py, r: 49, timer: 0.85, active: 0.22, vx: 0, vy: 0, fired: false, dead: false });
        }
        if (e.kind === "boss") {
          const stage = e.hp / e.maxHp < 0.33 ? 3 : e.hp / e.maxHp < 0.66 ? 2 : 1;
          if (stage > e.stage) {
            e.stage = stage;
            s.setBanner(`竜巻 第${stage}形態！`, 2.5);
          }
          if (e.action <= 0) {
            e.action = stage === 3 ? 3 : 5;
            if (stage >= 2) {
              for (let j = 0; j < 3 && s.enemies.length < 150; j++) {
                const child = s.spawnEnemy("bee");
                child.img.x = ex + Math.cos(j * 2.1) * 60;
                child.img.y = ey + Math.sin(j * 2.1) * 60;
              }
            }
            for (let j = 0; j < 6 + stage * 2; j++) {
              const a = (j * Math.PI * 2) / (6 + stage * 2);
              s.hazards.push({
                x: ex + Math.cos(a) * 75, y: ey + Math.sin(a) * 75, r: 16,
                timer: 0.7, active: 3, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140,
                fired: false, dead: false,
              });
            }
          }
          if (stage >= 2 && e.action >= 2.4 && e.action <= 3.1) speed = 0;
          if (stage >= 2 && e.action > 1.7 && e.action < 2.4) speed *= 4;
        }
      }
      e.img.x = Phaser.Math.Clamp(ex + Math.cos(e.aim) * speed * dt, e.r, WORLD - e.r);
      e.img.y = Phaser.Math.Clamp(ey + Math.sin(e.aim) * speed * dt, e.r, WORLD - e.r);
      // 見た目の生命感（羽ばたき・うねり）
      if (e.kind === "crow" || e.kind === "bat" || e.kind === "elite") {
        e.img.setRotation(Math.sin(s.gtime * 9 + e.seed * 7) * 0.12);
      } else if (e.kind === "boss") {
        e.img.setRotation(Math.sin(s.gtime * 2.2) * 0.08);
      } else if (e.kind === "bee") {
        e.img.setRotation(Math.sin(s.gtime * 16 + e.seed * 9) * 0.1);
      }
      // 接触ダメージ
      if (Math.hypot(s.px - e.img.x, s.py - e.img.y) < e.r + PLAYER_R && s.gtime >= s.invulnUntil) {
        s.hp -= e.dmg;
        s.invulnUntil = s.gtime + 0.6;
        s.cameras.main.shake(70, 0.0035);
        sfx.play("hurt");
        s.particlePool.burst(s.px, s.py, "#ff6b6b", 10, 150);
        if (s.hp <= 0) {
          s.hp = 0;
          s.endGame();
          return;
        }
      }
    }

    // ハザード（落雷予告・竜巻の破片）
    for (let i = s.hazards.length - 1; i >= 0; i--) {
      const h = s.hazards[i];
      if (h.timer > 0) {
        h.timer -= dt;
        if (h.timer <= 0 && !h.fired) {
          h.fired = true;
          s.particlePool.burst(h.x, h.y, "#c4edff", 8, 130);
          sfx.play("thunder");
        }
        continue;
      }
      h.active -= dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.active > 0 && Math.hypot(s.px - h.x, s.py - h.y) < h.r + PLAYER_R && s.gtime >= s.invulnUntil) {
        s.hp = Math.max(0, s.hp - 18);
        s.invulnUntil = s.gtime + 0.6;
        s.cameras.main.shake(70, 0.0035);
        sfx.play("hurt");
        if (s.hp <= 0) {
          s.endGame();
          return;
        }
      }
      if (h.active <= 0) s.hazards.splice(i, 1);
    }
  }

  damageEnemy(e: EnemyE, dmg: number): void {
    const s = this;
    if (e.dead) return;
    if (Math.random() < 0.1 + s.weapons.critLv * 0.08) {
      dmg *= 2;
      sfx.play("critical");
      s.texts.spawn(e.img.x, e.img.y - e.r, `${Math.round(dmg)}!`, "#ff57c8");
    }
    e.hp -= dmg;
    e.flashT = 0.08;
    e.img.setTintFill(0xfff9d7);
    if (e.hp > 0) return;
    e.dead = true;
    s.kills += 1;
    if (s.kills % 100 === 0 || s.kills === 25 || s.kills === 50) s.setBanner(`${s.kills}体撃破！`, 2.5);
    if (e.kind === "elite" || e.kind === "boss") s.slow = 0.085;
    s.score += e.score;
    s.particlePool.burst(
      e.img.x, e.img.y,
      e.kind === "cloud" || e.kind === "boss" ? "#8a93a6" : "#5b4a2f",
      e.kind === "boss" ? 40 : 10,
      e.kind === "boss" ? 240 : 140,
    );
    sfx.play(e.kind === "boss" || e.kind === "elite" ? "boom" : "hit");
    let remaining = e.xp;
    while (remaining > 0) {
      const v = remaining >= 5 ? 5 : 1;
      remaining -= v;
      const a = Math.random() * Math.PI * 2;
      s.dropGem(e.img.x + Math.cos(a) * 10, e.img.y + Math.sin(a) * 10, v, Math.cos(a) * 60, Math.sin(a) * 60);
    }
    if (e.kind === "elite") s.dropHeal(e.img.x, e.img.y);
    if (e.kind === "boss") {
      s.dropHeal(e.img.x - 30, e.img.y);
      s.dropHeal(e.img.x + 30, e.img.y);
      s.cameras.main.shake(260, 0.01);
      sfx.play("clear");
    }
  }

  dropGem(x: number, y: number, v: number, vx: number, vy: number): void {
    const img = this.gemPool.obtain();
    img.setTexture(v >= 5 ? "gem5" : "gem1");
    img.setPosition(x, y).setDepth(15);
    this.gems.push({ img, v, vx, vy, dead: false });
  }

  dropHeal(x: number, y: number): void {
    const obj = this.healFree.pop() ?? this.add.text(0, 0, "❤️", { fontSize: "26px", resolution: 2 }).setOrigin(0.5).setDepth(16);
    obj.setPosition(x, y).setVisible(true).setActive(true);
    this.heals.push({ obj, x, y, dead: false });
  }

  gainXp(v: number): void {
    const s = this;
    s.xp += v;
    sfx.play("pickup");
    if (s.xp >= s.xpNext && s.phase === "playing") {
      s.xp -= s.xpNext;
      s.level += 1;
      s.xpNext = 6 + (s.level - 1) * 5;
      s.particlePool.burst(s.px, s.py, "#ffd94d", 26, 190);
      sfx.play("levelup");
      s.beam = 0.85;
      s.rerolledFlag = false;
      s.pendingCards = s.pickCards(s.buildPool());
      s.hooks.onLevelUp(s.pendingCards.map(({ id, icon, name, desc }) => ({ id, icon, name, desc })), false);
      s.setPhase("levelup");
    }
  }

  buildPool(): FullCard[] {
    const w = this.weapons;
    const pool: FullCard[] = [];
    if (w.critLv < 5) pool.push({ id: "crit", icon: "✨", name: "会心の麦", desc: `全武器の会心率 +8%（現在 ${10 + w.critLv * 8}%）。会心は2倍ダメージ`, apply: (sc) => { sc.weapons.critLv++; } });
    pool.push({ id: "dmg", icon: "💪", name: "麦ショット威力+", desc: "基本ショットのダメージ +6", apply: (sc) => { sc.weapons.dmgLv += 1; } });
    pool.push({ id: "rate", icon: "🔥", name: "連射アップ", desc: "基本ショットの発射間隔が短くなる", apply: (sc) => { sc.weapons.rateLv += 1; } });
    if (w.countLv < 4) pool.push({ id: "count", icon: "🌾", name: "同時発射 +1", desc: "基本ショットが1方向増える", apply: (sc) => { sc.weapons.countLv += 1; } });
    if (w.orbit < 5) pool.push({ id: "orbit", icon: "🌀", name: w.orbit === 0 ? "回転ガマ 解放！" : "回転ガマ Lv+", desc: w.orbit === 0 ? "周囲を回る鎌で敵を切り刻む" : `鎌が増えて威力アップ（現在 Lv${w.orbit}）`, apply: (sc) => { sc.weapons.orbit += 1; } });
    if (w.missile < 5) pool.push({ id: "missile", icon: "🚀", name: w.missile === 0 ? "追尾ミサイル 解放！" : "追尾ミサイル Lv+", desc: w.missile === 0 ? "敵を追うミサイル。雷撃Lv3で着弾に範囲雷が追加" : `数と威力アップ（Lv${w.missile}）。雷撃Lv3と連携：着弾雷`, apply: (sc) => { sc.weapons.missile += 1; } });
    if (w.thunder < 5) pool.push({ id: "thunder", icon: "⚡", name: w.thunder === 0 ? "雷撃 解放！" : "雷撃 Lv+", desc: w.thunder === 0 ? "近くの敵に範囲雷。Lv3＋ミサイルで着弾雷が発動" : `回数と威力アップ（Lv${w.thunder}）。Lv3＋ミサイルで着弾雷`, apply: (sc) => { sc.weapons.thunder += 1; } });
    if (w.speedLv < 5) pool.push({ id: "speed", icon: "👟", name: "移動速度アップ", desc: "足が速くなる（+8%）", apply: (sc) => { sc.weapons.speedLv += 1; } });
    if (w.magnetLv < 5) pool.push({ id: "magnet", icon: "🧲", name: "磁石範囲アップ", desc: "🌾経験値を吸い寄せる範囲 +40%", apply: (sc) => { sc.weapons.magnetLv += 1; } });
    pool.push({ id: "hp", icon: "❤️", name: "最大HP+25＆回復", desc: "最大HPが増え、今すぐ25回復", apply: (sc) => { sc.maxHp += 25; sc.hp = Math.min(sc.maxHp, sc.hp + 25); } });
    return pool;
  }

  pickCards(pool: FullCard[]): FullCard[] {
    const picks: FullCard[] = [];
    const copy = [...pool];
    while (picks.length < 3 && copy.length > 0) {
      picks.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    }
    if (picks.length === 0) {
      picks.push({ id: "heal", icon: "🍙", name: "大回復", desc: "HPを40回復する", apply: (sc) => { sc.hp = Math.min(sc.maxHp, sc.hp + 40); } });
    }
    return picks;
  }

  chooseCard(id: string): void {
    if (this.phase !== "levelup") return;
    const card = this.pendingCards.find((c) => c.id === id);
    if (!card) return;
    card.apply(this);
    sfx.play("click");
    this.emitHud();
    this.setPhase("playing");
  }

  reroll(): void {
    if (this.phase !== "levelup" || this.rerolledFlag) return;
    const excluded = new Set(this.pendingCards.map((c) => c.id));
    const alternatives = this.buildPool().filter((c) => !excluded.has(c.id));
    const picks: FullCard[] = [];
    while (picks.length < 3 && alternatives.length > 0) {
      picks.push(alternatives.splice(Math.floor(Math.random() * alternatives.length), 1)[0]);
    }
    for (const c of this.pendingCards) {
      if (picks.length >= 3) break;
      picks.push(c);
    }
    this.pendingCards = picks;
    this.rerolledFlag = true;
    sfx.play("click");
    this.hooks.onLevelUp(picks.map(({ id, icon, name, desc }) => ({ id, icon, name, desc })), true);
  }

  endGame(): void {
    const s = this;
    const score = s.score + Math.floor(s.gtime) * 5 + (s.level - 1) * 150;
    sfx.play("gameover");
    s.hooks.onGameOver({ time: s.gtime, kills: s.kills, level: s.level, score, killScore: s.score });
    s.setPhase("over");
  }

  pickupLogic(dt: number): void {
    const s = this;
    const magnetR = 80 * Math.pow(1.4, s.weapons.magnetLv);
    for (let i = s.gems.length - 1; i >= 0; i--) {
      const g = s.gems[i];
      const d = Math.hypot(s.px - g.img.x, s.py - g.img.y);
      if (d < PLAYER_R + 12) {
        s.gemPool.release(g.img);
        s.gems.splice(i, 1);
        s.gainXp(g.v);
        if (s.phase !== "playing") return;
        continue;
      }
      if (d < magnetR) {
        const pull = 1500;
        g.vx += ((s.px - g.img.x) / (d || 1)) * pull * dt;
        g.vy += ((s.py - g.img.y) / (d || 1)) * pull * dt;
      }
      const drag = Math.pow(0.88, dt * 60);
      g.vx *= drag;
      g.vy *= drag;
      g.img.x += g.vx * dt;
      g.img.y += g.vy * dt;
    }
    for (let i = s.heals.length - 1; i >= 0; i--) {
      const h = s.heals[i];
      h.obj.y = h.y + Math.sin(s.gtime * 4 + h.x) * 3;
      if (Math.hypot(s.px - h.x, s.py - h.y) < PLAYER_R + 18) {
        h.obj.setVisible(false).setActive(false);
        s.healFree.push(h.obj);
        s.heals.splice(i, 1);
        s.hp = Math.min(s.maxHp, s.hp + 30);
        s.texts.spawn(s.px, s.py - 34, "+30", "#3fbf5a");
        sfx.play("pickup");
      }
    }
  }

  fxLogic(dt: number): void {
    const s = this;
    s.particlePool.update(dt);
    s.texts.update(dt, 34);
    // バナー
    if (s.bannerText && s.gtime < s.bannerUntil) {
      s.bannerObj.setText(s.bannerText).setVisible(true);
      s.bannerObj.setPosition(s.scale.width / 2, s.scale.height * 0.3);
    } else {
      s.bannerObj.setVisible(false);
    }
    // 低HPビネット
    const low = s.hp / s.maxHp < 0.25;
    s.vignette.setVisible(low);
    if (low) s.vignette.setAlpha(0.16 + 0.08 * Math.sin(s.gtime * 6));
    // fxG: ハザード・テレグラフ・雷・大型HPバー
    const g = s.fxG;
    g.clear();
    for (const h of s.hazards) {
      const warning = h.timer > 0;
      if (warning) {
        g.fillStyle(0xff673e, 0.2);
        g.fillCircle(h.x, h.y, h.r);
        g.lineStyle(2, 0xe34927, 0.9);
        g.strokeCircle(h.x, h.y, h.r);
        g.beginPath();
        g.arc(h.x, h.y, h.r * Math.max(0, 1 - h.timer / 0.85), 0, Math.PI * 2, false);
        g.strokePath();
      } else {
        g.fillStyle(0xa1e5ff, 0.5);
        g.fillCircle(h.x, h.y, h.r);
        g.lineStyle(3, 0xefffff, 0.9);
        g.strokeCircle(h.x, h.y, h.r);
      }
    }
    for (const e of s.enemies) {
      if (e.dead) continue;
      const telegraph =
        (e.kind === "boar" && e.action <= 0.75 && e.action > 0) ||
        (e.kind === "boss" && e.stage >= 2 && e.action >= 2.4 && e.action <= 3.1);
      if (telegraph) {
        g.lineStyle(e.r * 1.4, 0xff4b38, 0.35);
        g.lineBetween(e.img.x, e.img.y, e.img.x + Math.cos(e.aim) * 230, e.img.y + Math.sin(e.aim) * 230);
      }
      if ((e.kind === "elite" || e.kind === "boss") && e.hp < e.maxHp) {
        const bw = e.r * 2;
        g.fillStyle(0x000000, 0.45);
        g.fillRect(e.img.x - bw / 2, e.img.y - e.r - 16, bw, 7);
        g.fillStyle(0xff5252, 1);
        g.fillRect(e.img.x - bw / 2, e.img.y - e.r - 16, bw * Math.max(0, e.hp / e.maxHp), 7);
      }
    }
    for (let i = s.bolts.length - 1; i >= 0; i--) {
      const b = s.bolts[i];
      b.ttl -= dt;
      if (b.ttl <= 0) {
        s.bolts.splice(i, 1);
        continue;
      }
      g.lineStyle(4, 0xffe14d, Math.max(0, b.ttl / 0.14));
      g.beginPath();
      g.moveTo(b.pts[0].x, b.pts[0].y);
      for (let j = 1; j < b.pts.length; j++) g.lineTo(b.pts[j].x, b.pts[j].y);
      g.strokePath();
    }
  }

  setBanner(text: string, dur: number): void {
    this.bannerText = text;
    this.bannerUntil = this.gtime + dur;
  }

  emitHud(): void {
    const w = this.weapons;
    const chips: string[] = [`🌾ショット Lv${1 + w.dmgLv + w.rateLv + w.countLv}`];
    if (w.orbit > 0) chips.push(`🗡️ガマ Lv${w.orbit}`);
    if (w.missile > 0) chips.push(`🚀ミサイル Lv${w.missile}`);
    if (w.thunder > 0) chips.push(`⚡雷撃 Lv${w.thunder}`);
    if (w.thunder >= 3 && w.missile > 0) chips.push("着弾雷 発動中");
    chips.push(`会心 ${10 + w.critLv * 8}%`);
    const boss = this.enemies.find((e) => e.kind === "boss" && !e.dead);
    this.hooks.onHud({
      hp: Math.ceil(this.hp),
      maxHp: this.maxHp,
      level: this.level,
      xpRatio: Math.min(1, this.xp / this.xpNext),
      time: this.gtime,
      kills: this.kills,
      chips,
      bossRatio: boss ? Math.max(0, boss.hp / boss.maxHp) : null,
      bossStage: boss ? boss.stage : 0,
    });
  }
}

export function createSurvivorsGame(
  parent: HTMLElement,
  hooks: SurvivorsHooks,
): { game: Phaser.Game; api: SurvivorsApi; destroy: () => void } {
  const scene = new SurvivorsScene();
  scene.hooks = hooks;
  const game = new Phaser.Game(baseGameConfig(parent, [scene as unknown as Phaser.Types.Scenes.SettingsConfig]));
  const detach = attachDprResize(game, parent);
  const api: SurvivorsApi = {
    start: () => {
      if (scene.booted) scene.start();
      else scene.autoStartOnBoot = true;
    },
    pause: () => { if (scene.booted && scene.phase === "playing") scene.setPhase("paused"); },
    resume: () => { if (scene.booted && scene.phase === "paused") scene.setPhase("playing"); },
    chooseCard: (id) => { if (scene.booted) scene.chooseCard(id); },
    reroll: () => { if (scene.booted) scene.reroll(); },
    autoPause: () => { if (scene.booted && scene.phase === "playing") scene.setPhase("paused"); },
  };
  return { game, api, destroy: () => { detach(); game.destroy(true); } };
}
