"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCount, hitCount } from "./counter";

/**
 * ゲームのプレイ回数カウンター。
 * registerPlay() は「1プレイの開始」ごとに1回だけ呼ぶこと。
 * 呼び出し側の状態遷移で二重カウントを防ぐ設計。
 */
export function usePlayCounter(slug: string) {
  const [count, setCount] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const hittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getCount(slug).then((v) => {
      if (!cancelled) {
        setCount(v);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const registerPlay = useCallback(async () => {
    if (hittingRef.current) return;
    hittingRef.current = true;
    try {
      const v = await hitCount(slug);
      if (v !== null) setCount(v);
    } finally {
      hittingRef.current = false;
    }
  }, [slug]);

  return { count, loaded, registerPlay };
}
