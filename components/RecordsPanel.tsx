"use client";

import { useEffect, useState, type ReactNode } from "react";
import { bestOf, formatWhen, loadHistory, type Rec } from "@/lib/records";

type Props = {
  storageKey: string;
  /** 記録が追加されるたびに増える値。これが変わると再読み込みする */
  refreshKey: number;
  /** 数値の表示形式 (例: (v) => `${v}ms`) */
  formatValue: (v: number) => string;
  /** ベストは小さい方が良いか大きい方が良いか */
  bestMode: "min" | "max";
  extra?: ReactNode;
};

/** 「自分の記録」欄：ベスト記録と直近5回の履歴（localStorage） */
export default function RecordsPanel({
  storageKey,
  refreshKey,
  formatValue,
  bestMode,
  extra,
}: Props) {
  const [recs, setRecs] = useState<Rec[]>([]);

  useEffect(() => {
    setRecs(loadHistory(storageKey));
  }, [storageKey, refreshKey]);

  const best = bestOf(recs, bestMode);
  const recent = [...recs].slice(-5).reverse();

  return (
    <section className="records" aria-label="自分の記録">
      <h2>📒 自分の記録</h2>
      {recs.length === 0 ? (
        <p className="records-empty">
          まだ記録がありません。プレイするとここに残ります（この端末に保存）。
        </p>
      ) : (
        <>
          <p className="records-best">
            ベスト記録：<strong>{best !== null ? formatValue(best) : "—"}</strong>
            <span className="records-count">（全{recs.length}回）</span>
          </p>
          <ul className="records-list">
            {recent.map((r, i) => (
              <li key={`${r.t}-${i}`}>
                <span>{formatValue(r.v)}</span>
                <time>{formatWhen(r.t)}</time>
              </li>
            ))}
          </ul>
        </>
      )}
      {extra}
    </section>
  );
}
