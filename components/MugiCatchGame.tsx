"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SITE_URL } from "@/lib/games";
import { usePlayCounter } from "@/lib/usePlayCounter";
import { pushHistory } from "@/lib/records";
import PlayCountBadge from "./PlayCountBadge";
import RecordsPanel from "./RecordsPanel";
import ShareButton from "./ShareButton";

const SLUG = "mugi-catch";
const HIST_KEY = "mugi-games:catch:history";

const W = 720;
const H = 480;
const PLAYER_SIZE = 88;
const PLAYER_Y = H - PLAYER_SIZE - 14;
const GAME_SECONDS = 60;

type Item = { x: number; y: number; vy: number; type: "wheat" | "rock" };
type Phase = "idle" | "playing" | "done";

type Live = {
  playerX: number;
  targetX: number | null;
  keys: Set<string>;
  items: Item[];
  lastSpawn: number;
  startAt: number;
  lastTs: number;
  score: number;
  lives: number;
  flashUntil: number;
};

function freshLive(): Live {
  return {
    playerX: W / 2,
    targetX: null,
    keys: new Set(),
    items: [],
    lastSpawn: 0,
    startAt: 0,
    lastTs: 0,
    score: 0,
    lives: 3,
    flashUntil: 0,
  };
}

export default function MugiCatchGame() {
  const { count, loaded, registerPlay } = usePlayCounter(SLUG);
  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [timeLeft, setTimeLeft] = useState(GAME_SECONDS);
  const [refreshKey, setRefreshKey] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const liveRef = useRef<Live>(freshLive());
  const rafRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const img = new Image();
    img.src = "/mugi.webp";
    imgRef.current = img;
  }, []);

  const finish = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const s = liveRef.current.score;
    setPhase("done");
    pushHistory(HIST_KEY, s);
    setRefreshKey((k) => k + 1);
  }, []);

  const draw = useCallback((now: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const live = liveRef.current;

    // 空
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#bfeaff");
    grad.addColorStop(1, "#eaf9ff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // 地面
    ctx.fillStyle = "#9be15d";
    ctx.fillRect(0, H - 26, W, 26);
    ctx.fillStyle = "#7bc74a";
    ctx.fillRect(0, H - 26, W, 5);

    // アイテム
    ctx.font = "38px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const it of live.items) {
      ctx.fillText(it.type === "wheat" ? "🌾" : "🪨", it.x, it.y);
    }

    // むぎ
    const img = imgRef.current;
    const px = live.playerX - PLAYER_SIZE / 2;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, px, PLAYER_Y, PLAYER_SIZE, PLAYER_SIZE);
    } else {
      ctx.beginPath();
      ctx.arc(live.playerX, PLAYER_Y + PLAYER_SIZE / 2, PLAYER_SIZE / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#a5dcf5";
      ctx.fill();
    }

    // 岩に当たった瞬間のフラッシュ
    if (now < live.flashUntil) {
      ctx.fillStyle = "rgba(255, 60, 60, 0.25)";
      ctx.fillRect(0, 0, W, H);
    }
  }, []);

  const start = useCallback(() => {
    void registerPlay();
    const live = freshLive();
    live.startAt = performance.now();
    live.lastTs = live.startAt;
    live.lastSpawn = live.startAt;
    liveRef.current = live;
    setScore(0);
    setLives(3);
    setTimeLeft(GAME_SECONDS);
    setPhase("playing");

    const step = (now: number) => {
      const L = liveRef.current;
      const dt = Math.min(0.05, (now - L.lastTs) / 1000);
      L.lastTs = now;
      const elapsed = (now - L.startAt) / 1000;

      // 残り時間
      const remain = Math.max(0, GAME_SECONDS - elapsed);
      setTimeLeft(Math.ceil(remain));

      // スポーン（だんだん速く・頻繁に）
      const interval = Math.max(430, 880 - elapsed * 8);
      if (now - L.lastSpawn > interval) {
        L.lastSpawn = now;
        const type = Math.random() < 0.72 ? "wheat" : "rock";
        L.items.push({
          x: 30 + Math.random() * (W - 60),
          y: -24,
          vy: 150 + elapsed * 4.2 + Math.random() * 70,
          type,
        });
      }

      // むぎの移動
      const speed = 580;
      if (L.keys.has("ArrowLeft")) L.playerX -= speed * dt;
      if (L.keys.has("ArrowRight")) L.playerX += speed * dt;
      if (L.targetX !== null) {
        const diff = L.targetX - L.playerX;
        const move = 1600 * dt;
        L.playerX += Math.abs(diff) < move ? diff : Math.sign(diff) * move;
      }
      L.playerX = Math.max(PLAYER_SIZE / 2, Math.min(W - PLAYER_SIZE / 2, L.playerX));

      // アイテム落下と判定
      const kept: Item[] = [];
      for (const it of L.items) {
        it.y += it.vy * dt;
        const inCatchBand = it.y >= PLAYER_Y + 6 && it.y <= PLAYER_Y + PLAYER_SIZE;
        if (inCatchBand && Math.abs(it.x - L.playerX) <= 58) {
          if (it.type === "wheat") {
            L.score += 10;
            setScore(L.score);
          } else {
            L.lives -= 1;
            setLives(L.lives);
            L.flashUntil = now + 220;
            if (L.lives <= 0) {
              draw(now);
              finish();
              return;
            }
          }
          continue;
        }
        if (it.y <= H + 40) kept.push(it);
      }
      L.items = kept;

      draw(now);

      if (remain <= 0) {
        finish();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [draw, finish, registerPlay]);

  // キーボード操作
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        liveRef.current.keys.add(e.key);
        if (phaseRef.current === "playing") e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      liveRef.current.keys.delete(e.key);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    draw(performance.now());
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const handlePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    liveRef.current.targetX = ((e.clientX - rect.left) / rect.width) * W;
  };

  const shareText = `『むぎキャッチ』で ${score}点 でした🌾 #むぎゲームズ ${SITE_URL}/games/mugi-catch`;

  return (
    <div className="game-box">
      <PlayCountBadge count={count} loaded={loaded} />

      <div className="catch-hud">
        <span>🏆 スコア：<strong>{score}</strong></span>
        <span>❤️ ライフ：{"❤️".repeat(Math.max(0, lives))}{"🖤".repeat(Math.max(0, 3 - lives))}</span>
        <span>⏰ 残り：<strong>{timeLeft}</strong>秒</span>
      </div>

      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="catch-canvas"
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
        />
        {phase !== "playing" && (
          <div className="canvas-overlay">
            {phase === "idle" && (
              <>
                <p className="overlay-title">🌾 むぎキャッチ</p>
                <p>
                  落ちてくる麦🌾をキャッチ（+10点）。
                  <br />
                  岩🪨に当たるとライフが減るよ（3回まで）。
                </p>
                <button className="big-btn" onClick={start}>
                  ▶ ゲームスタート
                </button>
              </>
            )}
            {phase === "done" && (
              <div className="result in-overlay">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="result-mugi" src="/mugi.webp" alt="むぎ" width={96} height={96} />
                <p className="result-title">ゲーム終了！</p>
                <p className="result-main">
                  スコア <strong>{score}点</strong>
                </p>
                <div className="btn-row">
                  <button className="big-btn" onClick={start}>
                    🔁 もう一度
                  </button>
                  <ShareButton text={shareText} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <p className="catch-help">
        操作：マウス／指で移動、または ← → キー
      </p>

      <RecordsPanel
        storageKey={HIST_KEY}
        refreshKey={refreshKey}
        formatValue={(v) => `${v}点`}
        bestMode="max"
      />
    </div>
  );
}
