"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

type FsDocument = Document & { webkitFullscreenElement?: Element | null };
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/**
 * ゲームステージ（.fs-stage）を全画面にするトグルボタン。
 * - 通常は Fullscreen API でステージ要素そのものを全画面化する（サイトヘッダーは映らない）。
 * - iPhone Safari など要素の全画面化が使えない環境では、ステージを
 *   position:fixed で画面いっぱいに広げる「最大化モード」にフォールバックする。
 * ボタン自体はステージ内のトップバーにあるため、全画面中も押せる（終了できる）。
 */
export default function FullscreenButton({
  targetRef,
}: {
  targetRef: RefObject<HTMLElement | null>;
}) {
  const [active, setActive] = useState(false);
  const maximizedRef = useRef(false);
  const wantRef = useRef(false);

  const nativeElement = () => {
    const d = document as FsDocument;
    return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
  };

  const applyMaximized = useCallback((on: boolean) => {
    const el = targetRef.current;
    maximizedRef.current = on;
    if (el) el.classList.toggle("fs-max", on);
    document.body.classList.toggle("fs-lock", on);
    setActive(on || !!nativeElement());
    // ステージのサイズ変化を Phaser 側（ResizeObserver）に確実に拾わせる
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }, [targetRef]);

  const sync = useCallback(() => {
    setActive(!!nativeElement() || maximizedRef.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && maximizedRef.current) applyMaximized(false);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
      document.removeEventListener("keydown", onKey);
      // アンマウント時に最大化クラスが残らないようにする
      if (maximizedRef.current) applyMaximized(false);
    };
  }, [sync, applyMaximized]);

  const toggle = async () => {
    // ネイティブ全画面中 → 終了
    if (nativeElement()) {
      wantRef.current = false;
      try {
        await document.exitFullscreen();
      } catch {
        /* ignore */
      }
      return;
    }
    // 最大化モード中 → 解除
    if (maximizedRef.current) {
      wantRef.current = false;
      applyMaximized(false);
      return;
    }
    // 入る
    wantRef.current = true;
    const el = targetRef.current as FsElement | null;
    const req = el?.requestFullscreen ?? el?.webkitRequestFullscreen;
    if (el && typeof req === "function") {
      try {
        const ret = req.call(el) as Promise<void> | undefined;
        if (ret && typeof ret.then === "function") {
          await ret;
          if (!nativeElement() && wantRef.current) applyMaximized(true);
          return;
        }
        // 戻り値が無い旧ブラウザ: 少し待って入っていなければ最大化に切替
        setTimeout(() => {
          if (!nativeElement() && wantRef.current && !maximizedRef.current) applyMaximized(true);
        }, 350);
        return;
      } catch {
        /* フォールバックへ */
      }
    }
    // Fullscreen API が使えない環境（iPhone Safari 等）
    if (wantRef.current) applyMaximized(true);
  };

  return (
    <button
      type="button"
      className="chip-btn"
      aria-pressed={active}
      onClick={() => void toggle()}
    >
      {active ? "⛶ もどす" : "⛶ 全画面"}
    </button>
  );
}
