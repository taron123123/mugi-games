"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FOLLOW_LINE, SITE_URL } from "@/lib/games";
import { usePlayCounter } from "@/lib/usePlayCounter";
import { pushHistory } from "@/lib/records";
import { sfx } from "@/lib/sfx";
import type { SkyApi, SkyHud, SkyPhase, SkyResult } from "@/lib/phaser/skyShooter";
import PlayCountBadge from "./PlayCountBadge";
import RecordsPanel from "./RecordsPanel";
import ShareButton, { FollowLink } from "./ShareButton";
import MuteButton from "./MuteButton";

const SLUG = "sky-shooter";
const HIST_KEY = "mugi-games:sky:history";

export default function SkyShooterGame() {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SkyApi | null>(null);
  const [phase, setPhase] = useState<SkyPhase>("idle");
  const [hud, setHud] = useState<SkyHud | null>(null);
  const [result, setResult] = useState<SkyResult | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { count, loaded, registerPlay } = usePlayCounter(SLUG);
  const registerPlayRef = useRef(registerPlay);
  registerPlayRef.current = registerPlay;

  useEffect(() => {
    let destroyed = false;
    let game: { destroy: (removeCanvas: boolean) => void } | null = null;
    (async () => {
      const mod = await import("@/lib/phaser/skyShooter");
      if (destroyed || !hostRef.current) return;
      const handle = mod.createSkyShooterGame(hostRef.current, {
        onPhase: (p) => setPhase(p),
        onHud: (h) => setHud(h),
        onGameOver: (r) => {
          setResult(r);
          pushHistory(HIST_KEY, r.score);
          setRefreshKey((k) => k + 1);
        },
      });
      apiRef.current = handle.api;
      game = { destroy: () => handle.destroy() };
    })();
    return () => {
      destroyed = true;
      apiRef.current = null;
      game?.destroy(true);
    };
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) apiRef.current?.autoPause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const start = () => {
    sfx.unlock();
    sfx.play("click");
    setResult(null);
    void registerPlayRef.current();
    apiRef.current?.start();
  };

  const shareText = result
    ? `✈️『むぎスカイ』で STAGE ${result.stage} 到達！ スコア${result.score.toLocaleString()}点・かすり${result.graze}回 でした🌾 #むぎゲームズ ${SITE_URL}/games/sky-shooter\n${FOLLOW_LINE}`
    : "";

  return (
    <>
      <div className="fs-stage">
        <div ref={hostRef} className="fs-host" />
        <div className="fs-topbar">
          <Link href="/" className="fs-back">← 一覧</Link>
          <span className="fs-title">✈️ むぎスカイ</span>
          <span className="toolbar-btns">
            {phase === "playing" && (
              <button type="button" className="chip-btn bomb" onClick={() => apiRef.current?.bomb()}>💣 ボム</button>
            )}
            {phase === "playing" && (
              <button type="button" className="icon-btn" aria-label="ポーズ" onClick={() => apiRef.current?.pause()}>⏸</button>
            )}
            {phase === "paused" && (
              <button type="button" className="icon-btn" aria-label="再開" onClick={() => apiRef.current?.resume()}>▶️</button>
            )}
            <MuteButton />
          </span>
        </div>
        {hud && phase !== "idle" && (
          <div className="fs-hud sky">
            <div className="fs-hudrow">
              <span className="fs-score">SCORE {hud.score.toLocaleString()}</span>
              <span className="fs-stage-label">STAGE {hud.stage}</span>
            </div>
            <div className="fs-hudrow sub">
              <span>×{hud.mult} かすり{hud.graze}</span>
              <span>💣×{hud.bombs} ❤️×{hud.lives}</span>
            </div>
            {hud.bossRatio !== null && (
              <div className="fs-bossbar">
                <span className="fs-bosslabel">嵐の要塞 / PHASE {hud.bossPhase + 1}</span>
                <div className="fs-bossfill" style={{ width: `${hud.bossRatio * 100}%` }} />
              </div>
            )}
            <div className="fs-chainbar">
              <span>
                {hud.chain} CHAIN ×{hud.chainMult} ｜ P{hud.power} ｜ {hud.shield ? "盾：1回吸収" : "盾なし"}
                {hud.invulnSec > 0 ? ` ｜ 無敵 ${hud.invulnSec.toFixed(1)}秒` : ""}
              </span>
              {hud.chain > 0 && (
                <div className="fs-chainfill" style={{ width: `${hud.chainRatio * 100}%` }} />
              )}
            </div>
          </div>
        )}
        {phase === "idle" && (
          <div className="fs-overlay">
            <p className="overlay-title">✈️ むぎスカイ</p>
            <p>
              むぎが飛行機で出撃！ ショットは自動。
              <br />
              かすりで最大×8。連続撃破と編隊全滅でボーナス！
              <br />
              🎈運搬機を落とすと P（火力）/ S（盾）/ B（ボム）。
              <br />
              ステージ終盤にはボス🌩️が待ち構える！
            </p>
            <button type="button" className="big-btn" onClick={start}>▶ 出撃！</button>
            <PlayCountBadge count={count} loaded={loaded} />
          </div>
        )}
        {phase === "paused" && (
          <div className="fs-overlay">
            <p className="overlay-title">⏸ ポーズ中</p>
            <div className="btn-row">
              <button type="button" className="big-btn" onClick={() => apiRef.current?.resume()}>▶ つづける</button>
              <button type="button" className="sub-btn" onClick={start}>🔄 最初から</button>
            </div>
          </div>
        )}
        {phase === "over" && result && (
          <div className="fs-overlay">
            <div className="result in-overlay">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mugi.webp" alt="むぎ" width={84} height={84} className="result-mugi" />
              <p className="result-title">撃墜されちゃった…！</p>
              <p className="result-main">スコア <strong>{result.score.toLocaleString()}</strong></p>
              <p className="result-sub">STAGE {result.stage} 到達 ／ かすり {result.graze}回</p>
              <div className="btn-row">
                <button type="button" className="big-btn" onClick={start}>🔄 もう一度</button>
                <ShareButton text={shareText} />
              </div>
              <FollowLink />
            </div>
          </div>
        )}
      </div>
      <div className="container">
        <p className="catch-help">
          PC：WASD／矢印キーで移動、Spaceでボム ｜ スマホ：ドラッグで移動（指の少し上に自機が出ます）、ボムはボタン
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
