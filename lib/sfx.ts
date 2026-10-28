"use client";

/**
 * WebAudio による簡易シンセ効果音。
 * 音源ファイルなしで Oscillator / Noise からその場で合成する。
 * ミュート設定は localStorage に保存。
 */

export type SfxName =
  | "graze1" | "graze2" | "graze3" | "graze4"
  | "critical"
  | "warning"
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
  | "clear"
  | "wavestart";

export type BgmTrack = "survivors" | "tower" | "sky";

const MUTE_KEY = "mugi-games:muted";

/** 同じ音を連打しすぎないための最小間隔 (ms) */
const THROTTLE: Partial<Record<SfxName, number>> = {
  critical: 90,
  warning: 1500,
  shoot: 50,
  hit: 40,
  pickup: 45,
  coin: 60,
};

// ================= BGM（16分音符ステップのループシーケンサ） =================

type BgmEnv = "pluck" | "pad";
type BgmDrum = "kick" | "snare" | "hat";

type BgmVoice =
  | { type: OscillatorType; vol: number; env: BgmEnv; lp?: number; notes: string }
  | { drum: BgmDrum; vol: number; hits: number[] };

type BgmSong = { bpm: number; vol: number; voices: BgmVoice[] };

type BgmEvent = { voice: number; midi: number; len: number };

const BAR = 16;
const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C#5" → MIDI 番号 */
function midiOf(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return 60;
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_PC[m[1]] + acc;
}

/** 和音（低い順の4音）を 1 小節ぶんのアルペジオ譜に展開する。order は和音内の添字、step は1音の長さ */
function arp(chords: string[], order: number[], step: number): string {
  return chords
    .map((c) => {
      const tones = c.split(" ");
      const out: string[] = [];
      for (let i = 0; i < BAR / step; i++) out.push(`${tones[order[i % order.length]]}:${step}`);
      return out.join(" ");
    })
    .join(" ");
}

/** ルート音を 1 小節ぶんのベース譜に展開する。pattern は [半音オフセット, 長さ] の並び（null は休符） */
function bassLine(roots: string[], pattern: [number | null, number][]): string {
  return roots
    .map((r) => {
      const base = midiOf(r);
      return pattern.map(([o, len]) => (o === null ? `.:${len}` : `${base + o}:${len}`)).join(" ");
    })
    .join(" ");
}

/** 1 小節内の打点を指定小節数ぶん並べる */
function hitsPerBar(steps: number[], bars = 8): number[] {
  const out: number[] = [];
  for (let b = 0; b < bars; b++) for (const s of steps) out.push(b * BAR + s);
  return out;
}

const BGM_SONGS: Record<BgmTrack, BgmSong> = {
  // むぎサバイバーズ：C メジャー・ペンタトニックの軽快なチップチューン
  survivors: {
    bpm: 140,
    vol: 0.5,
    voices: [
      {
        type: "square", vol: 0.055, env: "pluck",
        notes:
          "E5:2 G5:2 A5:2 G5:2 E5:2 D5:2 C5:4 " +
          "A4:2 C5:2 E5:4 D5:2 C5:2 A4:4 " +
          "C5:2 D5:2 E5:2 G5:2 A5:4 G5:2 E5:2 " +
          "D5:4 G4:2 A4:2 D5:6 .:2 " +
          "E5:2 G5:2 C6:4 A5:2 G5:2 E5:4 " +
          "A5:2 G5:2 E5:2 C5:2 D5:4 E5:4 " +
          "C5:2 E5:2 G5:2 A5:2 C6:4 A5:4 " +
          "G5:4 D5:2 E5:2 D5:4 .:4",
      },
      {
        type: "square", vol: 0.022, env: "pluck",
        notes: arp(
          ["C4 E4 G4 C5", "A3 C4 E4 A4", "F3 A3 C4 F4", "G3 B3 D4 G4", "C4 E4 G4 C5", "A3 C4 E4 A4", "F3 A3 C4 F4", "G3 B3 D4 G4"],
          [0, 1, 2, 3, 2, 1, 2, 1],
          1,
        ),
      },
      {
        type: "triangle", vol: 0.13, env: "pluck",
        notes: bassLine(["C3", "A2", "F2", "G2", "C3", "A2", "F2", "G2"], [[0, 2], [12, 2], [0, 2], [12, 2], [0, 2], [12, 2], [7, 2], [12, 2]]),
      },
      { drum: "kick", vol: 0.16, hits: hitsPerBar([0, 8, 10]) },
      { drum: "snare", vol: 0.05, hits: hitsPerBar([4, 12]) },
      { drum: "hat", vol: 0.025, hits: hitsPerBar([2, 6, 10, 14]) },
    ],
  },
  // 麦畑防衛戦：都節音階（E F A B C）の牧歌的だが張り詰めた和風
  tower: {
    bpm: 100,
    vol: 0.55,
    voices: [
      {
        type: "sine", vol: 0.075, env: "pad",
        notes:
          "B4:4 C5:2 B4:2 A4:4 F4:2 E4:2 " +
          "E4:6 .:2 F4:2 A4:2 B4:4 " +
          "C5:4 B4:2 A4:2 E5:6 C5:2 " +
          "B4:8 A4:2 B4:2 F4:4 " +
          "E5:4 F5:2 E5:2 C5:4 B4:4 " +
          "A4:4 C5:2 B4:2 A4:2 F4:2 E4:4 " +
          "F4:2 A4:2 C5:4 B4:2 A4:2 F4:4 " +
          "E4:10 .:6",
      },
      {
        // 琴風のつま弾き
        type: "triangle", vol: 0.05, env: "pluck",
        notes: arp(
          ["E4 B4 E5 F5", "E4 B4 C5 E5", "A3 E4 A4 C5", "B3 F4 B4 E5", "C4 E4 A4 E5", "A3 C4 E4 A4", "F4 A4 C5 E5", "B3 E4 F4 B4"],
          [0, 1, 2, 1, 3, 2, 1, 2],
          2,
        ),
      },
      {
        type: "triangle", vol: 0.12, env: "pad",
        notes: bassLine(["E3", "E3", "A2", "B2", "C3", "A2", "F2", "B2"], [[0, 7], [null, 1], [0, 4], [12, 4]]),
      },
      { drum: "kick", vol: 0.14, hits: hitsPerBar([0, 10]) },
      { drum: "hat", vol: 0.018, hits: hitsPerBar([4, 12]) },
    ],
  },
  // むぎスカイ：A マイナーの疾走シンセ（8分ベース＋16分アルペジオ）
  sky: {
    bpm: 150,
    vol: 0.36,
    voices: [
      {
        type: "sawtooth", vol: 0.05, env: "pluck", lp: 2600,
        notes:
          "E5:3 A5:3 C6:2 B5:2 A5:2 E5:4 " +
          "F5:3 A5:3 C6:2 A5:4 F5:4 " +
          "G5:3 E5:3 C5:2 E5:2 G5:2 C6:4 " +
          "B5:4 A5:2 G5:2 D5:8 " +
          "E5:3 A5:3 C6:2 E6:4 D6:2 C6:2 " +
          "C6:3 A5:3 F5:2 A5:2 C6:2 F6:4 " +
          "D6:3 B5:3 G5:2 B5:2 D6:2 B5:4 " +
          "G#5:4 B5:4 E5:8",
      },
      {
        type: "square", vol: 0.02, env: "pluck",
        notes: arp(
          ["A4 C5 E5 A5", "F4 A4 C5 F5", "G4 C5 E5 G5", "G4 B4 D5 G5", "A4 C5 E5 A5", "F4 A4 C5 F5", "G4 B4 D5 G5", "G#4 B4 E5 G#5"],
          [0, 1, 2, 3, 2, 1, 2, 1],
          1,
        ),
      },
      {
        type: "sawtooth", vol: 0.11, env: "pluck", lp: 900,
        notes: bassLine(["A2", "F2", "C3", "G2", "A2", "F2", "G2", "E2"], [[0, 2], [12, 2], [0, 2], [12, 2], [0, 2], [12, 2], [0, 2], [12, 2]]),
      },
      { drum: "kick", vol: 0.17, hits: hitsPerBar([0, 4, 8, 12]) },
      { drum: "snare", vol: 0.06, hits: hitsPerBar([4, 12]) },
      { drum: "hat", vol: 0.022, hits: hitsPerBar([2, 6, 10, 14]) },
    ],
  },
};

/** 譜面文字列を「ステップ → 発音イベント列」に展開する（ループ長は最長の声部に合わせる） */
function compileSong(song: BgmSong): BgmEvent[][] {
  const lists: { step: number; ev: BgmEvent }[] = [];
  let total = BAR;
  song.voices.forEach((v, vi) => {
    if ("drum" in v) {
      for (const h of v.hits) lists.push({ step: h, ev: { voice: vi, midi: 0, len: 1 } });
      return;
    }
    let step = 0;
    for (const tok of v.notes.split(/\s+/)) {
      if (!tok) continue;
      const [n, l] = tok.split(":");
      const len = Number(l) || 1;
      if (n !== ".") {
        const midi = /^\d+$/.test(n) ? Number(n) : midiOf(n);
        lists.push({ step, ev: { voice: vi, midi, len } });
      }
      step += len;
    }
    total = Math.max(total, step);
  });
  total = Math.ceil(total / BAR) * BAR;
  const steps: BgmEvent[][] = Array.from({ length: total }, () => []);
  for (const { step, ev } of lists) steps[step % total].push(ev);
  return steps;
}

/** スケジューラの起床間隔 (ms) と先読み幅 (秒) */
const BGM_TICK_MS = 30;
const BGM_LOOKAHEAD = 0.12;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastPlayed = new Map<SfxName, number>();
  private noiseBuf: AudioBuffer | null = null;
  private bgmTrack: BgmTrack | null = null;
  private bgmGain: GainNode | null = null;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private bgmSteps: BgmEvent[][] = [];
  private bgmStep = 0;
  private bgmNext = 0;
  private bgmCache = new Map<BgmTrack, BgmEvent[][]>();
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
    // BGM はミュートで止め、曲指定は残しておいて解除時に頭から再開する
    if (m) this.haltBgm();
    else this.runBgm();
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
    this.runBgm();
  }

  /** BGM を開始する（同じ曲が再生中なら何もしない）。unlock 前・ミュート中は曲だけ覚えておく */
  startBgm(track: BgmTrack) {
    if (this.bgmTrack === track && this.bgmTimer) return;
    this.haltBgm();
    this.bgmTrack = track;
    this.runBgm();
  }

  /** BGM を止める。track 指定時はその曲が鳴っている場合だけ止める */
  stopBgm(track?: BgmTrack) {
    if (track && this.bgmTrack !== track) return;
    this.bgmTrack = null;
    this.haltBgm();
  }

  private runBgm() {
    if (this.bgmTimer || !this.bgmTrack || this.muted || !this.ctx || !this.master) return;
    const track = this.bgmTrack;
    let steps = this.bgmCache.get(track);
    if (!steps) {
      steps = compileSong(BGM_SONGS[track]);
      this.bgmCache.set(track, steps);
    }
    this.bgmSteps = steps;
    this.bgmStep = 0;
    this.bgmNext = 0;
    const gain = this.ctx.createGain();
    const t0 = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(BGM_SONGS[track].vol, t0 + 0.4);
    gain.connect(this.master);
    this.bgmGain = gain;
    this.bgmTimer = setInterval(() => this.scheduleBgm(), BGM_TICK_MS);
    this.scheduleBgm();
  }

  /** 再生だけ止める（曲指定は保持） */
  private haltBgm() {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    const gain = this.bgmGain;
    this.bgmGain = null;
    if (!gain || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t0);
    gain.gain.setValueAtTime(gain.gain.value, t0);
    gain.gain.linearRampToValueAtTime(0, t0 + 0.15);
    setTimeout(() => gain.disconnect(), 400);
  }

  private scheduleBgm() {
    const ctx = this.ctx;
    const gain = this.bgmGain;
    if (!ctx || !gain || !this.bgmTrack) return;
    const now = ctx.currentTime;
    // 停止中・タブ非表示中（タイマーが間引かれる）は予約せず、戻ったら現在時刻から拍を取り直す
    if (ctx.state !== "running" || (typeof document !== "undefined" && document.hidden)) {
      this.bgmNext = 0;
      return;
    }
    if (this.bgmNext < now) this.bgmNext = now + 0.05;
    const song = BGM_SONGS[this.bgmTrack];
    const stepDur = 60 / song.bpm / 4;
    while (this.bgmNext < now + BGM_LOOKAHEAD) {
      for (const ev of this.bgmSteps[this.bgmStep]) {
        this.bgmVoice(song.voices[ev.voice], ev, this.bgmNext, ev.len * stepDur, gain);
      }
      this.bgmNext += stepDur;
      this.bgmStep = (this.bgmStep + 1) % this.bgmSteps.length;
    }
  }

  private bgmVoice(v: BgmVoice, ev: BgmEvent, t: number, dur: number, out: GainNode) {
    const ctx = this.ctx;
    if (!ctx) return;
    if ("drum" in v) {
      this.bgmDrum(v.drum, v.vol, t, out);
      return;
    }
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = v.type;
    osc.frequency.setValueAtTime(440 * Math.pow(2, (ev.midi - 69) / 12), t);
    if (v.env === "pad") {
      // 柔らかい立ち上がり＋保持＋短いリリース（旋律・持続ベース向け）
      const rel = Math.min(0.12, dur * 0.4);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v.vol, t + 0.03);
      g.gain.linearRampToValueAtTime(v.vol * 0.85, t + Math.max(0.04, dur - rel));
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
    } else {
      // つま弾き：すぐ立ち上がって音価いっぱいで減衰
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v.vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.05, dur * 0.95));
    }
    if (v.lp) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = v.lp;
      osc.connect(f).connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private bgmDrum(kind: BgmDrum, vol: number, t: number, out: GainNode) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (kind === "kick") {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.16);
      return;
    }
    if (!this.noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 0.25);
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const dur = kind === "hat" ? 0.04 : 0.12;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = kind === "hat" ? "highpass" : "bandpass";
    f.frequency.value = kind === "hat" ? 7000 : 1800;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
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
      case "graze1": case "graze2": case "graze3": case "graze4": {
        const pitch = 850 + (Number(name.slice(-1)) - 1) * 260;
        this.tone(pitch, 0.065, "sine", 0.065, pitch * 1.5);
        break;
      }
      case "critical":
        this.tone(1450, 0.09, "triangle", 0.1, 2300);
        this.tone(2100, 0.06, "sine", 0.07, undefined, 0.035);
        break;
      case "warning":
        this.tone(180, 0.16, "sine", 0.16, 110);
        this.tone(180, 0.16, "sine", 0.12, 110, 0.23);
        break;
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
      case "wavestart":
        this.tone(587, 0.09, "triangle", 0.13);
        this.tone(880, 0.22, "triangle", 0.14, undefined, 0.09);
        this.tone(1760, 0.16, "sine", 0.04, undefined, 0.09);
        break;
    }
  }
}

export const sfx = new Sfx();
