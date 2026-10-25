import type { Metadata } from "next";
import Link from "next/link";
import SurvivorsGame from "@/components/SurvivorsGame";

export const metadata: Metadata = {
  title: "むぎサバイバーズ | むぎゲームズ",
  description:
    "群がる敵を自動攻撃で倒し、経験値で強化を選んで育てるサバイバルアクション。エリートとボスを乗り越えて、どこまで生き延びられる？",
};

export default function SurvivorsPage() {
  return (
    <main className="container">
      <p className="back-link">
        <Link href="/">← ゲーム一覧にもどる</Link>
      </p>
      <h1 className="game-title">⚔️ むぎサバイバーズ</h1>
      <p className="game-lead">
        麦畑に敵の大群が押し寄せてきた！ 攻撃は自動だから、あなたは移動と「育て方」に集中。
        経験値🌾を集めてレベルアップし、回転ガマ・追尾ミサイル・雷撃を解放して無双ビルドを組み立てよう。
      </p>
      <SurvivorsGame />
      <section className="howto">
        <h2>📖 遊び方</h2>
        <ol>
          <li>移動は WASD／矢印キー（スマホは画面ドラッグでバーチャルスティック）。攻撃はすべて自動です。</li>
          <li>敵を倒すと経験値🌾が落ちます。磁石範囲に入ると吸い寄せられ、集めるとレベルアップ！</li>
          <li>レベルアップ時はゲームが止まり、3つの強化から1つを選択。武器の解放とレベルアップ、移動速度や最大HPなど、選び方でビルドが変わります。</li>
          <li>時間とともに敵は増えて強くなります。60秒ごとにエリート🦅（倒すと回復アイテム）、3分でボス🌪️出現。以後もボスは繰り返し現れます。</li>
          <li>HPが0になったらゲームオーバー。生存時間・撃破数・レベルでスコアが決まります。</li>
        </ol>
        <p>
          💡 コツ：序盤は磁石範囲や連射を上げると経験値を回収しやすくなります。
         囲まれそうになったら、エリートの落とす回復❤️を温存しておくのも手です。
        </p>
      </section>
    </main>
  );
}
