"use client";

import { useState } from "react";
import { sfx } from "@/lib/sfx";

export default function MuteButton() {
  const [muted, setMuted] = useState(sfx.muted);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={muted ? "サウンドをオンにする" : "サウンドをミュートする"}
      onClick={() => {
        const next = !muted;
        sfx.setMuted(next);
        setMuted(next);
        if (!next) {
          sfx.unlock();
          sfx.play("click");
        }
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
