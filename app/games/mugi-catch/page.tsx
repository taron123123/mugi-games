import type { Metadata } from "next";
import Link from "next/link";
import MugiCatchGame from "@/components/MugiCatchGame";

export const metadata: Metadata = {
  title: "むぎキャッチ | むぎゲームズ",
  description:
    "落ちてくる麦🌾をキャッチして岩🪨をよける60秒スコアアタック。だんだん速くなるよ！",
};

export default function MugiCatchPage() {
  return (
    <main className="container">
      <p className="back-link">
        <Link href="/">← ゲーム一覧にもどる</Link>
      </p>
      <h1 className="game-title">🌾 むぎキャッチ</h1>
      <p className="game-lead">
        空から麦🌾と岩🪨が降ってくる！ むぎを動かして麦だけをキャッチしよう。
        時間がたつほど速くなるよ。
      </p>
      <MugiCatchGame />
      <section className="howto">
        <h2>📖 遊び方</h2>
        <ol>
          <li>「ゲームスタート」で開始。制限時間は60秒。</li>
          <li>むぎの移動：マウスを動かす／画面を指でなぞる／← → キー。</li>
          <li>麦🌾をキャッチすると +10点。</li>
          <li>岩🪨に当たるとライフが1つ減ります。3回当たるとゲームオーバー。</li>
          <li>麦を取り逃してもペナルティはないので、岩だけは絶対よけて！</li>
        </ol>
      </section>
    </main>
  );
}
