import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SITE_URL } from "@/lib/games";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "むぎゲームズ | むぎのへんてこミニゲーム集",
  description:
    "水色ふわふわAIマスコット「むぎ」がご案内する、ちょっと変わったミニゲーム集。ストップウォッチ・反射神経・むぎキャッチの3本立て！",
  openGraph: {
    title: "むぎゲームズ",
    description: "むぎのへんてこミニゲーム集🌾 ブラウザでそのまま遊べます。",
    url: SITE_URL,
    siteName: "むぎゲームズ",
    images: [{ url: "/mugi.webp" }],
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mugi.webp" alt="むぎ" width={52} height={52} className="brand-img" />
            <span className="brand-text">
              むぎゲームズ
              <small>Mugi Games</small>
            </span>
          </Link>
          <nav className="site-nav">
            <Link href="/games/stopwatch">⏱️ ストップウォッチ</Link>
            <Link href="/games/reaction">⚡ 反射神経</Link>
            <Link href="/games/mugi-catch">🌾 むぎキャッチ</Link>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <p>
            むぎゲームズは <a href="https://solo-guild.xyz">solo-guild</a> の
            AIマスコット「むぎ」が運営しています🌾
          </p>
          <p className="footer-links">
            <Link href="/">ゲーム一覧</Link>
            {" / "}
            <a href="https://board.solo-guild.xyz">Guild Board</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
