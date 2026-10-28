import * as Phaser from "phaser";

/**
 * Phaser 3 共通基盤。
 * - ゲームサイズは親要素（全画面ステージ）の CSS サイズ × devicePixelRatio（上限2）、
 *   Scale Manager の zoom=1/DPR で CSS サイズに戻して表示する（網膜でも鮮明）
 * - リサイズは ResizeObserver で追従（attachDprResize）
 * - 描画は Graphics から生成したテクスチャ＋スプライトが基本
 */

export function dprCap(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(2, window.devicePixelRatio || 1);
}

export function baseGameConfig(
  parent: HTMLElement,
  scene: Phaser.Types.Scenes.SettingsConfig[],
): Phaser.Types.Core.GameConfig {
  const dpr = dprCap();
  const w = Math.max(320, parent.clientWidth || 960);
  const h = Math.max(320, parent.clientHeight || 600);
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#79b5d9",
    scale: {
      // Phaser 3 にはゲーム解像度（DPR）設定が無いので、
      // ゲームサイズ＝CSSサイズ×DPR、zoom＝1/DPR で網膜対応する。
      // リサイズ追従は attachDprResize が担うためモードは NONE。
      mode: Phaser.Scale.NONE,
      width: Math.round(w * dpr),
      height: Math.round(h * dpr),
      zoom: 1 / dpr,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    render: { antialias: true },
    disableContextMenu: true,
    banner: false,
    scene,
  };
}

/**
 * 親要素の CSS サイズ変化に追従してゲームサイズ（device px）を更新する。
 * 戻り値はデタッチ関数（Game 破棄時に呼ぶ）。
 */
export function attachDprResize(game: Phaser.Game, parent: HTMLElement): () => void {
  const apply = () => {
    const dpr = dprCap();
    const w = Math.round((parent.clientWidth || 0) * dpr);
    const h = Math.round((parent.clientHeight || 0) * dpr);
    if (w > 0 && h > 0 && (game.scale.width !== w || game.scale.height !== h)) {
      game.scale.setZoom(1 / dpr);
      game.scale.setGameSize(w, h);
    }
  };
  const ro = new ResizeObserver(apply);
  ro.observe(parent);
  window.addEventListener("orientationchange", apply);
  // 全画面の開始/終了直後はレイアウト確定が遅れることがあるので、少し遅らせても再適用する
  let fsTimer: ReturnType<typeof setTimeout> | null = null;
  const onFsChange = () => {
    requestAnimationFrame(apply);
    if (fsTimer) clearTimeout(fsTimer);
    fsTimer = setTimeout(apply, 300);
  };
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);
  return () => {
    ro.disconnect();
    window.removeEventListener("orientationchange", apply);
    document.removeEventListener("fullscreenchange", onFsChange);
    document.removeEventListener("webkitfullscreenchange", onFsChange);
    if (fsTimer) clearTimeout(fsTimer);
  };
}

/** Graphics で描いてテクスチャ化する（既にあれば何もしない） */
export function genTex(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (g: Phaser.GameObjects.Graphics) => void,
): void {
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics();
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** 白丸テクスチャ（パーティクルや●描画の汎用素材） */
export function ensureDot(scene: Phaser.Scene): void {
  genTex(scene, "tex-dot", 32, 32, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(16, 16, 15);
  });
}

/** 輪（ストローク円）テクスチャ */
export function ensureRing(scene: Phaser.Scene): void {
  genTex(scene, "tex-ring", 64, 64, (g) => {
    g.lineStyle(5, 0xffffff, 1);
    g.strokeCircle(32, 32, 28);
  });
}

/** スプライトの使い回しプール（Image版） */
export class ImagePool {
  private freeList: Phaser.GameObjects.Image[] = [];
  constructor(
    private scene: Phaser.Scene,
    private texture: string,
    private depth: number,
  ) {}
  obtain(): Phaser.GameObjects.Image {
    const img = this.freeList.pop() ?? this.scene.add.image(0, 0, this.texture);
    img.setTexture(this.texture);
    img.setDepth(this.depth);
    img.setActive(true).setVisible(true);
    img.setAlpha(1).setScale(1).setRotation(0).setTint(0xffffff);
    img.clearTint();
    return img;
  }
  release(img: Phaser.GameObjects.Image): void {
    img.setActive(false).setVisible(false);
    this.freeList.push(img);
  }
}

/** フローティングテキストのプール */
export class TextPool {
  private freeList: Phaser.GameObjects.Text[] = [];
  private items: { obj: Phaser.GameObjects.Text; life: number; maxLife: number }[] = [];
  constructor(
    private scene: Phaser.Scene,
    private depth: number,
    private fontSize = 20,
  ) {}
  spawn(x: number, y: number, text: string, color: string, maxLife = 0.85): void {
    const obj =
      this.freeList.pop() ??
      this.scene.add
        .text(0, 0, "", {
          fontFamily: "sans-serif",
          fontStyle: "bold",
          fontSize: `${this.fontSize}px`,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(this.depth);
    obj.setText(text);
    obj.setColor(color);
    obj.setPosition(x, y);
    obj.setAlpha(1);
    obj.setActive(true).setVisible(true);
    this.items.push({ obj, life: 0, maxLife });
  }
  update(dt: number, riseSpeed = 36): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life += dt;
      it.obj.y -= riseSpeed * dt;
      it.obj.setAlpha(Math.max(0, 1 - it.life / it.maxLife));
      if (it.life >= it.maxLife) {
        it.obj.setActive(false).setVisible(false);
        this.freeList.push(it.obj);
        this.items.splice(i, 1);
      }
    }
  }
  clear(): void {
    for (const it of this.items) {
      it.obj.setActive(false).setVisible(false);
      this.freeList.push(it.obj);
    }
    this.items = [];
  }
}

/** 色付きドットで爆発などを表現する軽量パーティクルプール */
export class ParticlePool {
  private items: {
    img: Phaser.GameObjects.Image;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    drag: number;
    grow: number;
  }[] = [];
  constructor(
    private pool: ImagePool,
    private max = 700,
  ) {}
  burst(
    x: number,
    y: number,
    colorHex: string,
    n: number,
    power = 140,
    size = 3.2,
  ): void {
    const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
    for (let i = 0; i < n && this.items.length < this.max; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 30 + Math.random() * power;
      const img = this.pool.obtain();
      img.setPosition(x, y);
      img.setTint(color);
      const sc = (size * (0.6 + Math.random() * 0.8)) / 16;
      img.setScale(sc);
      this.items.push({
        img,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0,
        maxLife: 0.32 + Math.random() * 0.3,
        drag: 0.12,
        grow: 0,
      });
    }
  }
  spawnOne(
    x: number,
    y: number,
    vx: number,
    vy: number,
    colorHex: string,
    sizePx: number,
    maxLife: number,
    dragPerSec = 0.12,
  ): void {
    if (this.items.length >= this.max) return;
    const img = this.pool.obtain();
    img.setPosition(x, y);
    img.setTint(Phaser.Display.Color.HexStringToColor(colorHex).color);
    img.setScale(sizePx / 32);
    this.items.push({ img, vx, vy, life: 0, maxLife, drag: dragPerSec, grow: 0 });
  }
  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.pool.release(p.img);
        this.items.splice(i, 1);
        continue;
      }
      const dragF = Math.pow(p.drag, dt);
      p.vx *= dragF;
      p.vy *= dragF;
      p.img.x += p.vx * dt;
      p.img.y += p.vy * dt;
      p.img.setAlpha(1 - p.life / p.maxLife);
    }
  }
  clear(): void {
    for (const p of this.items) this.pool.release(p.img);
    this.items = [];
  }
}

/**
 * ヒットストップ。残り停止時間を実時間 (ms) で持ち、停止中はゲームロジックを進めない。
 * Phaser の time/tweens は止めないので、UI やトゥイーン演出はそのまま動く。
 */
export class Hitstop {
  private remainMs = 0;
  /** 停止を要求する（停止中なら長い方を採用） */
  trigger(ms: number): void {
    this.remainMs = Math.max(this.remainMs, ms);
  }
  /** 毎フレームの実経過時間で呼ぶ。停止中なら true（このフレームの dt は 0 扱い） */
  tick(deltaMs: number): boolean {
    if (this.remainMs <= 0) return false;
    this.remainMs -= deltaMs;
    return true;
  }
  reset(): void {
    this.remainMs = 0;
  }
}

/** 画面端だけ赤く、中央は透明なラジアルグラデーション（被弾ヴィネット用） */
export function ensureHurtVignette(scene: Phaser.Scene): string {
  const key = "tex-hurt-vignette";
  if (scene.textures.exists(key)) return key;
  const S = 256;
  const tex = scene.textures.createCanvas(key, S, S);
  if (!tex) return key;
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.71);
  grad.addColorStop(0, "rgba(226,36,40,0)");
  grad.addColorStop(0.5, "rgba(226,36,40,0.3)");
  grad.addColorStop(1, "rgba(200,20,30,1)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  tex.refresh();
  return key;
}

/** 被弾時に画面端を赤く光らせてフェードアウトさせるオーバーレイ */
export class HurtVignette {
  readonly img: Phaser.GameObjects.Image;
  constructor(
    private scene: Phaser.Scene,
    depth: number,
  ) {
    this.img = scene.add
      .image(0, 0, ensureHurtVignette(scene))
      .setDepth(depth)
      .setAlpha(0)
      .setVisible(false);
  }
  /** 中心座標と表示サイズを合わせる（シーンのカメラ構成に応じて呼び出し側が算出） */
  layout(cx: number, cy: number, w: number, h: number): void {
    this.img.setPosition(cx, cy).setDisplaySize(w, h);
  }
  flash(alpha = 0.35, ms = 260): void {
    this.scene.tweens.killTweensOf(this.img);
    this.img.setVisible(true).setAlpha(alpha);
    this.scene.tweens.add({
      targets: this.img,
      alpha: 0,
      duration: ms,
      ease: "Quad.easeOut",
      onComplete: () => this.img.setVisible(false),
    });
  }
  clear(): void {
    this.scene.tweens.killTweensOf(this.img);
    this.img.setAlpha(0).setVisible(false);
  }
}

/** 角度差を -π..π に正規化して、最大旋回量で目標角へ寄せる */
export function turnToward(
  current: number,
  target: number,
  maxTurn: number,
): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + Math.max(-maxTurn, Math.min(maxTurn, diff));
}

/** 指数減衰で値を目標へ寄せる係数（フレームレート非依存） */
export function dampFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}
