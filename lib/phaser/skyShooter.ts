import * as Phaser from "phaser";
import { sfx } from "../sfx";
import {
  attachDprResize,
  baseGameConfig,
  dampFactor,
  ensureDot,
  ensureRing,
  genTex,
  Hitstop,
  HurtVignette,
  ImagePool,
  ParticlePool,
  TextPool,
} from "./common";

export type SkyPhase = "idle" | "playing" | "paused" | "over";
export type SkyHud = {
  score: number;
  mult: number;
  graze: number;
  stage: number;
  bombs: number;
  lives: number;
  chain: number;
  chainMult: number;
  chainRatio: number;
  power: number;
  shield: boolean;
  invulnSec: number;
  bossRatio: number | null;
  bossPhase: number;
};
export type SkyResult = { score: number; stage: number; graze: number };

export interface SkyHooks {
  onPhase(p: SkyPhase): void;
  onHud(h: SkyHud): void;
  onGameOver(r: SkyResult): void;
}

export interface SkyApi {
  start(): void;
  pause(): void;
  resume(): void;
  bomb(): void;
  autoPause(): void;
}

const CORE_R = 6;

type EKind = "diver" | "sine" | "mid" | "carrier" | "weaver" | "mine" | "boss";
type EnemyE = {
  cont: Phaser.GameObjects.Container;
  core: Phaser.GameObjects.Image | null;
  rotor: Phaser.GameObjects.Image | null;
  id: number;
  kind: EKind;
  hp: number;
  maxHp: number;
  t: number;
  baseX: number;
  phase: number;
  fireT: number;
  score: number;
  pattern: number;
  patternT: number;
  burstT: number;
  formation?: number;
  aim?: number;
  hitT: number;
  dead: boolean;
};
type BulletE = { img: Phaser.GameObjects.Image; vx: number; vy: number; dead: boolean };
type EBulletE = { img: Phaser.GameObjects.Image; vx: number; vy: number; grazed: boolean; close: boolean; dead: boolean };
type PowerE = { cont: Phaser.GameObjects.Container; kind: "P" | "S" | "B"; t: number; dead: boolean };
type RingE = { img: Phaser.GameObjects.Image; life: number; maxLife: number; size: number };

const POWER_STYLE: Record<PowerE["kind"], { label: string; color: string }> = {
  P: { label: "P", color: "#ff9f43" },
  S: { label: "S", color: "#4db8e8" },
  B: { label: "B", color: "#b388ff" },
};

function multOf(graze: number): number {
  return 1 + Math.min(7, Math.floor(graze / 20));
}

class SkyScene extends Phaser.Scene {
  hooks!: SkyHooks;
  phase: SkyPhase = "idle";

  // 論理プレイフィールド（ズームで全画面に合わせる）
  LW = 480;
  LH = 640;

  gtime = 0;
  stageTime = 0;
  stage = 1;
  score = 0;
  graze = 0;
  px = 240;
  py = 530;
  pvx = 0;
  pvy = 0;
  lives = 3;
  bombs = 3;
  power = 1;
  shield = false;
  invulnUntil = 0;
  fireT = 0;
  chain = 0;
  chainUntil = 0;
  slow = 0;
  slowCooldown = 0;
  grazeSoundT = 0;
  exhaustT = 0;
  bank = 0;
  formations = new Map<number, { remaining: number; failed: boolean }>();
  enemies: EnemyE[] = [];
  bullets: BulletE[] = [];
  ebullets: EBulletE[] = [];
  powers: PowerE[] = [];
  rings: RingE[] = [];
  spawnT = 1;
  midT = 14;
  carrierT = 10;
  bossSpawned = false;
  bossId = -1;
  bannerText = "";
  bannerUntil = 0;
  flash = 0;
  shakeAmt = 0;
  bgScroll = 0;
  powerCycle = 0;
  nextId = 1;
  keys = { left: false, right: false, up: false, down: false };
  pointer = { active: false, x: 0, y: 0 };
  hudTimer = 0;

  bgFar!: Phaser.GameObjects.TileSprite;
  bgNear!: Phaser.GameObjects.TileSprite;
  player!: Phaser.GameObjects.Container;
  playerImg!: Phaser.GameObjects.Image;
  flame!: Phaser.GameObjects.Image;
  prop!: Phaser.GameObjects.Image;
  shieldImg!: Phaser.GameObjects.Image;
  coreImg!: Phaser.GameObjects.Image;
  fxG!: Phaser.GameObjects.Graphics;
  bannerObj!: Phaser.GameObjects.Text;
  warnObj!: Phaser.GameObjects.Text;
  flashRect!: Phaser.GameObjects.Rectangle;
  hurtVig!: HurtVignette;
  hitstop = new Hitstop();
  booted = false;
  autoStartOnBoot = false;
  bulletPool!: ImagePool;
  ebulletPool!: ImagePool;
  ringPool!: ImagePool;
  particlePool!: ParticlePool;
  texts!: TextPool;

  constructor() {
    super("sky-shooter");
  }

  preload(): void {
    this.load.image("mugi-raw", "/mugi.webp");
  }

  create(): void {
    this.createTextures();
    ensureDot(this);
    ensureRing(this);

    this.bgFar = this.add.tileSprite(0, 0, this.LW, this.LH, "sky-land").setOrigin(0, 0).setDepth(0);
    this.bgNear = this.add.tileSprite(0, 0, this.LW, this.LH, "sky-clouds").setOrigin(0, 0).setDepth(1);

    this.fxG = this.add.graphics().setDepth(70);

    // プレイヤー
    const wingL = this.add.image(-16, 10, "sky-wing").setFlipX(true);
    const wingR = this.add.image(16, 10, "sky-wing");
    this.flame = this.add.image(0, 24, "sky-flame");
    this.playerImg = this.add.image(0, 0, "mugi-circle").setDisplaySize(36, 36);
    this.prop = this.add.image(0, -24, "rotor-line").setDisplaySize(48, 4);
    this.coreImg = this.add.image(0, 0, "core-dot").setDisplaySize(7, 7);
    this.shieldImg = this.add.image(0, 0, "tex-ring").setDisplaySize(60, 60).setTint(0x4db8e8).setVisible(false);
    this.player = this.add
      .container(this.px, this.py, [wingL, wingR, this.flame, this.playerImg, this.prop, this.coreImg, this.shieldImg])
      .setDepth(30);

    this.bannerObj = this.add
      .text(0, 0, "", { fontFamily: "sans-serif", fontStyle: "bold", fontSize: "26px", resolution: 2, color: "#ff5252" })
      .setOrigin(0.5)
      .setStroke("#ffffff", 6)
      .setDepth(92)
      .setVisible(false);
    this.warnObj = this.add
      .text(0, 0, "", { fontFamily: "sans-serif", fontStyle: "bold", fontSize: "14px", resolution: 2, color: "#ac284c" })
      .setOrigin(0.5)
      .setDepth(91)
      .setVisible(false);
    this.flashRect = this.add.rectangle(0, 0, this.LW, this.LH, 0xffffff, 0).setOrigin(0, 0).setDepth(88);
    // 被弾専用の赤ヴィネット（白フラッシュとは別オブジェクト・その下）
    this.hurtVig = new HurtVignette(this, 87);

    this.bulletPool = new ImagePool(this, "sky-shot", 25);
    this.ebulletPool = new ImagePool(this, "sky-ebullet", 24);
    this.ringPool = new ImagePool(this, "tex-ring", 45);
    this.particlePool = new ParticlePool(new ImagePool(this, "tex-dot", 35));
    this.texts = new TextPool(this, 60, 17);

    this.setupInput();
    this.layout();
    this.scale.on("resize", () => this.layout());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => sfx.stopBgm("sky"));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => sfx.stopBgm("sky"));
    this.resetState();
    this.booted = true;
    if (this.autoStartOnBoot) {
      this.autoStartOnBoot = false;
      this.start();
    }
  }

  createTextures(): void {
    const SS = 2;
    const tex = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics, cx: number, cy: number) => void) => {
      genTex(this, key, w * SS, h * SS, (g) => {
        g.save();
        g.scaleCanvas(SS, SS);
        draw(g, w / 2, h / 2);
        g.restore();
      });
    };
    tex("sky-diver", 92, 92, (g, cx, cy) => {
      g.fillStyle(0xdf7258, 1);
      g.fillPoints(
        [
          { x: cx, y: cy + 26 }, { x: cx - 8, y: cy + 8 }, { x: cx - 28, y: cy }, { x: cx - 28, y: cy - 8 },
          { x: cx - 7, y: cy - 5 }, { x: cx - 5, y: cy - 24 }, { x: cx + 5, y: cy - 24 }, { x: cx + 7, y: cy - 5 },
          { x: cx + 28, y: cy - 8 }, { x: cx + 28, y: cy }, { x: cx + 8, y: cy + 8 },
        ],
        true,
      );
      g.lineStyle(2, 0x23374f, 1);
      g.strokePoints(
        [
          { x: cx, y: cy + 26 }, { x: cx - 8, y: cy + 8 }, { x: cx - 28, y: cy }, { x: cx - 28, y: cy - 8 },
          { x: cx - 7, y: cy - 5 }, { x: cx - 5, y: cy - 24 }, { x: cx + 5, y: cy - 24 }, { x: cx + 7, y: cy - 5 },
          { x: cx + 28, y: cy - 8 }, { x: cx + 28, y: cy }, { x: cx + 8, y: cy + 8 },
        ],
        true,
      );
      g.fillStyle(0xb9e9f8, 1);
      g.fillEllipse(cx, cy, 9, 17);
    });
    tex("sky-sine", 96, 96, (g, cx, cy) => {
      g.lineStyle(6, 0x344b64, 1);
      g.lineBetween(cx - 23, cy - 10, cx + 23, cy + 10);
      g.lineBetween(cx + 23, cy - 10, cx - 23, cy + 10);
      g.fillStyle(0x78c8be, 1);
      g.fillEllipse(cx, cy, 24, 35);
      for (const [x, y] of [[-24, -12], [24, -12], [-24, 12], [24, 12]] as const) {
        g.fillStyle(0xdf7258, 1);
        g.fillEllipse(cx + x, cy + y, 15, 11);
      }
    });
    tex("sky-weaver", 96, 96, (g, cx, cy) => {
      g.lineStyle(6, 0x344b64, 1);
      g.lineBetween(cx - 23, cy - 10, cx + 23, cy + 10);
      g.lineBetween(cx + 23, cy - 10, cx - 23, cy + 10);
      g.fillStyle(0xb591cf, 1);
      g.fillEllipse(cx, cy, 24, 35);
      for (const [x, y] of [[-24, -12], [24, -12], [-24, 12], [24, 12]] as const) {
        g.fillStyle(0x8a6aad, 1);
        g.fillEllipse(cx + x, cy + y, 15, 11);
      }
    });
    tex("sky-mid", 120, 120, (g, cx, cy) => {
      g.fillStyle(0x80becb, 1);
      g.fillEllipse(cx, cy - 8, 38, 36);
      g.fillStyle(0x606a8e, 1);
      g.fillEllipse(cx, cy + 6, 72, 27);
      g.fillStyle(0xffe49b, 1);
      for (const x of [-23, -8, 8, 23]) g.fillEllipse(cx + x, cy + 9, 7, 5);
      g.lineStyle(2, 0x23374f, 1);
      g.strokeEllipse(cx, cy + 6, 72, 27);
    });
    tex("sky-carrier", 104, 120, (g, cx, cy) => {
      g.fillStyle(0xe9aa55, 1);
      g.fillEllipse(cx, cy - 14, 50, 62);
      g.lineStyle(2, 0xfff1c8, 1);
      g.strokeEllipse(cx, cy - 14, 20, 60);
      g.lineBetween(cx - 16, cy + 8, cx - 11, cy + 30);
      g.lineBetween(cx + 16, cy + 8, cx + 11, cy + 30);
      g.fillStyle(0x956c45, 1);
      g.fillRect(cx - 13, cy + 24, 26, 21);
      g.lineStyle(2, 0x23374f, 1);
      g.strokeRect(cx - 13, cy + 24, 26, 21);
      g.lineBetween(cx - 13, cy + 24, cx + 13, cy + 45);
      g.lineBetween(cx + 13, cy + 24, cx - 13, cy + 45);
    });
    tex("sky-mine", 68, 68, (g, cx, cy) => {
      g.lineStyle(5, 0x425775, 1);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.lineBetween(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11, cx + Math.cos(a) * 22, cy + Math.sin(a) * 22);
      }
      g.fillStyle(0x425775, 1);
      g.fillCircle(cx, cy, 13);
      g.fillStyle(0xffe49b, 1);
      g.fillCircle(cx, cy, 5.5);
    });
    tex("sky-boss", 340, 220, (g, cx, cy) => {
      g.fillStyle(0x34435d, 1);
      g.fillPoints(
        [
          { x: cx - 82, y: cy + 20 }, { x: cx - 67, y: cy - 20 }, { x: cx - 30, y: cy - 11 },
          { x: cx - 22, y: cy - 47 }, { x: cx + 22, y: cy - 47 }, { x: cx + 30, y: cy - 11 },
          { x: cx + 67, y: cy - 20 }, { x: cx + 82, y: cy + 20 }, { x: cx + 41, y: cy + 38 },
          { x: cx - 41, y: cy + 38 },
        ],
        true,
      );
      g.lineStyle(3, 0x23374f, 1);
      g.strokePoints(
        [
          { x: cx - 82, y: cy + 20 }, { x: cx - 67, y: cy - 20 }, { x: cx - 30, y: cy - 11 },
          { x: cx - 22, y: cy - 47 }, { x: cx + 22, y: cy - 47 }, { x: cx + 30, y: cy - 11 },
          { x: cx + 67, y: cy - 20 }, { x: cx + 82, y: cy + 20 }, { x: cx + 41, y: cy + 38 },
          { x: cx - 41, y: cy + 38 },
        ],
        true,
      );
      for (const x of [-56, 56]) {
        g.fillStyle(0x63768e, 1);
        g.fillRect(cx + x - 13, cy - 9, 26, 35);
      }
      g.fillStyle(0x1c2c48, 1);
      g.fillEllipse(cx, cy, 62, 64);
    });
    genTex(this, "boss-core", 72, 72, (g) => {
      g.fillStyle(0x8ff4ff, 1);
      g.fillCircle(36, 36, 17);
      g.lineStyle(3, 0xffffff, 1);
      g.beginPath();
      g.moveTo(39, 22);
      g.lineTo(30, 37);
      g.lineTo(41, 36);
      g.lineTo(32, 51);
      g.strokePath();
    });
    genTex(this, "rotor-line", 96, 12, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(0, 2, 96, 8, 4);
    });
    genTex(this, "sky-shot", 24, 44, (g) => {
      g.fillStyle(0xffcf3f, 1);
      g.fillEllipse(12, 22, 8, 19);
      g.fillStyle(0xfff6c8, 1);
      g.fillEllipse(12, 20, 3.6, 10);
    });
    genTex(this, "sky-ebullet", 32, 32, (g) => {
      g.fillStyle(0xff5d8f, 1);
      g.fillCircle(16, 16, 11);
      g.fillStyle(0xffd3e4, 1);
      g.fillCircle(16, 16, 4.8);
    });
    genTex(this, "core-dot", 16, 16, (g) => {
      g.fillStyle(0xff5252, 1);
      g.fillCircle(8, 8, 7);
    });
    tex("sky-wing", 72, 44, (g, cx, cy) => {
      g.fillStyle(0x4db8e8, 1);
      g.fillTriangle(cx - 22, cy - 12, cx + 24, cy + 10, cx - 18, cy + 12);
    });
    tex("sky-flame", 28, 44, (g, cx, cy) => {
      g.fillStyle(0xff9c3c, 0.95);
      g.fillTriangle(cx - 8, cy - 18, cx, cy + 20, cx + 8, cy - 18);
      g.fillStyle(0xffe89b, 1);
      g.fillTriangle(cx - 4, cy - 14, cx, cy + 8, cx + 4, cy - 14);
    });
    genTex(this, "power-box", 60, 60, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(2, 2, 56, 56, 14);
      g.lineStyle(4, 0xffffff, 1);
      g.strokeRoundedRect(2, 2, 56, 56, 14);
    });
    // 背景タイル
    genTex(this, "sky-land", 256, 256, (g) => {
      g.fillStyle(0x7ec8f2, 1);
      g.fillRect(0, 0, 256, 256);
      g.fillStyle(0x4b8b72, 0.17);
      g.fillEllipse(60, 80, 150, 220);
      g.fillEllipse(200, 200, 120, 180);
    });
    genTex(this, "sky-clouds", 256, 256, (g) => {
      g.fillStyle(0xffffff, 0.0);
      g.fillRect(0, 0, 256, 256);
      g.fillStyle(0xffffff, 0.6);
      g.fillEllipse(70, 60, 100, 34);
      g.fillEllipse(190, 170, 130, 40);
      g.fillEllipse(90, 230, 80, 26);
    });
    // むぎ円形テクスチャ
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
      });
    }
  }

  layout(): void {
    const vw = this.scale.width;
    const vh = this.scale.height;
    let zoom: number;
    if (vw >= vh) {
      this.LH = 640;
      zoom = vh / 640;
      this.LW = vw / zoom;
    } else {
      this.LW = 480;
      zoom = vw / 480;
      this.LH = vh / zoom;
    }
    const cam = this.cameras.main;
    cam.setZoom(zoom);
    cam.centerOn(this.LW / 2, this.LH / 2);
    this.bgFar?.setSize(this.LW, this.LH);
    this.bgNear?.setSize(this.LW, this.LH);
    this.flashRect?.setSize(this.LW, this.LH);
    // カメラは論理画面の中央に固定なので、flashRect と同じく論理座標で全面を覆う
    this.hurtVig?.layout(this.LW / 2, this.LH / 2, this.LW, this.LH);
    this.px = Phaser.Math.Clamp(this.px, 16, this.LW - 16);
    this.py = Phaser.Math.Clamp(this.py, 40, this.LH - 16);
  }

  viewW(): number {
    return this.LW;
  }
  viewH(): number {
    return this.LH;
  }

  setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture(["UP", "DOWN", "LEFT", "RIGHT", "SPACE", "W", "A", "S", "D"]);
      const cursors = kb.createCursorKeys();
      const wasd = kb.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;
      this.events.on("update", () => {
        this.keys.left = cursors.left.isDown || wasd.A.isDown;
        this.keys.right = cursors.right.isDown || wasd.D.isDown;
        this.keys.up = cursors.up.isDown || wasd.W.isDown;
        this.keys.down = cursors.down.isDown || wasd.S.isDown;
      });
      kb.on("keydown-SPACE", () => this.useBomb());
      kb.on("keydown-P", () => this.togglePause());
      kb.on("keydown-ESC", () => this.togglePause());
    }
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.pointer.active = true;
      this.pointer.x = wp.x;
      this.pointer.y = wp.y;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.pointer.active) return;
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.pointer.x = wp.x;
      this.pointer.y = wp.y;
    });
    const release = () => {
      this.pointer.active = false;
    };
    this.input.on("pointerup", release);
    this.input.on("pointerupoutside", release);
  }

  togglePause(): void {
    if (this.phase === "playing") this.setPhase("paused");
    else if (this.phase === "paused") this.setPhase("playing");
  }

  setPhase(p: SkyPhase): void {
    this.phase = p;
    if (p !== "playing") this.pointer.active = false;
    this.hooks.onPhase(p);
  }

  resetState(): void {
    for (const e of this.enemies) e.cont.destroy();
    for (const b of this.bullets) this.bulletPool.release(b.img);
    for (const b of this.ebullets) this.ebulletPool.release(b.img);
    for (const p of this.powers) p.cont.destroy();
    for (const r of this.rings) this.ringPool.release(r.img);
    this.enemies = [];
    this.bullets = [];
    this.ebullets = [];
    this.powers = [];
    this.rings = [];
    this.formations.clear();
    this.particlePool?.clear();
    this.texts?.clear();
    this.hurtVig?.clear();
    this.hitstop.reset();
    this.gtime = 0;
    this.stageTime = 0;
    this.stage = 1;
    this.score = 0;
    this.graze = 0;
    this.px = this.LW / 2;
    this.py = this.LH - 110;
    this.pvx = 0;
    this.pvy = 0;
    this.lives = 3;
    this.bombs = 3;
    this.power = 1;
    this.shield = false;
    this.invulnUntil = 0;
    this.fireT = 0;
    this.chain = 0;
    this.chainUntil = 0;
    this.slow = 0;
    this.slowCooldown = 0;
    this.spawnT = 1;
    this.midT = 14;
    this.carrierT = 10;
    this.bossSpawned = false;
    this.bossId = -1;
    this.bannerText = "STAGE 1 — TAKE OFF";
    this.bannerUntil = 2.8;
    this.flash = 0;
    this.powerCycle = 0;
    this.player.setPosition(this.px, this.py);
    this.emitHud();
  }

  start(): void {
    this.resetState();
    this.setPhase("playing");
    sfx.startBgm("sky");
  }

  addScore(base: number): void {
    this.score += base * multOf(this.graze);
  }

  endGame(): void {
    sfx.stopBgm();
    sfx.play("gameover");
    this.hooks.onGameOver({ score: this.score, stage: this.stage, graze: this.graze });
    this.setPhase("over");
  }

  update(_time: number, deltaMs: number): void {
    const rawDt = Math.min(0.033, deltaMs / 1000);
    if (this.phase !== "playing") {
      this.drawFx(rawDt);
      return;
    }
    let dt = rawDt;
    this.slow = Math.max(0, this.slow - rawDt);
    this.slowCooldown = Math.max(0, this.slowCooldown - rawDt);
    if (this.slow > 0) dt *= 0.48;
    // ヒットストップ中はゲーム時間を止める（実時間で解除。演出の drawFx は動かし続ける）
    if (this.hitstop.tick(deltaMs)) dt = 0;
    if (dt > 0) this.step(dt, rawDt);
    this.drawFx(rawDt);
    this.hudTimer += rawDt;
    if (this.hudTimer >= 0.1) {
      this.hudTimer = 0;
      this.emitHud();
    }
  }

  step(dt: number, _rawDt: number): void {
    const s = this;
    const W = s.LW;
    const H = s.LH;
    s.gtime += dt;
    if (s.gtime >= s.chainUntil) s.chain = 0;
    const prevStageTime = s.stageTime;
    s.stageTime += dt;
    if (s.stage > 1 && prevStageTime < 2.5 && s.stageTime >= 2.5) {
      s.bannerText = `STAGE ${s.stage} — TAKE OFF`;
      s.bannerUntil = s.gtime + 2;
    }
    s.bgScroll += dt * 46;
    s.bgFar.tilePositionY = -s.bgScroll * 0.3;
    s.bgNear.tilePositionY = -s.bgScroll;
    const hpScale = 1 + (s.stage - 1) * 0.55;

    // ---- 自機移動（速度ベース＋減衰） ----
    const oldX = s.px;
    let mx = 0;
    let my = 0;
    if (s.keys.left) mx -= 1;
    if (s.keys.right) mx += 1;
    if (s.keys.up) my -= 1;
    if (s.keys.down) my += 1;
    let tvx = 0;
    let tvy = 0;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      tvx = (mx / len) * 360;
      tvy = (my / len) * 360;
      s.pointer.active = false;
    } else if (s.pointer.active) {
      const tx = s.pointer.x;
      const ty = s.pointer.y - 56;
      const dx = tx - s.px;
      const dy = ty - s.py;
      const d = Math.hypot(dx, dy);
      if (d > 2) {
        const sp = Math.min(920, d * 11);
        tvx = (dx / d) * sp;
        tvy = (dy / d) * sp;
      }
    }
    const f = dampFactor(16, dt);
    s.pvx += (tvx - s.pvx) * f;
    s.pvy += (tvy - s.pvy) * f;
    s.px = Phaser.Math.Clamp(s.px + s.pvx * dt, 16, W - 16);
    s.py = Phaser.Math.Clamp(s.py + s.pvy * dt, 40, H - 16);
    s.player.setPosition(s.px, s.py);
    s.bank += (Phaser.Math.Clamp((s.px - oldX) * 0.06, -0.35, 0.35) - s.bank) * Math.min(1, dt * 12);
    s.player.setRotation(s.bank);
    const blink = s.gtime < s.invulnUntil && Math.floor(s.gtime * 14) % 2 === 0;
    s.player.setAlpha(blink ? 0.35 : 1);
    s.prop.setScale(Math.cos(s.gtime * 65), 1);
    s.flame.setScale(1, 0.85 + Math.random() * 0.4);
    s.shieldImg.setVisible(s.shield);
    if (s.shield) s.shieldImg.setAlpha(0.55 + 0.25 * Math.sin(s.gtime * 5));
    s.exhaustT -= dt;
    if (s.exhaustT <= 0) {
      s.exhaustT = 0.04;
      s.particlePool.spawnOne(s.px + (Math.random() - 0.5) * 8, s.py + 24, (Math.random() - 0.5) * 20, 78, "#cff4ff", 5, 0.28, 0.85);
    }

    // ---- 自動発射 ----
    s.fireT -= dt;
    if (s.fireT <= 0) {
      s.fireT = 0.13;
      const patterns: Record<number, Array<{ dx: number; ang: number }>> = {
        1: [{ dx: 0, ang: 0 }],
        2: [{ dx: -9, ang: 0 }, { dx: 9, ang: 0 }],
        3: [{ dx: 0, ang: 0 }, { dx: -11, ang: 0 }, { dx: 11, ang: 0 }],
        4: [{ dx: 0, ang: 0 }, { dx: -11, ang: 0 }, { dx: 11, ang: 0 }, { dx: 0, ang: -0.17 }, { dx: 0, ang: 0.17 }],
        5: [{ dx: 0, ang: 0 }, { dx: -11, ang: 0 }, { dx: 11, ang: 0 }, { dx: 0, ang: -0.17 }, { dx: 0, ang: 0.17 }, { dx: 0, ang: -0.34 }, { dx: 0, ang: 0.34 }],
      };
      for (const sh of patterns[s.power] ?? patterns[1]) {
        const img = s.bulletPool.obtain();
        img.setPosition(s.px + sh.dx, s.py - 14).setDisplaySize(9, 17);
        img.setRotation(sh.ang);
        s.bullets.push({ img, vx: Math.sin(sh.ang) * 640, vy: -Math.cos(sh.ang) * 640, dead: false });
      }
      sfx.play("shoot");
    }
    for (let i = s.bullets.length - 1; i >= 0; i--) {
      const b = s.bullets[i];
      b.img.x += b.vx * dt;
      b.img.y += b.vy * dt;
      if (b.img.y < -30 || b.img.x < -20 || b.img.x > W + 20) {
        s.bulletPool.release(b.img);
        s.bullets.splice(i, 1);
      }
    }

    // ---- スポーン ----
    const bossAlive = s.bossId !== -1;
    if (!bossAlive) {
      s.spawnT -= dt;
      if (s.spawnT <= 0 && s.stageTime > 2) {
        s.spawnFormation();
        s.spawnT = Math.max(0.85, 2.5 - s.stage * 0.16 - Math.min(0.65, s.stageTime / 100));
      }
      s.midT -= dt;
      if (s.midT <= 0 && s.stageTime > 8) {
        s.midT = 17;
        s.spawnEnemy("mid", 80 + Math.random() * (W - 160), -40, { hp: 44 * hpScale, score: 800, fireT: 1.2 });
      }
      s.carrierT -= dt;
      if (s.carrierT <= 0) {
        s.carrierT = 23;
        s.spawnEnemy("carrier", 60 + Math.random() * (W - 120), -40, { hp: 26 * hpScale, score: 500 });
      }
      if (s.stageTime >= 78 && !s.bossSpawned) {
        s.bossSpawned = true;
        s.spawnBoss();
      }
    }

    s.enemyLogic(dt);
    if (s.phase !== "playing") return;
    s.collisionLogic(dt);
    if (s.phase !== "playing") return;
    s.powerLogic(dt);
  }

  spawnEnemy(
    kind: EKind,
    x: number,
    y: number,
    opts: { hp: number; score: number; fireT?: number; baseX?: number; phase?: number; t?: number },
  ): EnemyE {
    const texKey = `sky-${kind}`;
    const cont = this.add.container(x, y).setDepth(20);
    const body = this.add.image(0, 0, texKey);
    cont.add(body);
    let core: Phaser.GameObjects.Image | null = null;
    let rotor: Phaser.GameObjects.Image | null = null;
    if (kind === "boss") {
      core = this.add.image(0, 0, "boss-core").setDisplaySize(64, 64);
      cont.add(core);
    } else if (kind === "mid") {
      rotor = this.add.image(0, -16, "rotor-line").setDisplaySize(52, 7);
      cont.add(rotor);
    }
    const e: EnemyE = {
      cont, core, rotor,
      id: this.nextId++, kind,
      hp: opts.hp, maxHp: opts.hp,
      t: opts.t ?? 0, baseX: opts.baseX ?? 0, phase: opts.phase ?? 0,
      fireT: opts.fireT ?? 0, score: opts.score,
      pattern: 0, patternT: 0, burstT: 0, hitT: 0, dead: false,
    };
    this.enemies.push(e);
    return e;
  }

  spawnFormation(): void {
    const s = this;
    const W = s.LW;
    const hpScale = 1 + (s.stage - 1) * 0.55;
    const first = s.enemies.length;
    const formation = s.nextId;
    const roll = Math.random();
    const kx = Phaser.Math.Clamp(W / 480, 0.75, 1.7);
    if (roll > 0.87 && s.stageTime > 18) {
      for (let i = 0; i < 3; i++) {
        s.spawnEnemy("weaver", W * (0.2 + i * 0.28), -40 - i * 42, {
          hp: 6 * hpScale, score: 220, fireT: 1.8, baseX: W * (0.2 + i * 0.28), phase: i,
        });
      }
    } else if (roll < 0.45) {
      const n = 5;
      const startX = 50 + Math.random() * 60;
      for (let i = 0; i < n; i++) {
        s.spawnEnemy("diver", startX + i * 82 * kx, -30 - i * 6, {
          hp: 2 * hpScale, score: 100, baseX: startX + i * 82 * kx, phase: Math.random() * 6,
        });
      }
    } else if (roll < 0.8) {
      const fromLeft = Math.random() < 0.5;
      for (let i = 0; i < 4; i++) {
        s.spawnEnemy("sine", fromLeft ? -30 - i * 56 : W + 30 + i * 56, 60 + i * 8, {
          hp: 4 * hpScale, score: 150, baseX: fromLeft ? -1 : 1, phase: i * 0.7, t: -i * 0.4,
        });
      }
    } else {
      const cx = W * (0.2 + Math.random() * 0.6);
      for (let i = -2; i <= 2; i++) {
        s.spawnEnemy("diver", cx + i * 52 * kx, -30 - Math.abs(i) * 26, {
          hp: 2 * hpScale, score: 100, baseX: cx + i * 52 * kx, phase: Math.random() * 6,
        });
      }
    }
    const members = s.enemies.slice(first);
    for (const e of members) e.formation = formation;
    s.formations.set(formation, { remaining: members.length, failed: false });
  }

  spawnBoss(): void {
    const s = this;
    const hp = 680 * (1 + (s.stage - 1) * 0.85);
    const e = s.spawnEnemy("boss", s.LW / 2, -70, { hp, score: 10000, baseX: s.LW / 2 });
    s.bossId = e.id;
    s.bannerText = "WARNING — 嵐の要塞";
    s.bannerUntil = s.gtime + 2.2;
    sfx.play("thunder");
  }

  enemyLogic(dt: number): void {
    const s = this;
    const W = s.LW;
    const H = s.LH;
    const hpScale = 1 + (s.stage - 1) * 0.55;
    const bulletSpd = 112 + (s.stage - 1) * 16 + Math.min(28, s.stageTime * 0.36);
    const fireEBullet = (x: number, y: number, vx: number, vy: number) => {
      const img = s.ebulletPool.obtain();
      img.setPosition(x, y).setDisplaySize(15, 15);
      s.ebullets.push({ img, vx, vy, grazed: false, close: false, dead: false });
    };

    for (const e of s.enemies) {
      if (e.dead) continue;
      e.t += dt;
      e.hitT = Math.max(0, e.hitT - dt);
      const body = e.cont.list[0] as Phaser.GameObjects.Image;
      body.setTint(e.hitT > 0 ? 0xffffff : 0xffffff);
      if (e.hitT > 0) body.setTintFill(0xffffff);
      else body.clearTint();
      e.cont.setRotation(e.kind === "boss" ? Math.sin(e.t) * 0.03 : Math.sin(e.t * 2 + e.phase) * 0.1);
      if (e.rotor) e.rotor.setRotation(e.t * 30);

      if (e.kind === "diver") {
        e.cont.y += (150 + s.stage * 8) * dt;
        e.cont.x += Math.sin(e.t * 2 + e.phase) * 22 * dt;
      } else if (e.kind === "sine") {
        const dir = e.baseX;
        e.cont.x += (dir < 0 ? 105 : -105) * dt;
        e.cont.y += 52 * dt + Math.sin(e.t * 4.2 + e.phase) * 46 * dt;
      } else if (e.kind === "mid") {
        if (e.cont.y < 140) e.cont.y += 95 * dt;
        else e.cont.x += Math.sin(e.t * 0.8 + e.phase) * 65 * dt;
        e.fireT -= dt;
        if (e.fireT <= 0 && e.cont.y > 20) {
          e.fireT = 1.7;
          const base = Math.atan2(s.py - e.cont.y, s.px - e.cont.x);
          for (const off of [-0.26, 0, 0.26]) {
            fireEBullet(e.cont.x, e.cont.y + 14, Math.cos(base + off) * bulletSpd, Math.sin(base + off) * bulletSpd);
          }
          sfx.play("hit");
        }
      } else if (e.kind === "carrier") {
        e.cont.y += 55 * dt;
        e.cont.x += Math.sin(e.t * 1.4) * 18 * dt;
      } else if (e.kind === "weaver") {
        e.cont.y += 65 * dt;
        e.cont.x = e.baseX + Math.sin(e.t * 2 + e.phase) * 60;
        e.fireT -= dt;
        if (e.fireT <= 0 && e.cont.y > 40 && e.cont.y < H - 170) {
          e.fireT = 2.6;
          s.spawnEnemy("mine", e.cont.x, e.cont.y, { hp: 3 * hpScale, score: 80, fireT: 3, baseX: e.cont.x });
        }
      } else if (e.kind === "mine") {
        e.cont.y += 32 * dt;
        e.cont.setRotation(e.t * 0.7);
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = 3;
          for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3;
            fireEBullet(e.cont.x, e.cont.y, Math.cos(a) * bulletSpd * 0.65, Math.sin(a) * bulletSpd * 0.65);
          }
        }
        const coreDot = e.cont.list[0] as Phaser.GameObjects.Image;
        if (e.fireT < 0.8) coreDot.setTintFill(0xff546b);
      } else if (e.kind === "boss") {
        const bossY = Math.min(128, H * 0.2);
        if (e.cont.y < bossY) {
          e.cont.y = Math.min(bossY, e.cont.y + 62 * dt);
        } else {
          e.cont.x = W / 2 + Math.sin(e.t * 0.55) * Math.min(110, W * 0.23);
          const nextPhase = e.hp > e.maxHp * 0.67 ? 0 : e.hp > e.maxHp * 0.34 ? 1 : 2;
          if (nextPhase !== e.phase) {
            e.phase = nextPhase;
            const bonus = s.ebullets.length * 20;
            s.score += bonus;
            s.ebullets.forEach((b, i) => {
              if (i % 5 === 0) s.particlePool.burst(b.img.x, b.img.y, "#ffe89b", 2, 45, 2.2);
            });
            s.clearEBullets();
            e.patternT = 0;
            e.burstT = 0;
            s.texts.spawn(W / 2, 210, `PHASE ${e.phase + 1} 弾消し +${bonus}`, "#ffe89b");
            s.flash = Math.max(s.flash, 0.2);
            if (e.core) e.core.setTint([0x8ff4ff, 0xffd276, 0xff88b9][e.phase]);
          }
          e.patternT -= dt;
          if (e.patternT <= 0) {
            e.patternT = 5.2;
            e.fireT = 1.1;
            e.aim = Math.atan2(s.py - e.cont.y, s.px - e.cont.x);
            e.pattern += 1;
            sfx.play("warning");
            if (e.phase === 2) {
              for (const side of [-1, 1]) {
                s.spawnEnemy("sine", e.cont.x + side * 65, e.cont.y + 20, {
                  hp: 5 * hpScale, score: 180, baseX: side, fireT: 1,
                });
              }
            }
          }
          e.fireT -= dt;
          e.burstT -= dt;
          if (e.fireT <= 0 && e.burstT <= 0) {
            const speed = bulletSpd * (e.phase === 2 ? 0.95 : 0.85);
            e.burstT = e.phase === 0 ? 0.95 : e.phase === 1 ? 0.85 : 0.16;
            if (e.phase === 0) {
              for (let i = 0; i < 12; i++) {
                const a = (i * Math.PI) / 6 + e.pattern * 0.21;
                fireEBullet(e.cont.x, e.cont.y + 20, Math.cos(a) * speed, Math.sin(a) * speed);
              }
            } else if (e.phase === 1) {
              for (let i = 0; i < 20; i++) {
                if (i >= 4 && i <= 6) continue;
                const a = (i * Math.PI) / 10 + e.pattern * 0.38 + Math.max(0, 4.1 - e.patternT) * 0.2;
                fireEBullet(e.cont.x, e.cont.y, Math.cos(a) * speed * 0.8, Math.sin(a) * speed * 0.8);
              }
              const a = e.aim ?? Math.PI / 2;
              fireEBullet(e.cont.x, e.cont.y + 24, Math.cos(a) * speed * 1.4, Math.sin(a) * speed * 1.4);
            } else {
              for (const offset of [0, Math.PI]) {
                const a = e.t * 2.6 + offset;
                fireEBullet(e.cont.x, e.cont.y + 16, Math.cos(a) * speed, Math.sin(a) * speed);
              }
            }
          }
        }
      }
    }
    // 画面外の敵を除去
    for (const e of s.enemies) {
      if (e.dead || e.kind === "boss") continue;
      const exitedSide = e.kind === "sine"
        ? e.baseX < 0
          ? e.cont.x > W + 80
          : e.cont.x < -80
        : e.cont.x < -80 || e.cont.x > W + 80;
      if (e.cont.y > H + 60 || exitedSide) {
        e.dead = true;
        if (e.formation !== undefined) {
          const f = s.formations.get(e.formation);
          if (f) {
            f.failed = true;
            if (--f.remaining === 0) s.formations.delete(e.formation);
          }
        }
      }
    }
    s.cleanupEnemies();
  }

  cleanupEnemies(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) {
        this.enemies[i].cont.destroy();
        this.enemies.splice(i, 1);
      }
    }
  }

  clearEBullets(): void {
    for (const b of this.ebullets) this.ebulletPool.release(b.img);
    this.ebullets = [];
  }

  collisionLogic(dt: number): void {
    const s = this;
    const W = s.LW;
    const H = s.LH;
    void dt;
    // 自機弾 × 敵
    for (const b of s.bullets) {
      if (b.dead) continue;
      for (const e of s.enemies) {
        if (e.dead) continue;
        const er = e.kind === "boss" ? 52 : e.kind === "mid" ? 30 : e.kind === "carrier" ? 26 : 17;
        if (Math.hypot(e.cont.x - b.img.x, e.cont.y - b.img.y) < er + 4) {
          s.particlePool.burst(b.img.x, b.img.y, "#fff3b0", 2, 70, 2.2);
          b.dead = true;
          e.hp -= 1;
          e.hitT = 0.08;
          if (e.hp <= 0) s.killEnemy(e);
          break;
        }
      }
    }
    for (let i = s.bullets.length - 1; i >= 0; i--) {
      if (s.bullets[i].dead) {
        s.bulletPool.release(s.bullets[i].img);
        s.bullets.splice(i, 1);
      }
    }
    s.cleanupEnemies();

    // 敵弾
    for (const b of s.ebullets) {
      b.img.x += b.vx * dt;
      b.img.y += b.vy * dt;
      const d = Math.hypot(b.img.x - s.px, b.img.y - s.py);
      if (!b.grazed && d < 42 && d >= CORE_R + 5) {
        b.grazed = true;
        s.graze += 1;
        s.particlePool.burst((b.img.x + s.px) / 2, (b.img.y + s.py) / 2, "#fff5a4", 3, 60, 2.2);
        if (s.gtime > s.grazeSoundT) {
          s.grazeSoundT = s.gtime + 0.09;
          sfx.play(`graze${Math.min(4, Math.floor((multOf(s.graze) - 1) / 2) + 1)}` as "graze1" | "graze2" | "graze3" | "graze4");
        }
        if (s.graze % 20 === 0) {
          s.texts.spawn(s.px, s.py - 34, `倍率 ×${multOf(s.graze)}！`, "#ffd94d");
          sfx.play("pickup");
        }
      }
      if (!b.close && d >= CORE_R + 5 && d < 19 && s.gtime >= s.invulnUntil) {
        b.close = true;
        if (s.slowCooldown <= 0) {
          s.slow = 0.16;
          s.slowCooldown = 1.2;
        }
      }
      if (d < CORE_R + 4.5 && s.gtime >= s.invulnUntil) {
        b.dead = true;
        s.hitPlayer();
        if (s.phase === "over") return;
      }
    }
    for (let i = s.ebullets.length - 1; i >= 0; i--) {
      const b = s.ebullets[i];
      if (b.dead || b.img.y > H + 30 || b.img.y < -40 || b.img.x < -30 || b.img.x > W + 30) {
        s.ebulletPool.release(b.img);
        s.ebullets.splice(i, 1);
      }
    }

    // 敵本体との衝突
    if (s.gtime >= s.invulnUntil) {
      for (const e of s.enemies) {
        if (e.dead) continue;
        const er = e.kind === "boss" ? 46 : 18;
        if (Math.hypot(e.cont.x - s.px, e.cont.y - s.py) < er + 10) {
          e.hp -= 6;
          if (e.hp <= 0) s.killEnemy(e);
          s.hitPlayer();
          if (s.phase === "over") return;
          break;
        }
      }
      s.cleanupEnemies();
    }
  }

  killEnemy(e: EnemyE): void {
    const s = this;
    if (e.dead) return;
    e.dead = true;
    s.chain = s.gtime < s.chainUntil ? s.chain + 1 : 1;
    s.chainUntil = s.gtime + 2.2;
    const chainMult = 1 + Math.min(3, Math.floor(s.chain / 5));
    const gained = e.score * chainMult * multOf(s.graze);
    s.addScore(e.score * chainMult);
    s.texts.spawn(e.cont.x, e.cont.y, `+${gained}`, "#ffe08a", 0.6);
    if (s.chain % 5 === 0) s.texts.spawn(e.cont.x, e.cont.y - 20, `${s.chain} CHAIN ×${chainMult}`, "#fff39b");
    const ring = s.ringPool.obtain();
    ring.setPosition(e.cont.x, e.cont.y).setTint(0xffdc89).setDisplaySize(8, 8);
    s.rings.push({ img: ring, life: 0, maxLife: 0.5, size: e.kind === "boss" ? 280 : 84 });
    if (e.formation !== undefined) {
      const f = s.formations.get(e.formation);
      if (f && --f.remaining === 0) {
        if (!f.failed) {
          const bonus = 800 * s.stage * multOf(s.graze);
          s.score += bonus;
          s.texts.spawn(
            Phaser.Math.Clamp(e.cont.x, 120, s.LW - 120),
            Math.max(100, e.cont.y),
            `編隊撃破！ +${bonus}`,
            "#fff39b",
          );
          s.dropPower(e.cont.x, Math.max(50, e.cont.y), (["P", "S", "B"] as const)[s.powerCycle++ % 3]);
          sfx.play("pickup");
        }
        s.formations.delete(e.formation);
      }
    }
    s.particlePool.burst(e.cont.x, e.cont.y, e.kind === "boss" ? "#b388ff" : "#ffb74d", e.kind === "boss" ? 46 : 12, e.kind === "boss" ? 260 : 160);
    sfx.play(e.kind === "boss" || e.kind === "mid" ? "boom" : "hit");
    if (e.kind === "boss") s.hitstop.trigger(80);
    else if (e.kind === "mid") s.hitstop.trigger(60);
    if (e.kind === "carrier") {
      const kind = (["P", "S", "B"] as const)[s.powerCycle % 3];
      s.powerCycle += 1;
      s.dropPower(e.cont.x, e.cont.y, kind);
    }
    if (e.kind === "boss") {
      s.bossId = -1;
      s.clearEBullets();
      s.flash = 0.7;
      s.cameras.main.shake(300, 0.012);
      const bonus = 5000 * s.stage;
      s.score += bonus;
      s.bannerText = `STAGE ${s.stage} CLEAR! +${bonus.toLocaleString()}`;
      s.bannerUntil = s.gtime + 2.4;
      sfx.play("clear");
      s.stage += 1;
      s.stageTime = 0;
      s.formations.clear();
      s.bossSpawned = false;
      s.spawnT = 2.5;
      s.midT = 14;
      s.carrierT = 9;
    }
  }

  hitPlayer(): void {
    const s = this;
    if (s.gtime < s.invulnUntil) return;
    if (s.shield) {
      s.shield = false;
      s.invulnUntil = s.gtime + 1.4;
      for (let i = s.ebullets.length - 1; i >= 0; i--) {
        const b = s.ebullets[i];
        if (Math.hypot(b.img.x - s.px, b.img.y - s.py) <= 110) {
          s.ebulletPool.release(b.img);
          s.ebullets.splice(i, 1);
        }
      }
      s.particlePool.burst(s.px, s.py, "#4db8e8", 16, 170);
      s.texts.spawn(s.px, s.py - 30, "盾が吸収！ 無敵 1.4秒", "#4db8e8");
      sfx.play("freeze");
      return;
    }
    s.chain = 0;
    s.texts.spawn(s.px, s.py - 40, "被弾！ 無敵 2秒", "#ffffff");
    s.lives -= 1;
    s.power = Math.max(1, s.power - 1);
    s.invulnUntil = s.gtime + 2;
    s.cameras.main.shake(140, 0.007);
    s.particlePool.burst(s.px, s.py, "#ff6b6b", 24, 200);
    s.hurtVig.flash();
    s.hitstop.trigger(50);
    sfx.play("hurt");
    if (s.lives <= 0) s.endGame();
  }

  useBomb(): void {
    const s = this;
    if (s.phase !== "playing" || s.bombs <= 0) return;
    s.bombs -= 1;
    s.flash = 0.8;
    s.cameras.main.shake(220, 0.01);
    s.score += s.ebullets.length * 10;
    s.clearEBullets();
    for (const e of [...s.enemies]) {
      e.hp -= 50;
      if (e.hp <= 0 && !e.dead) s.killEnemy(e);
    }
    s.cleanupEnemies();
    sfx.play("bomb");
    s.emitHud();
  }

  dropPower(x: number, y: number, kind: PowerE["kind"]): void {
    const st = POWER_STYLE[kind];
    const cont = this.add.container(x, y).setDepth(22);
    const bg = this.add.image(0, 0, "power-box").setDisplaySize(30, 30);
    bg.setTint(Phaser.Display.Color.HexStringToColor(st.color).color);
    const label = this.add
      .text(0, 1, st.label, { fontFamily: "sans-serif", fontStyle: "bold", fontSize: "17px", resolution: 2, color: "#ffffff" })
      .setOrigin(0.5);
    cont.add([bg, label]);
    this.powers.push({ cont, kind, t: 0, dead: false });
  }

  powerLogic(dt: number): void {
    const s = this;
    for (let i = s.powers.length - 1; i >= 0; i--) {
      const p = s.powers[i];
      p.t += dt;
      p.cont.y += 92 * dt;
      p.cont.x += Math.sin(p.t * 3) * 14 * dt;
      const d = Math.hypot(s.px - p.cont.x, s.py - p.cont.y);
      if (d < 90 && d > 0.01) {
        p.cont.x += ((s.px - p.cont.x) / d) * 130 * dt;
        p.cont.y += ((s.py - p.cont.y) / d) * 130 * dt;
      }
      if (d < 26) {
        p.dead = true;
        if (p.kind === "P") {
          if (s.power >= 5) {
            s.score += 1000;
            s.texts.spawn(s.px, s.py - 30, "+1000", "#ff9f43");
          } else {
            s.power += 1;
            s.texts.spawn(s.px, s.py - 30, "パワーアップ！", "#ff9f43");
          }
        } else if (p.kind === "S") {
          if (s.shield) s.score += 500;
          else {
            s.shield = true;
            s.texts.spawn(s.px, s.py - 30, "シールド！", "#4db8e8");
          }
        } else {
          if (s.bombs >= 5) s.score += 500;
          else {
            s.bombs += 1;
            s.texts.spawn(s.px, s.py - 30, "ボム+1", "#b388ff");
          }
        }
        sfx.play("levelup");
      }
      if (p.dead || p.cont.y > s.LH + 30) {
        p.cont.destroy();
        s.powers.splice(i, 1);
      }
    }
  }

  drawFx(dt: number): void {
    const s = this;
    s.particlePool.update(dt);
    s.texts.update(dt, 36);
    for (let i = s.rings.length - 1; i >= 0; i--) {
      const r = s.rings[i];
      r.life += dt;
      if (r.life >= r.maxLife) {
        s.ringPool.release(r.img);
        s.rings.splice(i, 1);
        continue;
      }
      const d = 8 + r.size * (r.life / r.maxLife);
      r.img.setDisplaySize(d, d);
      r.img.setAlpha(1 - r.life / r.maxLife);
    }
    s.flash = Math.max(0, s.flash - 1.6 * dt);
    s.flashRect.setAlpha(s.flash * 0.75);
    // バナー
    if (s.bannerText && s.gtime < s.bannerUntil && s.phase !== "idle") {
      s.bannerObj.setText(s.bannerText).setVisible(true);
      s.bannerObj.setPosition(s.LW / 2, s.LH / 2 - 62);
    } else {
      s.bannerObj.setVisible(false);
    }
    // ボスのテレグラフ
    const g = s.fxG;
    g.clear();
    const boss = s.enemies.find((e) => e.kind === "boss" && !e.dead);
    let warnText = "";
    if (boss && boss.fireT > 0 && boss.cont.y >= Math.min(128, s.LH * 0.2)) {
      const a = boss.aim ?? Math.PI / 2;
      g.lineStyle(2, 0xff5673, 0.6);
      const x2 = boss.cont.x + Math.cos(a) * 800;
      const y2 = boss.cont.y + Math.sin(a) * 800;
      const len = 800;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      for (let d = 0; d < len; d += 17) {
        const e2 = Math.min(len, d + 9);
        g.lineBetween(boss.cont.x + ux * d, boss.cont.y + uy * d, boss.cont.x + ux * e2, boss.cont.y + uy * e2);
      }
      if (boss.phase === 1) {
        const gap = boss.pattern * 0.38 + Math.PI / 2;
        g.lineStyle(5, 0x69f4c5, 0.9);
        g.beginPath();
        g.arc(boss.cont.x, boss.cont.y, 82, gap - 0.42, gap + 0.42, false);
        g.strokePath();
      }
      warnText = ["警告：放射バースト", "警告：狙撃＋回転壁 / 隙間へ", "警告：二重螺旋＋子機召喚"][boss.phase];
      g.fillStyle(0xffffff, 0.92);
      g.fillRect(70, 88, s.LW - 140, 26);
      void x2;
      void y2;
    }
    if (warnText) {
      s.warnObj.setText(warnText).setVisible(true);
      s.warnObj.setPosition(s.LW / 2, 102);
    } else {
      s.warnObj.setVisible(false);
    }
    // ボスHPマーカー（フェーズ境界）は DOM HUD 側で表示するため、ここでは簡易バー
    if (boss) {
      const bw = s.LW - 80;
      g.fillStyle(0x14283c, 0.6);
      g.fillRect(40, 46, bw, 12);
      g.fillStyle(0xb388ff, 1);
      g.fillRect(42, 48, (bw - 4) * Math.max(0, boss.hp / boss.maxHp), 8);
    }
  }

  emitHud(): void {
    const boss = this.enemies.find((e) => e.kind === "boss" && !e.dead);
    this.hooks.onHud({
      score: this.score,
      mult: multOf(this.graze),
      graze: this.graze,
      stage: this.stage,
      bombs: this.bombs,
      lives: this.lives,
      chain: this.chain,
      chainMult: 1 + Math.min(3, Math.floor(this.chain / 5)),
      chainRatio: this.chain > 0 ? Math.max(0, (this.chainUntil - this.gtime) / 2.2) : 0,
      power: this.power,
      shield: this.shield,
      invulnSec: Math.max(0, this.invulnUntil - this.gtime),
      bossRatio: boss ? Math.max(0, boss.hp / boss.maxHp) : null,
      bossPhase: boss ? boss.phase : 0,
    });
  }
}

export function createSkyShooterGame(
  parent: HTMLElement,
  hooks: SkyHooks,
): { game: Phaser.Game; api: SkyApi; destroy: () => void } {
  const scene = new SkyScene();
  scene.hooks = hooks;
  const game = new Phaser.Game(baseGameConfig(parent, [scene as unknown as Phaser.Types.Scenes.SettingsConfig]));
  const detach = attachDprResize(game, parent);
  const api: SkyApi = {
    start: () => {
      if (scene.booted) scene.start();
      else scene.autoStartOnBoot = true;
    },
    pause: () => { if (scene.booted && scene.phase === "playing") scene.setPhase("paused"); },
    resume: () => { if (scene.booted && scene.phase === "paused") scene.setPhase("playing"); },
    bomb: () => { if (scene.booted) scene.useBomb(); },
    autoPause: () => { if (scene.booted && scene.phase === "playing") scene.setPhase("paused"); },
  };
  return { game, api, destroy: () => { detach(); sfx.stopBgm("sky"); game.destroy(true); } };
}
