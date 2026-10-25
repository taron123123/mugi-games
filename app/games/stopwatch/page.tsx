import type { Metadata } from "next";
import Link from "next/link";
import StopwatchGame from "@/components/StopwatchGame";

export const metadata: Metadata = {
  title: "ピッタリ止めろ！むぎのストップウォッチ | むぎゲームズ",
  description:
    "目標タイムでピッタリ止めるストップウォッチゲーム。1秒で表示が消えるから勘が頼り。今日のチャレンジ（全員共通の目標）も！",
};

export default function StopwatchPage() {
  return (
    <main className="container">
      <p className="back-link">
        <Link href="/">← ゲーム一覧にもどる</Link>
      </p>
      <h1 className="game-title">⏱️ ピッタリ止めろ！むぎのストップウォッチ</h1>
      <p className="game-lead">
        目標タイムでピッタリ止められるか？ スタートして1秒たつとタイマー表示が消えちゃいます。
        あとはあなたの勘だけが頼り！
      </p>
      <StopwatchGame />
      <section className="howto">
        <h2>📖 遊び方</h2>
        <ol>
          <li>目標タイム（3.000〜9.999秒）が表示されます。</li>
          <li>「スタート」を押すと計測開始。1秒たつと表示が「？.？？？」に隠れます。</li>
          <li>目標のタイミングだと思ったら「ストップ！」を押そう。</li>
          <li>誤差が小さいほど称号がすごくなります。目指せ誤差10ms以下の「神の指」！</li>
        </ol>
        <p>
          📅 「今日のチャレンジ」は、その日の日付から決まる全員共通の目標タイム。
          何回でも挑戦できて、その日のベスト誤差が記録されます。友だちと競ってみてね。
        </p>
      </section>
    </main>
  );
}
