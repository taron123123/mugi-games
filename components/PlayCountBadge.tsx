"use client";

import { formatCount } from "@/lib/counter";

export default function PlayCountBadge({
  count,
  loaded,
}: {
  count: number | null;
  loaded: boolean;
}) {
  return (
    <p className="play-count">
      🎮 プレイ回数：<strong>{formatCount(count, loaded)}</strong> 回
    </p>
  );
}
