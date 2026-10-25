"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FOLLOW_LINE, SITE_URL } from "@/lib/games";
import { usePlayCounter } from "@/lib/usePlayCounter";
import { pushHistory } from "@/lib/records";
import { sfx } from "@/lib/sfx";
import type {
  CardDef,
  SurvivorsApi,
  SurvivorsHud,
  SurvivorsPhase,
  SurvivorsResult,
} from "@/lib/phaser/survivors";
import PlayCountBadge from "./PlayCountBadge";
import RecordsPanel from "./RecordsPanel";
import ShareButton, { FollowLink } from "./ShareButton";
import MuteButton from "./MuteButton";

const SLUG = "survivors";
const HIST_KEY = "mugi-games:survivors:history";

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function SurvivorsGame() {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SurvivorsApi | null>(null);
  const [phase, setPhase] = useState<SurvivorsPhase>("idle");
  const [hud, setHud] = useState<SurvivorsHud | null>(null);
  const [cards, setCards] = useState<CardDef[]>([]);
  const [rerolled, setRerolled] = useState(false);
  const [result, setResult] = useState<SurvivorsResult | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { count, loaded, registerPlay } = usePlayCounter(SLUG);
  const registerPlayRef = useRef(registerPlay);
  registerPlayRef.current = registerPlay;

  useEffect(() => {
    let destroyed = false;
    let game: { destroy: (removeCanvas: boolean) => void } | null = null;
    (async () => {
      const mod = await import("@/lib/phaser/survivors");
      if (destroyed || !hostRef.current) return;
      const handle = mod.createSurvivorsGame(hostRef.current, {
        onPhase: (p) => setPhase(p),
        onHud: (h) => setHud(h),
        onLevelUp: (c, r) => {
          setCards(c);
          setRerolled(r);
        },
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
    ? `🌾『むぎサバイバーズ』で ${fmtTime(result.time)} 生き延びた！ 撃破${result.kills}・Lv${result.level}・スコア${result.score.toLocaleString()}点 でした⚔️ #むぎゲームズ ${SITE_URL}/games/survivors\n${FOLLOW_LINE}`
    : "";

  return (
    <>
      <div className="fs-stage">
        <div ref={hostRef} className="fs-host" />
        {/* 上部バー */}
        <div className="fs-topbar">
          <Link href="/" className="fs-back">← 一覧</Link>
          <span className="fs-title">⚔️ むぎサバイバーズ</span>
          <span className="toolbar-btns">
            {phase === "playing" && (
              <button type="button" className="icon-btn" aria-label="ポーズ" onClick={() => apiRef.current?.pause()}>⏸</button>
            )}
            {phase === "paused" && (
              <button type="button" className="icon-btn" aria-label="再開" onClick={() => apiRef.current?.resume()}>▶️</button>
            )}
            <MuteButton />
          </span>
        </div>
        {/* HUD */}
        {hud && phase !== "idle" && (
          <div className="fs-hud">
            <div className="fs-xpbar">
              <div className="fs-xpfill" style={{ width: `${hud.xpRatio * 100}%` }} />
              <span className="fs-xplabel">Lv {hud.level}</span>
            </div>
            <div className="fs-hudrow">
              <span className="fs-hpbar">
                <span
                  className={`fs-hpfill ${hud.hp / hud.maxHp < 0.3 ? "low" : ""}`}
                  style={{ width: `${Math.max(0, (hud.hp / hud.maxHp) * 100)}%` }}
                />
                <span className="fs-hptext">HP {hud.hp} / {hud.maxHp}</span>
              </span>
              <span className="fs-time">{fmtTime(hud.time)}</span>
              <span className="fs-kills">撃破 {hud.kills}</span>
            </div>
            {hud.bossRatio !== null && (
              <div className="fs-bossbar">
                <span className="fs-bosslabel">竜巻・第{hud.bossStage}形態</span>
                <div className="fs-bossfill" style={{ width: `${hud.bossRatio * 100}%` }} />
              </div>
            )}
            <div className="fs-chips">
              {hud.chips.map((c) => (
                <span key={c} className="fs-chip">{c}</span>
              ))}
            </div>
          </div>
        )}
        {/* オーバーレイ */}
        {phase === "idle" && (
          <div className="fs-overlay">
            <p className="overlay-title">⚔️ むぎサバイバーズ</p>
            <p>
              押し寄せる敵の群れから生き延びろ！ 攻撃は自動。
              <br />
              🌾を集めてレベルアップし、3つの強化から1つ選んでビルドを育てよう。
              <br />
              60秒ごとにエリート、3分でボスが出現！
            </p>
            <button type="button" className="big-btn" onClick={start}>▶ スタート</button>
            <PlayCountBadge count={count} loaded={loaded} />
          </div>
        )}
        {phase === "levelup" && (
          <div className="fs-overlay">
            <p className="overlay-title">🎉 レベルアップ！ 強化を1つ選ぼう</p>
            <div className="upgrade-cards">
              {cards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="upgrade-card"
                  onClick={() => apiRef.current?.chooseCard(c.id)}
                >
                  <span className="upgrade-icon">{c.icon}</span>
                  <span className="upgrade-name">{c.name}</span>
                  <span className="upgrade-desc">{c.desc}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="sub-btn"
              disabled={rerolled}
              onClick={() => apiRef.current?.reroll()}
            >
              {rerolled ? "引き直し済み" : "↻ 引き直し（このレベルで1回）"}
            </button>
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
              <p className="result-title">ゲームオーバー…！</p>
              <p className="result-main">生存時間 <strong>{fmtTime(result.time)}</strong></p>
              <p className="result-sub">撃破 {result.kills} ／ Lv {result.level} ／ スコア {result.score.toLocaleString()}点</p>
              <p className="result-sub">生存 {(Math.floor(result.time) * 5).toLocaleString()}点 ＋ 撃破 {result.killScore.toLocaleString()}点 ＋ レベル {((result.level - 1) * 150).toLocaleString()}点</p>
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
          PC：WASD／矢印キーで移動（攻撃は自動）｜ スマホ：画面ドラッグでバーチャルスティック ｜ P／Escでポーズ
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
