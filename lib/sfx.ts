"use client";

/**
 * WebAudio による簡易シンセ効果音。
 * 音源ファイルなしで Oscillator / Noise からその場で合成する。
 * ミュート設定は localStorage に保存。
 */

export type SfxName =
  | "shoot"
  | "hit"
  | "boom"
  | "pickup"
  | "levelup"
  | "hurt"
  | "click"
  | "bomb"
  | "thunder"
  | "place"
  | "coin"
  | "freeze"
  | "gameover"
  | "clear";

const MUTE_KEY = "mugi-games:muted";

/** 同じ音を連打しすぎないための最小間隔 (ms) */
const THROTTLE: Partial<Record<SfxName, number>> = {
  shoot: 50,
  hit: 40,
  pickup: 45,
  coin: 60,
};

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastPlayed = new Map<SfxName, number>();
  muted = false;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.muted = window.localStorage.getItem(MUTE_KEY) === "1";
      } catch {
        this.muted = false;
      }
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  /** ユーザージェスチャ時に呼んで AudioContext を用意する */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    delay = 0,
  ) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    }
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, low = 400, high = 3000, delay = 0) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(high, t0);
    filter.frequency.exponentialRampToValueAtTime(low, t0 + dur);
    filter.Q.value = 0.8;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  play(name: SfxName) {
    if (this.muted) return;
    const now = performance.now();
    const throttle = THROTTLE[name] ?? 0;
    if (throttle > 0 && now - (this.lastPlayed.get(name) ?? 0) < throttle) return;
    this.lastPlayed.set(name, now);
    if (!this.ctx) return; // unlock 前は無音（エラーにしない）
    switch (name) {
      case "shoot":
        this.tone(720 + Math.random() * 120, 0.07, "square", 0.05, 240);
        break;
      case "hit":
        this.noise(0.05, 0.08, 900, 2600);
        break;
      case "boom":
        this.noise(0.32, 0.28, 120, 1600);
        this.tone(120, 0.3, "sine", 0.22, 40);
        break;
      case "pickup":
        this.tone(880, 0.06, "sine", 0.09);
        this.tone(1320, 0.09, "sine", 0.09, undefined, 0.05);
        break;
      case "levelup":
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone(f, 0.12, "triangle", 0.14, undefined, i * 0.07),
        );
        break;
      case "hurt":
        this.tone(220, 0.18, "sawtooth", 0.16, 70);
        this.noise(0.12, 0.1, 300, 900);
        break;
      case "click":
        this.tone(660, 0.05, "triangle", 0.1);
        break;
      case "bomb":
        this.noise(0.55, 0.4, 80, 2200);
        this.tone(90, 0.5, "sine", 0.3, 30);
        break;
      case "thunder":
        this.noise(0.22, 0.22, 500, 4000);
        this.tone(160, 0.2, "sawtooth", 0.1, 50);
        break;
      case "place":
        this.tone(440, 0.07, "triangle", 0.14);
        this.tone(587, 0.09, "triangle", 0.12, undefined, 0.05);
        break;
      case "coin":
        this.tone(988, 0.06, "square", 0.06);
        this.tone(1319, 0.12, "square", 0.06, undefined, 0.05);
        break;
      case "freeze":
        this.tone(1200, 0.12, "sine", 0.08, 500);
        break;
      case "gameover":
        [392, 330, 262, 196].forEach((f, i) =>
          this.tone(f, 0.22, "triangle", 0.14, undefined, i * 0.16),
        );
        break;
      case "clear":
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
          this.tone(f, 0.14, "triangle", 0.13, undefined, i * 0.08),
        );
        break;
    }
  }
}

export const sfx = new Sfx();
