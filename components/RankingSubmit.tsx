"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  fetchBoard,
  loadPlayerName,
  savePlayerName,
  submitScore,
  type RankingGame,
} from "@/lib/ranking";

type Props = {
  game: RankingGame;
  score: number;
  meta: string;
  /** 現在の結果に対するブロックかどうか */
  active: boolean;
  onSubmitted?: () => void;
};

type Status = "idle" | "form" | "sending" | "done" | "error";

/** 結果画面のランキング登録ブロック */
export default function RankingSubmit({ game, score, meta, active, onSubmitted }: Props) {
  const key = `${game}:${score}:${meta}`;
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  // 同じ結果を 2 回送らない（StrictMode の二重実行・再レンダー対策）
  const sentKeyRef = useRef<string | null>(null);
  // 送信中に結果が差し替わったら古い応答を捨てる
  const currentKeyRef = useRef(key);
  currentKeyRef.current = key;
  const onSubmittedRef = useRef(onSubmitted);
  onSubmittedRef.current = onSubmitted;

  const send = async (playerName: string) => {
    const k = key;
    sentKeyRef.current = k;
    setStatus("sending");
    const res = await submitScore(game, playerName, score, meta);
    if (currentKeyRef.current !== k) return;
    if (!res) {
      setStatus("error");
      return;
    }
    onSubmittedRef.current?.();
    const [week, all] = await Promise.all([fetchBoard(game, "week"), fetchBoard(game, "all")]);
    if (currentKeyRef.current !== k) return;
    const wi = week?.findIndex((e) => e.id === res.id) ?? -1;
    const ai = all?.findIndex((e) => e.id === res.id) ?? -1;
    const parts: string[] = [];
    if (wi >= 0) parts.push(`今週${wi + 1}位`);
    if (ai >= 0) parts.push(`通算${ai + 1}位`);
    setMessage(parts.length > 0 ? `🏆 ${parts.join("／")}` : "🏆 ランキングに登録しました！");
    setStatus("done");
  };

  useEffect(() => {
    if (!active || sentKeyRef.current === key) return;
    setMessage("");
    const saved = loadPlayerName();
    if (saved) {
      void send(saved);
    } else {
      setName("");
      setStatus("form");
    }
    // send は毎レンダー作り直されるが、key が変わったときだけ動かせばよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || status === "sending") return;
    savePlayerName(trimmed);
    void send(loadPlayerName() || trimmed);
  };

  if (!active || status === "idle") return null;

  return (
    <div className="rank-box">
      {status === "form" && (
        <form className="rank-form" onSubmit={onSubmit}>
          <input
            className="rank-input"
            type="text"
            value={name}
            maxLength={12}
            placeholder="なまえ"
            aria-label="ランキングに表示する名前"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="rank-btn" disabled={!name.trim()}>
            🏆 ランキングに登録
          </button>
          <p className="rank-note">ランキングに表示される名前です。本名は入れないでね</p>
        </form>
      )}
      {status === "sending" && <p className="rank-status">ランキングに登録中…</p>}
      {status === "done" && <p className="rank-status done">{message}</p>}
      {status === "error" && (
        <p className="rank-status error">
          ランキング登録に失敗しました（通信環境を確認してね）
          <button
            type="button"
            className="rank-retry"
            onClick={() => {
              const n = loadPlayerName();
              if (n) void send(n);
              else setStatus("form");
            }}
          >
            再試行
          </button>
        </p>
      )}
    </div>
  );
}
