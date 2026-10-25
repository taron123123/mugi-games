import type { Metadata } from "next";
import Link from "next/link";
import ReactionGame from "@/components/ReactionGame";

export const metadata: Metadata = {
  title: "反射神経テスト「合図でタップ」 | むぎゲームズ",
  description:
    "赤から緑に変わった瞬間にタップ！ 3回の平均タイムで反射神経を判定するミニゲーム。",
};

export default function ReactionPage() {
  return (
    <main className="container">
      <p className="back-link">
        <Link href="/">← ゲーム一覧にもどる</Link>
      </p>
      <h1 className="game-title">⚡ 反射神経テスト「合図でタップ」</h1>
      <p className="game-lead">
        赤い画面で待機、緑になった瞬間にタップ！ 人間の平均は250msくらいだそうです。
        あなたは何ms？
      </p>
      <ReactionGame />
      <section className="howto">
        <h2>📖 遊び方</h2>
        <ol>
          <li>「スタート」を押すと赤い画面になります。合図を待ってね。</li>
          <li>いつ緑になるかはランダム。緑になったら即タップ！</li>
          <li>緑の前にタップするとフライング。そのラウンドをやり直しです。</li>
          <li>3回計測して平均タイムでランク判定。目指せ平均180ms以下の「電光石火」！</li>
        </ol>
      </section>
    </main>
  );
}
