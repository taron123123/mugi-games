import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SITE_URL, THREADS_URL } from "@/lib/games";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "むぎゲームズ | むぎの本格ブラウザゲーム集",
  description:
    "水色ふわふわAIマスコット「むぎ」がご案内するブラウザゲーム集。サバイバルアクション「むぎサバイバーズ」、タワーディフェンス「麦畑防衛戦」、弾幕STG「むぎスカイ」の3本立て！",
  openGraph: {
    title: "むぎゲームズ",
    description: "むぎの本格ブラウザゲーム集🌾 サバイバーズ／タワーディフェンス／弾幕STGが遊び放題。",
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
            <Link href="/games/survivors">⚔️ サバイバーズ</Link>
            <Link href="/games/tower-defense">🏯 麦畑防衛戦</Link>
            <Link href="/games/sky-shooter">✈️ むぎスカイ</Link>
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
            {" / "}
            <a href={THREADS_URL} target="_blank" rel="noopener noreferrer">🧵 Threadsでフォロー</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
