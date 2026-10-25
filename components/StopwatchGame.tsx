"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SITE_URL } from "@/lib/games";
import { usePlayCounter } from "@/lib/usePlayCounter";
import { formatCount } from "@/lib/counter";
import { loadNumber, pushHistory, saveNumber } from "@/lib/records";
import PlayCountBadge from "./PlayCountBadge";
import RecordsPanel from "./RecordsPanel";
import ShareButton from "./ShareButton";

const SLUG = "stopwatch";
const HIST_KEY = "mugi-games:stopwatch:history";

type Mode = "normal" | "daily";
type Phase = "idle" | "running" | "done";

function randomTarget(): number {
  return Math.round(3000 + Math.random() * 6999); // 3000..9999 ms
}

function dateKeyLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** 日付から決定的に目標タイムを導出（全員共通） */
function dailyTargetMs(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const frac = ((h >>> 0) % 100000) / 100000;
  return Math.round(3000 + frac * 6999);
}

function dailyBestKey(key: string): string {
  return `mugi-games:stopwatch:daily-best:${key}`;
}

function rankTitle(diff: number): string {
  if (diff <= 10) return "神の指！！👆✨";
  if (diff <= 30) return "ほぼ完璧！天才級🎯";
  if (diff <= 50) return "すごい！職人の勘🔥";
  if (diff <= 100) return "惜しい！あと少し😆";
  if (diff <= 200) return "いい線いってる👍";
  if (diff <= 500) return "むぎもびっくり😳";
  return "修行あるのみ…！💪";
}

export default function StopwatchGame() {
  const { count, loaded, registerPlay } = usePlayCounter(SLUG);
  const [mode, setMode] = useState<Mode>("normal");
  const [phase, setPhase] = useState<Phase>("idle");
  const [normalTarget, setNormalTarget] = useState<number>(() => randomTarget());
  const [displayMs, setDisplayMs] = useState(0);
  const [resultMs, setResultMs] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dailyBest, setDailyBest] = useState<number | null>(null);

  const startRef = useRef(0);
  const rafRef = useRef<number>(0);

  const todayKey = dateKeyLocal();
  const target = mode === "daily" ? dailyTargetMs(todayKey) : normalTarget;

  useEffect(() => {
    setDailyBest(loadNumber(dailyBestKey(dateKeyLocal())));
  }, [refreshKey]);

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => stopLoop, [stopLoop]);

  const switchMode = (m: Mode) => {
    stopLoop();
    setMode(m);
    setPhase("idle");
    setDisplayMs(0);
    setResultMs(null);
    if (m === "normal") setNormalTarget(randomTarget());
  };

  const start = () => {
    if (phase === "running") return;
    void registerPlay();
    setResultMs(null);
    setDisplayMs(0);
    setPhase("running");
    startRef.current = performance.now();
    const tick = () => {
      setDisplayMs(performance.now() - startRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (phase !== "running") return;
    stopLoop();
    const elapsed = performance.now() - startRef.current;
    setResultMs(elapsed);
    setPhase("done");
    const diff = Math.abs(Math.round(elapsed) - target);
    pushHistory(HIST_KEY, diff);
    if (mode === "daily") {
      const key = dailyBestKey(todayKey);
      const prev = loadNumber(key);
      if (prev === null || diff < prev) saveNumber(key, diff);
    }
    setRefreshKey((k) => k + 1);
  };

  const retry = () => {
    if (mode === "normal") setNormalTarget(randomTarget());
    setPhase("idle");
    setDisplayMs(0);
    setResultMs(null);
  };

  const diff =
    resultMs !== null ? Math.abs(Math.round(resultMs) - target) : null;

  const shareText =
    diff !== null
      ? mode === "daily"
        ? `今日（${todayKey}）のデイリーチャレンジ『ピッタリ止めろ！』で誤差 ${diff}ms でした🌾 #むぎゲームズ ${SITE_URL}/games/stopwatch`
        : `『ピッタリ止めろ！』で誤差 ${diff}ms でした🌾 #むぎゲームズ ${SITE_URL}/games/stopwatch`
      : "";

  return (
    <div className="game-box">
      <PlayCountBadge count={count} loaded={loaded} />

      <div className="mode-tabs" role="tablist" aria-label="モード切替">
        <button
          className={mode === "normal" ? "tab active" : "tab"}
          onClick={() => switchMode("normal")}
        >
          通常モード
        </button>
        <button
          className={mode === "daily" ? "tab active" : "tab"}
          onClick={() => switchMode("daily")}
        >
          📅 今日のチャレンジ
        </button>
      </div>

      <p className="sw-target">
        {mode === "daily" ? "今日の目標" : "目標"}：
        <strong>{(target / 1000).toFixed(3)} 秒</strong>
        {mode === "daily" && (
          <span className="sw-daily-note">（{todayKey}・全員同じ目標です）</span>
        )}
      </p>

      <div className="sw-display" aria-live="polite">
        {phase === "running" && displayMs >= 1000
          ? "？.？？？"
          : `${(displayMs / 1000).toFixed(3)}`}
        <span className="sw-unit">秒</span>
      </div>
      {phase === "running" && displayMs >= 1000 && (
        <p className="sw-hidden-note">表示は隠れたよ。勘を信じて止めてね🌾</p>
      )}

      {phase !== "done" ? (
        <div className="btn-row">
          {phase === "idle" && (
            <button className="big-btn" onClick={start}>
              ▶ スタート
            </button>
          )}
          {phase === "running" && (
            <button className="big-btn stop" onClick={stop}>
              ⏹ ストップ！
            </button>
          )}
        </div>
      ) : (
        <div className="result">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="result-mugi" src="/mugi.webp" alt="むぎ" width={96} height={96} />
          <p className="result-title">{diff !== null ? rankTitle(diff) : ""}</p>
          <p className="result-main">
            誤差 <strong>{diff}ms</strong>
          </p>
          <p className="result-sub">
            あなた：{((resultMs ?? 0) / 1000).toFixed(3)} 秒 ／ 目標：
            {(target / 1000).toFixed(3)} 秒
          </p>
          {mode === "daily" && (
            <p className="result-sub">
              今日のベスト誤差：
              {dailyBest !== null ? `${dailyBest}ms` : "—"}
            </p>
          )}
          <p className="result-plays">
            みんなのプレイ回数：{formatCount(count, loaded)} 回
          </p>
          <div className="btn-row">
            <button className="big-btn" onClick={start}>
              🔁 もう一回
            </button>
            <button className="sub-btn" onClick={retry}>
              {mode === "normal" ? "目標を変える" : "やめる"}
            </button>
            <ShareButton text={shareText} />
          </div>
        </div>
      )}

      <RecordsPanel
        storageKey={HIST_KEY}
        refreshKey={refreshKey}
        formatValue={(v) => `誤差 ${v}ms`}
        bestMode="min"
        extra={
          <p className="records-extra">
            📅 今日のチャレンジ ベスト誤差：
            {dailyBest !== null ? `${dailyBest}ms` : "まだ挑戦していません"}
          </p>
        }
      />
    </div>
  );
}
