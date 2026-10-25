"use client";

import { THREADS_URL } from "@/lib/games";

export default function ShareButton({ text }: { text: string }) {
  const href = `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`;
  return (
    <a className="share-btn" href={href} target="_blank" rel="noopener noreferrer">
      🧵 Threadsでシェア
    </a>
  );
}

/** 結果画面などに添える小さなフォロー案内リンク */
export function FollowLink() {
  return (
    <p className="follow-line">
      <a className="follow-link" href={THREADS_URL} target="_blank" rel="noopener noreferrer">
        🧵 Threadsでフォロー：@solo.guild555
      </a>
    </p>
  );
}
