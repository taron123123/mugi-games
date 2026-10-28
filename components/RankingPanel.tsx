"use client";

import { useEffect, useState } from "react";
import { formatWhen } from "@/lib/records";
import { fetchBoard, peekLocalId, type RankingGame, type ScoreEntry } from "@/lib/ranking";

type Props = {
  game: RankingGame;
  /** 登録のたびに増える値。これが変わると再読み込みする */
  refreshKey: number;
};

const MEDALS = ["🥇", "🥈", "🥉"];

/** 「みんなのランキング」欄：Firestore の今週／通算 TOP10 */
export default function RankingPanel({ game, refreshKey }: Props) {
  const [scope, setScope] = useState<"week" | "all">("week");
  const [entries, setEntries] = useState<ScoreEntry[] | null | undefined>(undefined);
  const [myUid, setMyUid] = useState("");

  useEffect(() => {
    let cancelled = false;
    setEntries(undefined);
    void fetchBoard(game, scope).then((list) => {
      if (cancelled) return;
      setEntries(list);
      setMyUid(peekLocalId());
    });
    return () => {
      cancelled = true;
    };
  }, [game, scope, refreshKey]);

  return (
    <section className="ranking" aria-label="みんなのランキング">
      <h2>🏆 みんなのランキング</h2>
      <div className="ranking-tabs" role="tablist">
        {(
          [
            ["week", "今週"],
            ["all", "通算"],
          ] as const
        ).map(([s, label]) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={scope === s}
            className={`ranking-tab ${scope === s ? "active" : ""}`}
            onClick={() => setScope(s)}
          >
            {label}
          </button>
        ))}
      </div>
      {entries === undefined ? (
        <p className="ranking-empty">読み込み中…</p>
      ) : entries === null ? (
        <p className="ranking-empty">ランキングを読み込めませんでした</p>
      ) : entries.length === 0 ? (
        <p className="ranking-empty">まだ登録がありません。最初の記録を残そう！</p>
      ) : (
        <ol className="ranking-list">
          {entries.map((e, i) => (
            <li key={e.id} className={myUid && e.ownerUid === myUid ? "mine" : undefined}>
              <span className="ranking-rank">{MEDALS[i] ?? i + 1}</span>
              <span className="ranking-body">
                <span className="ranking-name">{e.name}</span>
                {e.meta && <span className="ranking-meta">{e.meta}</span>}
              </span>
              <span className="ranking-right">
                <span className="ranking-score">{e.score.toLocaleString()}点</span>
                {e.createdAt > 0 && <time>{formatWhen(e.createdAt)}</time>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
