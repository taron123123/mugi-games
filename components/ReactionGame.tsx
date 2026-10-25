"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SITE_URL } from "@/lib/games";
import { usePlayCounter } from "@/lib/usePlayCounter";
import { pushHistory } from "@/lib/records";
import PlayCountBadge from "./PlayCountBadge";
import RecordsPanel from "./RecordsPanel";
import ShareButton from "./ShareButton";

const SLUG = "reaction";
const HIST_KEY = "mugi-games:reaction:history";
const TOTAL_ROUNDS = 3;

type Phase = "idle" | "waiting" | "ready" | "foul" | "roundResult" | "finished";

function rankTitle(avg: number): string {
  if (avg <= 180) return "電光石火⚡ 人間卒業レベル！";
  if (avg <= 230) return "プロゲーマー級🎮";
  if (avg <= 280) return "なかなか速い！🐆";
  if (avg <= 350) return "平均的！ふつうがいちばん🚶";
  if (avg <= 450) return "のんびり屋さん🦥";
  return "むぎと一緒に特訓しよう🌾";
}

export default function ReactionGame() {
  const { count, loaded, registerPlay } = usePlayCounter(SLUG);
  const [phase, setPhase] = useState<Phase>("idle");
  const [times, setTimes] = useState<number[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greenAtRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const beginWait = useCallback(() => {
    clearTimer();
    setPhase("waiting");
    const delay = 1200 + Math.random() * 3300;
    timeoutRef.current = setTimeout(() => {
      greenAtRef.current = performance.now();
      setPhase("ready");
    }, delay);
  }, [clearTimer]);

  const startSession = () => {
    void registerPlay();
    setTimes([]);
    beginWait();
  };

  const handleTap = () => {
    if (phase === "waiting") {
      clearTimer();
      setPhase("foul");
      return;
    }
    if (phase === "ready") {
      const ms = Math.round(performance.now() - greenAtRef.current);
      const next = [...times, ms];
      setTimes(next);
      if (next.length >= TOTAL_ROUNDS) {
        const avg = Math.round(next.reduce((a, b) => a + b, 0) / next.length);
        pushHistory(HIST_KEY, avg);
        setRefreshKey((k) => k + 1);
        setPhase("finished");
      } else {
        setPhase("roundResult");
      }
    }
  };

  const avg =
    times.length > 0
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : 0;

  const shareText =
    phase === "finished"
      ? `『合図でタップ』で平均 ${avg}ms でした🌾 #むぎゲームズ ${SITE_URL}/games/reaction`
      : "";

  const areaClass =
    phase === "ready"
      ? "tap-area ready"
      : phase === "waiting"
        ? "tap-area waiting"
        : "tap-area";

  return (
    <div className="game-box">
      <PlayCountBadge count={count} loaded={loaded} />

      <p className="round-info">
        ラウンド {Math.min(times.length + 1, TOTAL_ROUNDS)} / {TOTAL_ROUNDS}
        {times.length > 0 && (
          <span>　記録：{times.map((t) => `${t}ms`).join(" ・ ")}</span>
        )}
      </p>

      {phase === "idle" && (
        <div className="center-box">
          <p>
            赤い画面の間は待っててね。緑になったら、すかさずタップ！
            <br />
            早すぎるとフライングだよ。
          </p>
          <button className="big-btn" onClick={startSession}>
            ▶ スタート
          </button>
        </div>
      )}

      {(phase === "waiting" || phase === "ready") && (
        <div
          className={areaClass}
          onPointerDown={handleTap}
          role="button"
          aria-label="タップエリア"
        >
          {phase === "waiting" ? "🔴 合図を待って…" : "🟢 タップ！"}
        </div>
      )}

      {phase === "foul" && (
        <div className="center-box">
          <p className="foul-text">😱 フライング！ 早すぎるよ〜</p>
          <button className="big-btn" onClick={beginWait}>
            🔁 このラウンドをやり直す
          </button>
        </div>
      )}

      {phase === "roundResult" && (
        <div className="center-box">
          <p className="round-result">
            {times[times.length - 1]}ms！
          </p>
          <button className="big-btn" onClick={beginWait}>
            ▶ 次のラウンド
          </button>
        </div>
      )}

      {phase === "finished" && (
        <div className="result">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="result-mugi" src="/mugi.webp" alt="むぎ" width={96} height={96} />
          <p className="result-title">{rankTitle(avg)}</p>
          <p className="result-main">
            平均 <strong>{avg}ms</strong>
          </p>
          <p className="result-sub">
            内訳：{times.map((t) => `${t}ms`).join(" ・ ")}
          </p>
          <div className="btn-row">
            <button className="big-btn" onClick={startSession}>
              🔁 もう一度
            </button>
            <ShareButton text={shareText} />
          </div>
        </div>
      )}

      <RecordsPanel
        storageKey={HIST_KEY}
        refreshKey={refreshKey}
        formatValue={(v) => `平均 ${v}ms`}
        bestMode="min"
      />
    </div>
  );
}
