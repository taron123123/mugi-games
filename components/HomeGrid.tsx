"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GAMES } from "@/lib/games";
import { formatCount, getCount } from "@/lib/counter";

export default function HomeGrid() {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all(GAMES.map((g) => getCount(g.slug))).then((vals) => {
      if (cancelled) return;
      const rec: Record<string, number | null> = {};
      GAMES.forEach((g, i) => {
        rec[g.slug] = vals[i];
      });
      setCounts(rec);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const known = GAMES.map((g) => counts[g.slug]).filter(
    (v): v is number => typeof v === "number",
  );
  const total = known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;

  return (
    <>
      <p className="total-plays">
        🎮 全ゲーム合計プレイ回数：<strong>{formatCount(total, loaded)}</strong> 回
      </p>
      <div className="card-grid">
        {GAMES.map((g) => (
          <Link key={g.slug} href={`/games/${g.slug}`} className="game-card">
            <span className="card-emoji">{g.emoji}</span>
            <h2>{g.title}</h2>
            <p>{g.description}</p>
            <span className="card-tag">{g.tag}</span>
            <span className="card-count">
              プレイ回数：{formatCount(counts[g.slug] ?? null, loaded)} 回
            </span>
            <span className="card-play">▶ あそぶ</span>
          </Link>
        ))}
      </div>
    </>
  );
}
