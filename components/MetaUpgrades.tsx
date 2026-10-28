"use client";

import { useEffect, useState } from "react";
import {
  EMPTY_META,
  META_MAX_LV,
  META_TRACKS,
  loadGrains,
  loadMetaLevels,
  nextCost,
  saveGrains,
  saveMetaLevels,
  spentTotal,
  type MetaLevels,
  type MetaTrackId,
} from "@/lib/meta";
import { sfx } from "@/lib/sfx";

/**
 * むぎサバイバーズの永続強化パネル。
 * ランで集めた「麦の粒」を使って恒常アップグレードを購入する（localStorage 保存）。
 */
export default function MetaUpgrades({ refreshKey }: { refreshKey: number }) {
  const [grains, setGrains] = useState(0);
  const [levels, setLevels] = useState<MetaLevels>({ ...EMPTY_META });
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setGrains(loadGrains());
    setLevels(loadMetaLevels());
    setConfirmReset(false);
  }, [refreshKey]);

  const buy = (id: MetaTrackId) => {
    const cost = nextCost(levels, id);
    if (cost === null || grains < cost) return;
    const next = { ...levels, [id]: levels[id] + 1 };
    saveGrains(grains - cost);
    saveMetaLevels(next);
    setGrains(grains - cost);
    setLevels(next);
    sfx.play("levelup");
  };

  const reset = () => {
    const refund = spentTotal(levels);
    if (refund <= 0) return;
    const next = { ...EMPTY_META };
    saveGrains(grains + refund);
    saveMetaLevels(next);
    setGrains(grains + refund);
    setLevels(next);
    setConfirmReset(false);
    sfx.play("click");
  };

  const spent = spentTotal(levels);

  return (
    <section className="meta-upgrades" aria-label="永続強化">
      <h2>🌾 永続強化（麦の粒でパワーアップ）</h2>
      <p className="meta-note">
        ランで集めた「麦の粒」で、ずっと効く強化が買えます（この端末に保存）。
        獲得：撃破2体で1粒 ＋ 生存15秒で1粒、ラン終了時に加算。強化は次のランから反映されます。
      </p>
      <p className="meta-grains">所持 🌾 <strong>{grains.toLocaleString()}</strong> 粒</p>
      <ul className="meta-list">
        {META_TRACKS.map((t) => {
          const lv = levels[t.id];
          const cost = nextCost(levels, t.id);
          const maxed = cost === null;
          return (
            <li key={t.id} className="meta-row">
              <span className="meta-icon">{t.icon}</span>
              <span className="meta-main">
                <span className="meta-name">
                  {t.name}
                  <span className="meta-pips" aria-label={`レベル ${lv} / ${META_MAX_LV}`}>
                    {"●".repeat(lv)}{"○".repeat(META_MAX_LV - lv)}
                  </span>
                </span>
                <span className="meta-effect">
                  {lv > 0 ? `現在：${t.effectLabel(lv)}` : "未強化"}（{t.perLv}）
                </span>
              </span>
              {maxed ? (
                <span className="meta-max">MAX</span>
              ) : (
                <button
                  type="button"
                  className="meta-buy"
                  disabled={grains < cost}
                  onClick={() => buy(t.id)}
                >
                  強化 🌾{cost}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {spent > 0 && (
        confirmReset ? (
          <p className="meta-reset">
            本当にリセットしますか？ 使った 🌾{spent.toLocaleString()} 粒は全部戻ります。
            <button type="button" className="sub-btn" onClick={reset}>リセットする</button>
            <button type="button" className="sub-btn" onClick={() => setConfirmReset(false)}>やめる</button>
          </p>
        ) : (
          <p className="meta-reset">
            強化を振り直したいときは
            <button type="button" className="sub-btn" onClick={() => setConfirmReset(true)}>♻️ リセット（全額返金）</button>
          </p>
        )
      )}
    </section>
  );
}
