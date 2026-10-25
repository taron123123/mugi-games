"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FOLLOW_LINE, SITE_URL } from "@/lib/games";
import { usePlayCounter } from "@/lib/usePlayCounter";
import { pushHistory } from "@/lib/records";
import { sfx } from "@/lib/sfx";
import type { TdApi, TdHud, TdInsets, TdPhase, TdTowerInfo } from "@/lib/phaser/towerDefense";
import {
  ENEMY_LABELS,
  TOWERS,
  TOWER_KINDS,
  waveName,
  waveQueue,
  type EKind,
  type TowerKind,
} from "@/lib/phaser/tdData";
import PlayCountBadge from "./PlayCountBadge";
import RecordsPanel from "./RecordsPanel";
import ShareButton, { FollowLink } from "./ShareButton";
import MuteButton from "./MuteButton";

const SLUG = "tower-defense";
const HIST_KEY = "mugi-games:td:history";

export default function TowerDefenseGame() {
  const hostRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<TdApi | null>(null);
  const insetsRef = useRef<TdInsets>({ top: 64, bottom: 190 });
  const kindRef = useRef<TowerKind>("scarecrow");
  const [phase, setPhase] = useState<TdPhase>("build");
  const [hud, setHud] = useState<TdHud>({ wheat: 180, baseHp: 20, wave: 0, waveActive: false, remain: 0 });
  const [selectedKind, setSelectedKind] = useState<TowerKind>("scarecrow");
  const [selTower, setSelTower] = useState<TdTowerInfo | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [result, setResult] = useState<{ wave: number; kills: number; score: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { count, loaded, registerPlay } = usePlayCounter(SLUG);
  const registerPlayRef = useRef(registerPlay);
  registerPlayRef.current = registerPlay;
  kindRef.current = selectedKind;

  useEffect(() => {
    let destroyed = false;
    let game: { destroy: (removeCanvas: boolean) => void } | null = null;
    (async () => {
      const mod = await import("@/lib/phaser/towerDefense");
      if (destroyed || !hostRef.current) return;
      const handle = mod.createTowerDefenseGame(
        hostRef.current,
        {
          onPhase: (p) => setPhase(p),
          onHud: (h) => setHud(h),
          onSelectTower: (info) => setSelTower(info),
          onGameOver: (r) => {
            setResult(r);
            pushHistory(HIST_KEY, r.score);
            setRefreshKey((k) => k + 1);
          },
          getSelectedKind: () => kindRef.current,
        },
        insetsRef.current,
      );
      apiRef.current = handle.api;
      game = { destroy: () => handle.destroy() };
    })();
    return () => {
      destroyed = true;
      apiRef.current = null;
      game?.destroy(true);
    };
  }, []);

  // 上下バーの実高さを測ってシーンへ伝える（グリッドがバーの下に潜らないように）
  useEffect(() => {
    const update = () => {
      const top = topRef.current?.offsetHeight ?? 64;
      const bottom = bottomRef.current?.offsetHeight ?? 190;
      if (insetsRef.current.top !== top || insetsRef.current.bottom !== bottom) {
        insetsRef.current.top = top;
        insetsRef.current.bottom = bottom;
        apiRef.current?.relayout();
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (topRef.current) ro.observe(topRef.current);
    if (bottomRef.current) ro.observe(bottomRef.current);
    return () => ro.disconnect();
  }, [phase, selTower]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) apiRef.current?.autoPause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const startGame = () => {
    sfx.unlock();
    sfx.play("click");
    setResult(null);
    setSelTower(null);
    void registerPlayRef.current();
    apiRef.current?.start();
  };
  const beginFromBuild = () => {
    sfx.unlock();
    sfx.play("click");
    setResult(null);
    void registerPlayRef.current();
    apiRef.current?.beginFromBuild();
  };

  const shareText = result
    ? `🏯『麦畑防衛戦』で WAVE ${result.wave} まで畑を守った！ 撃破${result.kills}・スコア${result.score.toLocaleString()}点 🌾 #むぎゲームズ ${SITE_URL}/games/tower-defense\n${FOLLOW_LINE}`
    : "";

  const nextWave = hud.wave + 1;
  const nextQueue = waveQueue(nextWave);

  return (
    <>
      <div className="fs-stage">
        <div ref={hostRef} className="fs-host" />
        {/* 上部バー：ステータス */}
        <div ref={topRef} className="fs-topbar tall">
          <Link href="/" className="fs-back">← 一覧</Link>
          <span className="fs-stats">
            <span>🌾 {hud.wheat}</span>
            <span>🏡 畑HP {hud.baseHp}</span>
            <span>🌊 WAVE {Math.max(1, hud.wave)}</span>
            <span className="fs-stats-sub">{hud.waveActive ? `敵のこり ${hud.remain}` : hud.wave >= 20 ? "ENDLESS" : "配置フェーズ"}</span>
          </span>
          <span className="toolbar-btns">
            <button
              type="button"
              className="chip-btn"
              onClick={() => {
                const n = speed === 1 ? 2 : 1;
                setSpeed(n);
                apiRef.current?.setSpeed(n);
              }}
            >
              ⏩ {speed}x
            </button>
            <button
              type="button"
              className={`chip-btn ${autoStart ? "on" : ""}`}
              onClick={() => {
                const n = !autoStart;
                setAutoStart(n);
                apiRef.current?.setAutoStart(n);
              }}
            >
              🔁 自動 {autoStart ? "ON" : "OFF"}
            </button>
            {phase === "playing" && (
              <button type="button" className="icon-btn" aria-label="ポーズ" onClick={() => apiRef.current?.pause()}>⏸</button>
            )}
            {phase === "paused" && (
              <button type="button" className="icon-btn" aria-label="再開" onClick={() => apiRef.current?.resume()}>▶️</button>
            )}
            <MuteButton />
          </span>
        </div>

        {/* 下部バー：タワー選択・予告・選択中タワー */}
        <div ref={bottomRef} className="fs-bottombar">
          <div className="fs-nextwave">
            <strong>次：WAVE {nextWave} · {waveName(nextWave)}</strong>
            {(Object.keys(ENEMY_LABELS) as EKind[]).map((kind) => {
              const n = nextQueue.filter((k) => k === kind).length;
              return n ? <span key={kind}>{ENEMY_LABELS[kind]} ×{n}</span> : null;
            })}
            {nextWave % 5 === 0 && <small>王様はHP半分で一度だけ加速！</small>}
          </div>
          <div className="td-panel fs-cards">
            {TOWER_KINDS.map((k) => {
              const d = TOWERS[k];
              const afford = hud.wheat >= d.cost;
              return (
                <button
                  key={k}
                  type="button"
                  className={`td-card ${selectedKind === k ? "selected" : ""} ${afford ? "" : "cant"}`}
                  onClick={() => {
                    setSelectedKind(k);
                    sfx.unlock();
                    sfx.play("click");
                  }}
                >
                  <span className="td-card-icon">{d.icon}</span>
                  <span className="td-card-name">{d.name}</span>
                  <span className="td-card-desc">{d.desc}</span>
                  <span className="td-card-cost">🌾 {d.cost}</span>
                </button>
              );
            })}
          </div>
          {phase === "playing" && !hud.waveActive && (
            <div className="fs-wavebtn">
              <button type="button" className="big-btn" onClick={() => apiRef.current?.startWave()}>
                🌊 次のウェーブ（WAVE {nextWave}）
              </button>
            </div>
          )}
          {selTower && (
            <div className="td-selected fs-sel">
              <span className="td-selected-name">
                {TOWERS[selTower.kind].icon} {TOWERS[selTower.kind].name} Lv{selTower.lv}
              </span>
              <span className="td-selected-stats">
                攻撃 {Math.round(selTower.dmg)} ／ 射程 {selTower.range.toFixed(1)} ／ 連射 {selTower.rate.toFixed(1)}/s
              </span>
              <span>{TOWERS[selTower.kind].desc}</span>
              {selTower.nextDmg !== null && (
                <span className="td-selected-stats">
                  強化後：攻撃 {selTower.dmg.toFixed(1)} → {selTower.nextDmg.toFixed(1)} ／
                  射程 {selTower.range.toFixed(1)} → {(selTower.nextRange ?? 0).toFixed(1)} ／
                  連射 {selTower.rate.toFixed(1)} → {(selTower.nextRate ?? 0).toFixed(1)}/s
                </span>
              )}
              {selTower.upgradeCost !== null ? (
                <button
                  type="button"
                  className="sub-btn"
                  disabled={hud.wheat < selTower.upgradeCost}
                  onClick={() => apiRef.current?.upgradeSelected()}
                >
                  ⬆️ 強化（🌾{selTower.upgradeCost}）
                </button>
              ) : (
                <span className="td-max">最大レベル</span>
              )}
              <button type="button" className="sub-btn danger" onClick={() => apiRef.current?.sellSelected()}>
                💰 売却（🌾{selTower.sellValue}）
              </button>
              <button type="button" className="sub-btn" onClick={() => apiRef.current?.closeSelection()}>✖ 閉じる</button>
            </div>
          )}
        </div>

        {/* オーバーレイ */}
        {phase === "build" && (
          <div className="fs-overlay bottom">
            <div className="build-card">
              <p className="overlay-title">🏯 麦畑防衛戦</p>
              <p>
                敵は左の入口🚪から畑🌾（下）を目指します。
                下のパネルでタワーを選び、草原をタップして配置しよう（経路には置けません）。
                準備ができたらスタート！ 5ウェーブごとにボス👹が出現します。
              </p>
              <button type="button" className="big-btn" onClick={beginFromBuild}>▶ ゲームスタート</button>
              <PlayCountBadge count={count} loaded={loaded} />
            </div>
          </div>
        )}
        {phase === "paused" && (
          <div className="fs-overlay">
            <p className="overlay-title">⏸ ポーズ中</p>
            <div className="btn-row">
              <button type="button" className="big-btn" onClick={() => apiRef.current?.resume()}>▶ つづける</button>
              <button type="button" className="sub-btn" onClick={startGame}>🔄 最初から</button>
            </div>
          </div>
        )}
        {phase === "over" && result && (
          <div className="fs-overlay">
            <div className="result in-overlay">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mugi.webp" alt="むぎ" width={84} height={84} className="result-mugi" />
              <p className="result-title">畑が陥ちた…！</p>
              <p className="result-main">到達 <strong>WAVE {result.wave}</strong></p>
              <p className="result-sub">撃破 {result.kills} ／ スコア {result.score.toLocaleString()}点</p>
              <div className="btn-row">
                <button type="button" className="big-btn" onClick={startGame}>🔄 もう一度</button>
                <ShareButton text={shareText} />
              </div>
              <FollowLink />
            </div>
          </div>
        )}
      </div>
      <div className="container">
        <p className="catch-help">
          タワーを選んで草原をタップで配置（経路には置けません）。置いたタワーをタップすると強化・売却できます。
        </p>
        <PlayCountBadge count={count} loaded={loaded} />
        <RecordsPanel
          storageKey={HIST_KEY}
          refreshKey={refreshKey}
          formatValue={(v) => `${v.toLocaleString()}点`}
          bestMode="max"
        />
      </div>
    </>
  );
}
