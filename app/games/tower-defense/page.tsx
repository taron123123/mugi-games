import type { Metadata } from "next";
import Link from "next/link";
import TowerDefenseGame from "@/components/TowerDefenseGame";

export const metadata: Metadata = {
  title: "麦畑防衛戦 | むぎゲームズ",
  description:
    "4種のタワーを配置・強化して麦畑を守るタワーディフェンス。ウェーブを乗り切り、ボスを倒し、何ウェーブまで耐えられる？",
};

export default function TowerDefensePage() {
  return (
    <main className="container">
      <p className="back-link">
        <Link href="/">← ゲーム一覧にもどる</Link>
      </p>
      <h1 className="game-title">🏯 麦畑防衛戦</h1>
      <p className="game-lead">
        敵の大行列が畑に迫る！ タワーを建てられるのは草原だけ。
        かかし砲台・連射スプリンクラー・氷結ファン・雷タワーを組み合わせ、強化と売却をやりくりして畑HPを守り抜こう。
      </p>
      <TowerDefenseGame />
      <section className="howto">
        <h2>📖 遊び方</h2>
        <ol>
          <li>上のパネルでタワーを選び、草原のマスをタップするとその場に配置できます（経路には置けません）。射程は円で表示されます。</li>
          <li>「ゲームスタート」で WAVE 1 が始まります。敵は左の入口から入って、道を進んで畑（下）を目指します。畑に着いた敵の分だけ畑HPが減り、0になるとゲームオーバー。</li>
          <li>敵を倒すと🌾（通貨）が増えます。ウェーブクリアでもボーナス。タワーは2段階まで強化でき、売却すると投資額の70%が戻ります。</li>
          <li>敵の種類：通常🐦／高速🦇／タンク🌩️（硬い）／群れ🐜（大量）／5ウェーブごとのボス👹。</li>
          <li>「次のウェーブ」ボタンで早出し、自動開始ONなら3秒後に自動で始まります。⏩ボタンで2倍速、ポーズも可能です。</li>
          <li>WAVE 20を超えるとエンドレス。敵はどんどん硬くなるので、どこまで耐えられるか挑戦！</li>
        </ol>
        <p>
          💡 コツ：氷結ファンで遅くした敵を、雷タワーやかかし砲台の範囲に長くとどめるのが強い組み合わせ。
          角の内側は射程が長く当たるお得なポジションです。
        </p>
      </section>
    </main>
  );
}
