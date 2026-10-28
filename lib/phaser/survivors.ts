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
  /** 羽ばたきフレーム（0/1） */
  frame: number;
  /** 通常時の表示スケール（setDisplaySize後の scaleX） */
  baseScale: number;
  /** 演出用タイマー（土煙・火花など） */
  fxT: number;
  /** エリート/ボスのオーラリング */
  aura: Phaser.GameObjects.Image | null;
  auraS: number;
};
type BulletE = { img: Phaser.GameObjects.Image; vx: number; vy: number; dmg: number; life: number };
type MissileE = {
  obj: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  targetId: number;
  dmg: number;
  life: number;
  trailT: number;
  dead: boolean;
};
type GemE = { img: Phaser.GameObjects.Image; v: number; vx: number; vy: number; seed: number; dead: boolean };
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
  bolts: { pts: { x: number; y: number }[]; ttl: number; seed: number }[] = [];
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
  playerShadow!: Phaser.GameObjects.Image;
  playerBase = 0.5;
  hurtAnim = 0;
  lvlAnim = 0;
  trailT = 0;
  faceFlip = false;
  beamImg!: Phaser.GameObjects.Image;
  beamRing!: Phaser.GameObjects.Image;
  fxG!: Phaser.GameObjects.Graphics;
  bannerObj!: Phaser.GameObjects.Text;
  joyBase!: Phaser.GameObjects.Image;
  joyKnob!: Phaser.GameObjects.Image;
  vignette!: Phaser.GameObjects.Image;
  hurtVig!: HurtVignette;
  hitstop = new Hitstop();
  bulletPool!: ImagePool;
  gemPool!: ImagePool;
  particlePool!: ParticlePool;
  sparklePool!: ParticlePool;
  texts!: TextPool;
  bladeObjs: Phaser.GameObjects.Image[] = [];
  missileFree: Phaser.GameObjects.Image[] = [];
  healFree: Phaser.GameObjects.Text[] = [];
  /** 撃破時の残像フェード用プール */
  ghosts: { img: Phaser.GameObjects.Image; life: number }[] = [];
  ghostFree: Phaser.GameObjects.Image[] = [];
  /** ワールド装飾（木・岩・花・柵・干し草・麦の束） */
  propsArr: { img: Phaser.GameObjects.Image; phase: number; sway: boolean }[] = [];
  /** 漂う花粉・花びら */
  motes: { img: Phaser.GameObjects.Image; phase: number; spd: number }[] = [];
  /** フェーズ不問で進む演出時計 */
  animT = 0;
  hudTimer = 0;
  uiScale = 1;
  booted = false;
  autoStartOnBoot = false;

  constructor() {
    super("survivors");
  }

  preload(): void {
    this.load.image("mugi-alpha", "/mugi-transparent.png");
  }

  create(): void {
    this.createTextures();
    ensureDot(this);
    ensureRing(this);

    // 背景：麦畑タイル＋ワールド境界
    const bg = this.add.tileSprite(0, 0, WORLD, WORLD, "surv-bg").setOrigin(0, 0).setDepth(0);
    void bg;
    const border = this.add.graphics().setDepth(1);
    border.lineStyle(10, 0x7a5a1e, 1);
    border.strokeRect(0, 0, WORLD, WORLD);

    this.fxG = this.add.graphics().setDepth(40);

    // プレイヤー（本人のアバター画像・透過PNG。キャラ実高さが約50pxになるサイズ）
    this.playerImg = this.add.image(0, 0, "mugi-alpha").setDisplaySize(57, 57);
    this.playerBase = this.playerImg.scaleX;
    this.playerShadow = this.add.image(0, 24, "tex-dot").setDisplaySize(46, 15).setTint(0x354624).setAlpha(0.3);
    this.player = this.add.container(this.px, this.py, [this.playerShadow, this.playerImg]).setDepth(30);

    this.beamImg = this.add.image(0, 0, "beam-grad").setDisplaySize(56, 430).setOrigin(0.5, 1).setDepth(29).setVisible(false);
    this.beamRing = this.add.image(0, 0, "tex-ring").setDepth(29).setTint(0xfff6b6).setVisible(false);

    this.bulletPool = new ImagePool(this, "shot-dot", 25);
    this.gemPool = new ImagePool(this, "gem1", 15);
    this.particlePool = new ParticlePool(new ImagePool(this, "tex-dot", 35));
    this.sparklePool = new ParticlePool(new ImagePool(this, "tex-spark", 36));
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
    // 被弾ヴィネット（低HPビネットの上・バナーの下）
    this.hurtVig = new HurtVignette(this, 81);
    this.hurtVig.img.setScrollFactor(0);

    this.joyBase = this.add.image(0, 0, "tex-dot").setDisplaySize(104, 104).setTint(0x23405a).setAlpha(0.3).setDepth(95).setScrollFactor(0).setVisible(false);
    this.joyKnob = this.add.image(0, 0, "tex-dot").setDisplaySize(44, 44).setTint(0x23405a).setAlpha(0.55).setDepth(96).setScrollFactor(0).setVisible(false);

    for (let i = 0; i < 5; i++) {
      const t = this.add.image(0, 0, "blade").setDisplaySize(44, 44).setDepth(28).setVisible(false);
      this.bladeObjs.push(t);
    }

    this.scatterProps();
    this.initMotes();

    this.setupInput();
    this.layoutCamera();
    this.scale.on("resize", () => this.layoutCamera());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => sfx.stopBgm("survivors"));
    this.events.once(Phaser.Scenes.Events.DESTROY, () => sfx.stopBgm("survivors"));
    this.resetState();
    this.booted = true;
    if (this.autoStartOnBoot) {
      this.autoStartOnBoot = false;
      this.start();
    }
  }

  /** ワールド全域に装飾プロップを散らす（プレイヤー初期位置の周囲は空ける） */
  scatterProps(): void {
    const kinds: { tex: string; size: number; sway: boolean; w: number }[] = [
      { tex: "prop-tuft", size: 46, sway: true, w: 34 },
      { tex: "prop-flower", size: 54, sway: true, w: 22 },
      { tex: "prop-rock", size: 58, sway: false, w: 14 },
      { tex: "prop-fence", size: 92, sway: false, w: 12 },
      { tex: "prop-hay", size: 62, sway: false, w: 10 },
      { tex: "prop-tree", size: 118, sway: false, w: 8 },
    ];
    const totalW = kinds.reduce((a, k) => a + k.w, 0);
    for (let i = 0; i < 120; i++) {
      const x = 50 + Math.random() * (WORLD - 100);
      const y = 50 + Math.random() * (WORLD - 100);
      if (Math.hypot(x - WORLD / 2, y - WORLD / 2) < 150) continue;
      let roll = Math.random() * totalW;
      let kind = kinds[0];
      for (const k of kinds) {
        roll -= k.w;
        if (roll <= 0) { kind = k; break; }
      }
      const img = this.add
        .image(x, y, kind.tex)
        .setDisplaySize(kind.size, kind.size)
        .setDepth(kind.tex === "prop-tree" ? 6 : 5);
      if (kind.tex === "prop-fence") img.setRotation(Math.random() < 0.5 ? 0 : Math.PI / 2);
      this.propsArr.push({ img, phase: Math.random() * Math.PI * 2, sway: kind.sway });
    }
  }

  /** 漂う花粉・花びらを用意する */
  initMotes(): void {
    for (let i = 0; i < 24; i++) {
      const petal = i % 2 === 0;
      const img = this.add
        .image(Math.random() * WORLD, Math.random() * WORLD, petal ? "tex-petal" : "tex-dot")
        .setDepth(44)
        .setAlpha(petal ? 0.75 : 0.5);
      if (petal) img.setDisplaySize(15, 10.5);
      else img.setDisplaySize(5, 5).setTint(0xfff3a0);
      this.motes.push({ img, phase: Math.random() * Math.PI * 2, spd: 0.7 + Math.random() * 0.7 });
    }
  }

  /** フェーズ不問の環境アニメーション（小物の揺れ・花びらの漂い） */
  ambientLogic(dt: number): void {
    const t = this.animT;
    for (const p of this.propsArr) {
      if (p.sway) p.img.setRotation(Math.sin(t * 1.7 + p.phase) * 0.055);
    }
    const view = this.cameras.main.worldView;
    for (const m of this.motes) {
      m.img.x += (16 * m.spd + Math.sin(t * 0.9 + m.phase) * 9) * dt;
      m.img.y += (6 + Math.cos(t * 0.7 + m.phase) * 8) * dt;
      m.img.setRotation(t * 0.6 + m.phase);
      // 画面外に出たら風上（左上）から再登場させる
      if (
        m.img.x > view.right + 30 || m.img.y > view.bottom + 30 ||
        m.img.x < view.left - 60 || m.img.y < view.top - 60
      ) {
        m.img.x = view.left - 20 + Math.random() * 40;
        m.img.y = view.top + Math.random() * Math.max(1, view.height);
        if (m.img.x < 0 || m.img.y < 0 || m.img.x > WORLD || m.img.y > WORLD) {
          m.img.x = Phaser.Math.Clamp(m.img.x, 10, WORLD - 10);
          m.img.y = Phaser.Math.Clamp(m.img.y, 10, WORLD - 10);
        }
      }
    }
  }

  /** 撃破時の残像（拡大しながらフェード）を出す */
  spawnGhost(e: EnemyE): void {
    const img = this.ghostFree.pop() ?? this.add.image(0, 0, `enemy-${e.kind}`);
    img.setTexture(`enemy-${e.kind}`);
    img.setPosition(e.img.x, e.img.y);
    img.setRotation(e.img.rotation);
    img.setScale(e.baseScale * 1.02);
    img.setAlpha(0.8);
    img.setDepth(19);
    img.setActive(true).setVisible(true);
    img.clearTint();
    this.ghosts.push({ img, life: 0 });
  }

  createTextures(): void {
    // 麦畑タイル（180x180）— 草の濃淡・麦の穂・小花・小石まで描き込む
    genTex(this, "surv-bg", 180, 180, (g) => {
      g.fillStyle(0xc9dd7e, 1);
      g.fillRect(0, 0, 180, 180);
      // 草地のムラ
      g.fillStyle(0xb7d16a, 0.5);
      g.fillEllipse(46, 42, 92, 46);
      g.fillEllipse(146, 132, 104, 52);
      g.fillStyle(0xd8ec9a, 0.35);
      g.fillEllipse(120, 36, 70, 30);
      g.fillEllipse(30, 150, 66, 30);
      g.fillStyle(0x785a14, 0.08);
      g.fillEllipse(40, 50, 42, 14);
      g.fillEllipse(130, 120, 52, 16);
      g.fillEllipse(90, 160, 36, 12);
      // 草の穂先ドット（ノイズ）
      let nz = 1234567;
      const rnd = () => {
        nz = (nz * 1103515245 + 12345) % 2147483648;
        return nz / 2147483648;
      };
      g.fillStyle(0x719344, 0.35);
      for (let i = 0; i < 90; i++) g.fillCircle(rnd() * 180, rnd() * 180, 1.4);
      g.fillStyle(0xe6f2ae, 0.4);
      for (let i = 0; i < 50; i++) g.fillCircle(rnd() * 180, rnd() * 180, 1.1);
      // 麦の茎＋穂
      const stalk = (x: number, y: number, lean: number) => {
        g.lineStyle(2, 0xa8842e, 0.85);
        g.lineBetween(x, y + 12, x + lean, y - 12);
        g.fillStyle(0xe8c95a, 1);
        for (let k = 0; k < 3; k++) {
          g.fillEllipse(x + lean - 3 + k * 3, y - 13 - k * 2, 4.5, 7);
        }
        g.lineStyle(1.4, 0x719344, 0.55);
        g.lineBetween(x + lean, y - 4, x - 4, y - 8);
        g.lineBetween(x + lean, y - 4, x + 9 + lean, y - 8);
      };
      stalk(30, 90, 3);
      stalk(80, 40, 2);
      stalk(140, 70, 4);
      stalk(60, 140, 3);
      stalk(160, 160, 2);
      stalk(110, 100, 3);
      stalk(18, 26, 2);
      stalk(168, 104, 3);
      // 小花と小石
      g.fillStyle(0xffffff, 1);
      g.fillCircle(150, 30, 3.4);
      g.fillCircle(24, 150, 2.8);
      g.fillStyle(0xffb7d5, 1);
      g.fillCircle(96, 158, 3);
      g.fillCircle(52, 66, 2.6);
      g.fillStyle(0x9aa3a8, 0.6);
      g.fillEllipse(122, 148, 7, 4.4);
      g.fillEllipse(38, 112, 5.4, 3.6);
    });

    const SS = 2; // テクスチャのスーパーサンプリング
    const enemyTex = (kind: string, draw: (g: Phaser.GameObjects.Graphics, c: number) => void) => {
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
    // カラス：翼を下ろしたフレーム
    enemyTex("crow-f1", (g, c) => {
      g.fillStyle(0x42536a, 1);
      g.fillTriangle(c, c, c - 48, c + 20, c - 13, c + 10);
      g.fillTriangle(c, c, c + 48, c + 20, c + 13, c + 10);
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
    // コウモリ：翼を下ろしたフレーム
    enemyTex("bat-f1", (g, c) => {
      g.fillStyle(0x6d5580, 1);
      g.fillTriangle(c, c, c - 50, c + 22, c - 28, c + 8);
      g.fillTriangle(c - 28, c + 8, c - 40, c + 26, c - 10, c + 13);
      g.fillTriangle(c, c, c + 50, c + 22, c + 28, c + 8);
      g.fillTriangle(c + 28, c + 8, c + 40, c + 26, c + 10, c + 13);
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
    // ハチ：高速でブレた羽のフレーム
    enemyTex("bee-f1", (g, c) => {
      g.fillStyle(0xe6faff, 0.3);
      g.fillEllipse(c - 17, c - 17, 38, 16);
      g.fillEllipse(c + 17, c - 17, 38, 16);
      g.fillStyle(0xe6faff, 0.45);
      g.fillEllipse(c - 16, c - 13, 30, 10);
      g.fillEllipse(c + 16, c - 13, 30, 10);
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
    // 経験値ジェム：麦畑の緑・茶に埋もれない鮮やかなマゼンタ＋白フチ＋グロー（ダイヤ型）
    genTex(this, "gem1", 28, 28, (g) => {
      g.fillStyle(0xff4da6, 0.22);
      g.fillCircle(14, 14, 13.5);
      g.fillStyle(0xff4da6, 0.28);
      g.fillCircle(14, 14, 10);
      // 白フチ（ひと回り大きいダイヤを下に敷く）
      g.fillStyle(0xffffff, 1);
      g.fillPoints(
        [
          { x: 14, y: 1.5 },
          { x: 25.5, y: 11 },
          { x: 14, y: 26.5 },
          { x: 2.5, y: 11 },
        ],
        true
      );
      // 本体マゼンタ
      g.fillStyle(0xff4da6, 1);
      g.fillPoints(
        [
          { x: 14, y: 5 },
          { x: 22, y: 11 },
          { x: 14, y: 23 },
          { x: 6, y: 11 },
        ],
        true
      );
      // ファセット：上は明るく、下は濃く
      g.fillStyle(0xffa8d2, 0.85);
      g.fillPoints(
        [
          { x: 14, y: 5 },
          { x: 22, y: 11 },
          { x: 6, y: 11 },
        ],
        true
      );
      g.fillStyle(0xd1107c, 0.8);
      g.fillPoints(
        [
          { x: 6, y: 11 },
          { x: 22, y: 11 },
          { x: 14, y: 23 },
        ],
        true
      );
      // ハイライト
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(11, 8.5, 1.8);
    });
    genTex(this, "gem5", 36, 36, (g) => {
      g.fillStyle(0xff4da6, 0.25);
      g.fillCircle(18, 18, 17.5);
      g.fillStyle(0xff4da6, 0.3);
      g.fillCircle(18, 18, 13);
      // 白フチ
      g.fillStyle(0xffffff, 1);
      g.fillPoints(
        [
          { x: 18, y: 2 },
          { x: 33, y: 14 },
          { x: 18, y: 34 },
          { x: 3, y: 14 },
        ],
        true
      );
      // 本体マゼンタ
      g.fillStyle(0xff4da6, 1);
      g.fillPoints(
        [
          { x: 18, y: 6 },
          { x: 29, y: 14 },
          { x: 18, y: 30 },
          { x: 7, y: 14 },
        ],
        true
      );
      // ファセット
      g.fillStyle(0xffa8d2, 0.85);
      g.fillPoints(
        [
          { x: 18, y: 6 },
          { x: 29, y: 14 },
          { x: 7, y: 14 },
        ],
        true
      );
      g.fillStyle(0xd1107c, 0.8);
      g.fillPoints(
        [
          { x: 7, y: 14 },
          { x: 29, y: 14 },
          { x: 18, y: 30 },
        ],
        true
      );
      // ハイライト＋きらめき
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(14, 11, 2.3);
      g.fillStyle(0xffffff, 0.85);
      g.fillCircle(24, 9, 1.3);
    });
    // 回転ガマの刃（弧を描く銀の刃＋金の柄）
    genTex(this, "blade", 64, 64, (g) => {
      g.lineStyle(6, 0x8a5a2e, 1);
      g.lineBetween(36, 40, 54, 58);
      g.fillStyle(0xffd94d, 1);
      g.fillCircle(37, 41, 4);
      g.lineStyle(8, 0xb9c7d4, 1);
      g.beginPath();
      g.arc(28, 36, 21, -2.2, 0.9, false);
      g.strokePath();
      g.lineStyle(3, 0xf4f9ff, 1);
      g.beginPath();
      g.arc(28, 36, 24, -2.2, 0.9, false);
      g.strokePath();
    });
    // 追尾ミサイル（右向きロケット）
    genTex(this, "missile", 48, 48, (g) => {
      g.fillStyle(0xff8b3d, 1);
      g.fillTriangle(6, 24, 17, 18, 17, 30);
      g.fillStyle(0xffd23f, 1);
      g.fillTriangle(11, 24, 17, 20.5, 17, 27.5);
      g.fillStyle(0xe14b4b, 1);
      g.fillTriangle(18, 17, 26, 10, 28, 18);
      g.fillTriangle(18, 31, 26, 38, 28, 30);
      g.fillStyle(0xf2f5f7, 1);
      g.fillEllipse(27, 24, 26, 15);
      g.fillStyle(0xff8b3d, 1);
      g.fillTriangle(40, 24, 33, 17.5, 33, 30.5);
      g.fillStyle(0x7ec8f7, 1);
      g.fillCircle(28, 24, 4);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(29.5, 22.5, 1.6);
    });
    // 4方向に尖るキラキラ
    genTex(this, "tex-spark", 24, 24, (g) => {
      g.fillStyle(0xffffff, 1);
      g.fillPoints(
        [
          { x: 12, y: 0 }, { x: 15, y: 9 }, { x: 24, y: 12 }, { x: 15, y: 15 },
          { x: 12, y: 24 }, { x: 9, y: 15 }, { x: 0, y: 12 }, { x: 9, y: 9 },
        ],
        true,
      );
      g.fillCircle(12, 12, 3);
    });
    // 花びら（漂う環境パーティクル用）
    genTex(this, "tex-petal", 20, 14, (g) => {
      g.fillStyle(0xffd7e8, 1);
      g.fillEllipse(10, 7, 18, 11);
      g.fillStyle(0xfff0f7, 1);
      g.fillEllipse(8, 5.5, 9, 5.5);
    });
    // ---- ワールド装飾プロップ ----
    genTex(this, "prop-tree", 120, 120, (g) => {
      g.fillStyle(0x354624, 0.18);
      g.fillEllipse(60, 100, 62, 15);
      g.fillStyle(0x7a4a26, 1);
      g.fillRect(54, 60, 12, 38);
      g.fillStyle(0x4e7d3a, 1);
      g.fillCircle(60, 42, 27);
      g.fillStyle(0x5d8f45, 1);
      g.fillCircle(38, 54, 19);
      g.fillCircle(82, 54, 19);
      g.fillStyle(0x6da352, 1);
      g.fillCircle(60, 28, 18);
      g.fillStyle(0x8fbf6f, 0.8);
      g.fillCircle(48, 34, 5);
      g.fillCircle(72, 46, 4.4);
      g.fillCircle(58, 54, 4);
      g.fillStyle(0xe14b4b, 1);
      g.fillCircle(44, 48, 3.6);
      g.fillCircle(76, 34, 3.6);
      g.fillCircle(64, 62, 3.6);
    });
    genTex(this, "prop-rock", 64, 52, (g) => {
      g.fillStyle(0x354624, 0.16);
      g.fillEllipse(32, 42, 48, 10);
      g.fillStyle(0x8b959b, 1);
      g.fillEllipse(32, 28, 50, 34);
      g.fillStyle(0xa7b0b5, 1);
      g.fillEllipse(26, 21, 30, 18);
      g.fillStyle(0x6f797f, 1);
      g.fillEllipse(42, 34, 22, 13);
      g.fillStyle(0xc9d1d5, 0.9);
      g.fillEllipse(21, 17, 11, 6);
    });
    genTex(this, "prop-flower", 56, 56, (g) => {
      g.lineStyle(2, 0x5d8f45, 0.9);
      g.lineBetween(16, 52, 15, 34);
      g.lineBetween(30, 54, 31, 30);
      g.lineBetween(43, 52, 42, 36);
      const flower = (x: number, y: number, petal: number) => {
        g.fillStyle(petal, 1);
        for (let k = 0; k < 5; k++) {
          const a = (k * Math.PI * 2) / 5 - Math.PI / 2;
          g.fillCircle(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 4);
        }
        g.fillStyle(0xffd94d, 1);
        g.fillCircle(x, y, 3.2);
      };
      flower(15, 28, 0xff8fc0);
      flower(31, 23, 0xffffff);
      flower(42, 30, 0xffb35c);
      g.fillStyle(0x6da352, 1);
      g.fillEllipse(23, 50, 15, 6);
      g.fillEllipse(38, 48, 13, 5.4);
    });
    genTex(this, "prop-fence", 96, 44, (g) => {
      g.fillStyle(0x354624, 0.14);
      g.fillEllipse(48, 38, 86, 8);
      g.fillStyle(0xa4763f, 1);
      g.fillRect(4, 13, 88, 7);
      g.fillRect(4, 27, 88, 7);
      g.fillStyle(0x8a5f30, 1);
      g.fillRect(10, 5, 9, 34);
      g.fillRect(77, 5, 9, 34);
      g.fillStyle(0xc08d4e, 1);
      g.fillRect(4, 13, 88, 2.4);
      g.fillRect(10, 5, 9, 3);
      g.fillRect(77, 5, 9, 3);
    });
    genTex(this, "prop-hay", 66, 54, (g) => {
      g.fillStyle(0x354624, 0.16);
      g.fillEllipse(33, 44, 52, 10);
      g.fillStyle(0xe3b93e, 1);
      g.fillEllipse(33, 27, 54, 38);
      g.lineStyle(3, 0xb98a1e, 0.85);
      for (const r of [15, 10, 5.5]) {
        g.beginPath();
        g.arc(33, 27, r, 0.4, 5.6, false);
        g.strokePath();
      }
      g.lineStyle(2.4, 0xb98a1e, 0.9);
      g.lineBetween(8, 20, 58, 20);
      g.lineBetween(8, 35, 58, 35);
    });
    genTex(this, "prop-tuft", 48, 48, (g) => {
      for (const [dx, lean] of [[-13, -5], [-6, -2], [0, 1], [7, 4], [14, 7]] as const) {
        g.lineStyle(2.2, 0xa8842e, 0.95);
        g.lineBetween(24 + dx * 0.4, 47, 24 + dx + lean, 14);
        g.fillStyle(0xe8c95a, 1);
        for (let k = 0; k < 3; k++) {
          g.fillEllipse(24 + dx + lean - 3 + k * 3, 13 - k * 2.4, 5, 8);
        }
      }
      g.fillStyle(0x719344, 0.6);
      g.fillEllipse(24, 45, 34, 7);
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

    // むぎアイコンは透過PNG（mugi-alpha）をそのまま使う（白い背面は付けない）。
    // 読み込みに失敗した場合のみ、描画フォールバックを用意する（genTex は既存テクスチャがあれば何もしない）。
    genTex(this, "mugi-alpha", 96, 96, (g) => {
      g.fillStyle(0xaee3ff, 1);
      g.fillCircle(48, 50, 40);
      g.fillStyle(0xfff1d6, 1);
      g.fillEllipse(48, 42, 54, 44);
      g.fillStyle(0x23405a, 1);
      g.fillCircle(37, 40, 4.5);
      g.fillCircle(59, 40, 4.5);
      g.fillStyle(0xf2a0a0, 1);
      g.fillCircle(30, 51, 5);
      g.fillCircle(66, 51, 5);
    });
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
    // scrollFactor 0 でもズームは画面中心基準で掛かるので、ズームを打ち消したサイズで中央に置く
    this.hurtVig?.layout(vw / 2, vh / 2, vw / zoom, vh / zoom);
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
    for (const e of this.enemies) {
      e.aura?.destroy();
      e.img.destroy();
    }
    for (const b of this.bullets) this.bulletPool.release(b.img);
    for (const m of this.missiles) m.obj.destroy();
    for (const g of this.gems) this.gemPool.release(g.img);
    for (const h of this.heals) h.obj.destroy();
    for (const gh of this.ghosts) {
      gh.img.setActive(false).setVisible(false);
      this.ghostFree.push(gh.img);
    }
    this.ghosts = [];
    this.enemies = [];
    this.bullets = [];
    this.missiles = [];
    this.gems = [];
    this.heals = [];
    this.hazards = [];
    this.bolts = [];
    this.particlePool?.clear();
    this.sparklePool?.clear();
    this.texts?.clear();
    this.hurtVig?.clear();
    this.hitstop.reset();
    this.hurtAnim = 0;
    this.lvlAnim = 0;
    this.trailT = 0;
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
    sfx.startBgm("survivors");
  }

  // ================= 更新 =================
  update(_time: number, deltaMs: number): void {
    const rawDt = Math.min(0.033, deltaMs / 1000);
    this.animT += rawDt;
    this.ambientLogic(rawDt);
    // ジョイスティック表示はフェーズ不問で追従
    if (this.joy.active && this.phase === "playing") {
      this.joyBase.setVisible(true).setPosition(this.joy.ox, this.joy.oy);
      this.joyKnob.setVisible(true).setPosition(this.joy.ox + this.joy.dx * 34 * this.uiScale, this.joy.oy + this.joy.dy * 34 * this.uiScale);
    } else {
      this.joyBase.setVisible(false);
      this.joyKnob.setVisible(false);
    }
    if (this.phase !== "playing") return;
    // ヒットストップ中はゲーム時間ごと止める（実時間で解除）
    if (this.hitstop.tick(deltaMs)) return;
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
    // ---- むぎのアニメーション（上下動・呼吸・つぶれ・向き） ----
    const spdRatio = Math.min(1, Math.hypot(s.pvx, s.pvy) / maxSpd);
    const bob = spdRatio > 0.04 ? Math.sin(s.gtime * 13) * 3.4 * spdRatio : 0;
    s.playerImg.y = bob;
    let asx = 1;
    let asy = 1;
    if (spdRatio > 0.04) {
      const b = Math.sin(s.gtime * 13) * 0.05 * spdRatio;
      asy += b;
      asx -= b * 0.7;
    } else {
      const br = Math.sin(s.gtime * 2.1) * 0.03;
      asy += br;
      asx -= br * 0.6;
    }
    if (s.hurtAnim > 0) {
      const p = Math.sin((1 - s.hurtAnim) * Math.PI);
      asx += 0.22 * p;
      asy -= 0.2 * p;
      s.hurtAnim = Math.max(0, s.hurtAnim - dt * 3.4);
    }
    if (s.lvlAnim > 0) {
      const p = Math.sin((1 - s.lvlAnim) * Math.PI);
      asy += 0.3 * p;
      asx -= 0.16 * p;
      s.lvlAnim = Math.max(0, s.lvlAnim - dt * 2.6);
    }
    s.playerImg.setScale(s.playerBase * asx, s.playerBase * asy);
    if (s.pvx < -40 && !s.faceFlip) { s.faceFlip = true; s.playerImg.setFlipX(true); }
    else if (s.pvx > 40 && s.faceFlip) { s.faceFlip = false; s.playerImg.setFlipX(false); }
    // 影は上下動に合わせて濃さ・大きさを変える
    s.playerShadow.setAlpha(0.3 - bob * 0.012);
    s.playerShadow.setDisplaySize(46 * (1 - bob * 0.014), 15 * (1 - bob * 0.014));
    // 走行中のキラキラ軌跡
    if (spdRatio > 0.35) {
      s.trailT -= dt;
      if (s.trailT <= 0) {
        s.trailT = 0.055;
        const tc = ["#ffffff", "#ffd94d", "#aee3ff"][Math.floor(Math.random() * 3)];
        s.sparklePool.spawnOne(
          s.px + (Math.random() - 0.5) * 20, s.py + 14 + Math.random() * 8,
          -s.pvx * 0.12, -s.pvy * 0.12 + 14, tc, 6 + Math.random() * 4, 0.42, 0.9,
        );
      }
    }
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
      // 光柱の中を星屑が昇る
      for (let i = 0; i < 2; i++) {
        s.sparklePool.spawnOne(
          s.px + (Math.random() - 0.5) * 40, s.py + 16 + Math.random() * 10,
          (Math.random() - 0.5) * 26, -(95 + Math.random() * 75),
          Math.random() < 0.5 ? "#fff3b0" : "#ffffff", 6 + Math.random() * 5, 0.75, 0.92,
        );
      }
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
    const baseScale = img.scaleX;
    img.setScale(baseScale * 0.15); // 出現ポップインの開始値
    let aura: Phaser.GameObjects.Image | null = null;
    let auraS = 0;
    if (kind === "elite" || kind === "boss") {
      aura = s.add.image(x, y, "tex-ring")
        .setDepth(19)
        .setTint(kind === "boss" ? 0xc58aff : 0xffd94d)
        .setAlpha(0.65);
      aura.setDisplaySize(size * 1.5, size * 1.5);
      auraS = aura.scaleX;
    }
    const e: EnemyE = {
      img, eid: s.nextId++, kind,
      hp: base.hp * scale, maxHp: base.hp * scale,
      spd: base.spd * spdScale * (0.9 + Math.random() * 0.2),
      dmg: base.dmg, r: base.r, xp: base.xp, score: base.score,
      flashT: 0, orbitHitAt: 0, age: 0, action: 2 + Math.random() * 3,
      aim: 0, stage: 1, seed: Math.random() * 10, dead: false,
      frame: 0, baseScale, fxT: Math.random() * 0.1, aura, auraS,
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
        // マズルフラッシュ
        s.particlePool.spawnOne(
          s.px + Math.cos(baseAng) * 27, s.py + Math.sin(baseAng) * 27,
          Math.cos(baseAng) * 42, Math.sin(baseAng) * 42, "#fff3b0", 14, 0.09,
        );
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
        blade.setVisible(true).setPosition(bx, by).setRotation(s.gtime * 11 + i * 1.7);
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
          const obj = s.missileFree.pop() ?? s.add.image(0, 0, "missile").setDisplaySize(32, 32).setDepth(26);
          obj.setPosition(s.px, s.py).setVisible(true).setActive(true);
          s.missiles.push({ obj, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, targetId: e.eid, dmg: 24 + 9 * w.missile, life: 3.5, trailT: 0, dead: false });
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
          // 稲妻はギザギザの多段ポリラインにする
          const pts: { x: number; y: number }[] = [{ x: e.img.x + (Math.random() - 0.5) * 34, y: e.img.y - 200 }];
          for (let j = 1; j <= 4; j++) {
            pts.push({
              x: e.img.x + (Math.random() - 0.5) * 40 * (1 - j / 6),
              y: e.img.y - 200 + (200 * j) / 5,
            });
          }
          pts.push({ x: e.img.x, y: e.img.y });
          s.bolts.push({ pts, ttl: 0.16, seed: Math.random() * 10 });
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
        m.obj.setRotation(Math.atan2(m.vy, m.vx));
        // 炎の軌跡
        m.trailT -= dt;
        if (m.trailT <= 0) {
          m.trailT = 0.03;
          const ba = Math.atan2(m.vy, m.vx) + Math.PI;
          s.particlePool.spawnOne(
            m.obj.x + Math.cos(ba) * 15, m.obj.y + Math.sin(ba) * 15,
            Math.cos(ba) * 34, Math.sin(ba) * 34,
            Math.random() < 0.5 ? "#ff9f43" : "#ffd23f", 8, 0.22, 0.85,
          );
        }
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
        e.aura?.destroy();
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
      // ---- 見た目の生命感（羽ばたき・ポップイン・脈動・オーラ・土煙） ----
      if (e.kind === "crow" || e.kind === "bat" || e.kind === "elite") {
        e.img.setRotation(Math.sin(s.gtime * 9 + e.seed * 7) * 0.12);
      } else if (e.kind === "boss") {
        e.img.setRotation(Math.sin(s.gtime * 2.2) * 0.08);
      } else if (e.kind === "bee") {
        e.img.setRotation(Math.sin(s.gtime * 16 + e.seed * 9) * 0.1);
      }
      // 羽ばたきフレーム差し替え（変わった時だけ setTexture）
      if (e.kind === "crow" || e.kind === "bat") {
        const fr = Math.floor(s.gtime * 10 + e.seed * 3) % 2;
        if (fr !== e.frame) {
          e.frame = fr;
          e.img.setTexture(fr === 1 ? `enemy-${e.kind}-f1` : `enemy-${e.kind}`);
        }
      } else if (e.kind === "bee") {
        const fr = Math.floor(s.gtime * 24 + e.seed * 5) % 2;
        if (fr !== e.frame) {
          e.frame = fr;
          e.img.setTexture(fr === 1 ? "enemy-bee-f1" : "enemy-bee");
        }
      }
      // スケール：出現ポップイン（easeOutBack）＋嵐雲の発雷前脈動
      const popT = Math.min(1, e.age / 0.22);
      const c1 = 1.70158;
      const popF = 1 + (c1 + 1) * Math.pow(popT - 1, 3) + c1 * Math.pow(popT - 1, 2);
      let pulseF = 1;
      if (e.kind === "cloud" && e.action > 0 && e.action < 1.05) {
        pulseF = 1 + 0.11 * Math.sin(s.gtime * 18 + e.seed * 6);
      }
      e.img.setScale(e.baseScale * (popT >= 1 ? 1 : Math.max(0.15, popF)) * pulseF);
      // オーラ追従（エリート/ボス）
      if (e.aura) {
        e.aura.setPosition(e.img.x, e.img.y);
        e.aura.setScale(e.auraS * (1 + 0.07 * Math.sin(s.gtime * 3 + e.seed * 4)));
        e.aura.setAlpha(0.5 + 0.22 * Math.sin(s.gtime * 3 + e.seed * 4));
      }
      // 演出パーティクル（イノシシ突進の土煙／嵐雲の帯電火花）
      e.fxT -= dt;
      if (e.fxT <= 0) {
        if (e.kind === "boar" && e.action <= 0 && e.action > -0.65) {
          e.fxT = 0.06;
          s.particlePool.spawnOne(
            e.img.x - Math.cos(e.aim) * e.r * 0.8, e.img.y - Math.sin(e.aim) * e.r * 0.8 + e.r * 0.45,
            -Math.cos(e.aim) * 26 + (Math.random() - 0.5) * 22, -18 - Math.random() * 16,
            "#cbb27f", 9 + Math.random() * 5, 0.42, 0.9,
          );
        } else if (e.kind === "cloud" && e.action > 0 && e.action < 1.05) {
          e.fxT = 0.09;
          s.particlePool.spawnOne(
            e.img.x + (Math.random() - 0.5) * e.r * 1.7, e.img.y + (Math.random() - 0.5) * e.r * 1.4,
            0, 12, "#ffe14d", 6, 0.24, 0.9,
          );
        } else {
          e.fxT = 0.05;
        }
      }
      // 接触ダメージ
      if (Math.hypot(s.px - e.img.x, s.py - e.img.y) < e.r + PLAYER_R && s.gtime >= s.invulnUntil) {
        s.hp -= e.dmg;
        s.hurtAnim = 1;
        s.invulnUntil = s.gtime + 0.6;
        s.cameras.main.shake(70, 0.0035);
        sfx.play("hurt");
        s.hurtVig.flash();
        s.hitstop.trigger(40);
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
        s.hurtAnim = 1;
        s.invulnUntil = s.gtime + 0.6;
        s.cameras.main.shake(70, 0.0035);
        sfx.play("hurt");
        s.hurtVig.flash();
        s.hitstop.trigger(40);
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
    let crit = false;
    if (Math.random() < 0.1 + s.weapons.critLv * 0.08) {
      crit = true;
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
    // スコアポップ（通常撃破は数が多いので、大物と会心撃破のみ）
    if (e.kind === "elite" || e.kind === "boss") {
      s.texts.spawn(e.img.x, e.img.y - e.r - 8, `+${e.score}`, "#ffd23f", 1.1);
    } else if (crit) {
      s.texts.spawn(e.img.x, e.img.y - e.r - 24, `+${e.score}`, "#fff6d0", 0.8);
    }
    // 残像フェード＋種別カラーの破片バースト
    s.spawnGhost(e);
    const burstColor =
      e.kind === "crow" || e.kind === "bat" || e.kind === "elite"
        ? "#dfe9f5"
        : e.kind === "bee"
          ? "#ffe9a8"
          : e.kind === "boar"
            ? "#caa27e"
            : "#aebdd1";
    s.particlePool.burst(e.img.x, e.img.y, burstColor, e.kind === "boss" ? 22 : 8, e.kind === "boss" ? 220 : 150, 3.6);
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
    this.gems.push({ img, v, vx, vy, seed: Math.random() * 10, dead: false });
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
      s.lvlAnim = 1;
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
    sfx.stopBgm();
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
      // ジェムのきらめき（回転＋脈動）
      g.img.setRotation(Math.sin(s.gtime * 2.6 + g.seed) * 0.35);
      g.img.setScale(1 + 0.13 * Math.sin(s.gtime * 4.2 + g.seed * 2));
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
    s.sparklePool.update(dt);
    s.texts.update(dt, 34);
    // 撃破残像のフェード
    for (let i = s.ghosts.length - 1; i >= 0; i--) {
      const gh = s.ghosts[i];
      gh.life += dt;
      const r = gh.life / 0.3;
      if (r >= 1) {
        gh.img.setActive(false).setVisible(false);
        s.ghostFree.push(gh.img);
        s.ghosts.splice(i, 1);
      } else {
        gh.img.setAlpha(0.8 * (1 - r));
        const base = gh.img.scaleX;
        gh.img.setScale(base * (1 + 0.35 * dt / 0.3));
      }
    }
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
      // フリッカーする3重描画（グロー→本体→白い芯）
      const ratio = Math.max(0, b.ttl / 0.16);
      const flick = 0.72 + 0.28 * Math.sin(s.gtime * 95 + b.seed * 8);
      const passes: [number, number, number][] = [
        [8, 0xffe14d, 0.3],
        [4, 0xffe14d, 0.9],
        [2, 0xffffff, 1],
      ];
      for (const [wdt, col, mul] of passes) {
        g.lineStyle(wdt, col, ratio * flick * mul);
        g.beginPath();
        g.moveTo(b.pts[0].x, b.pts[0].y);
        for (let j = 1; j < b.pts.length; j++) g.lineTo(b.pts[j].x, b.pts[j].y);
        g.strokePath();
      }
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
  return { game, api, destroy: () => { detach(); sfx.stopBgm("survivors"); game.destroy(true); } };
}
