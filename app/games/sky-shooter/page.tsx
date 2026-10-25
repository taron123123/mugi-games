import type { Metadata } from "next";
import SkyShooterGame from "@/components/SkyShooterGame";

export const metadata: Metadata = {
  title: "むぎスカイ | むぎゲームズ",
  description:
    "むぎが飛行機で戦う縦スクロールシューティング。弾幕をかすって倍率を上げ、パワーアップとボムでボス🌩️を撃ち抜け！",
};

export default function SkyShooterPage() {
  return (
    <main>
      <SkyShooterGame />
      <div className="container">
        <p className="game-lead">
          むぎの愛機が大空へ！ ショットは自動発射、あなたは回避と「かすり」に集中。
          敵弾の近くを通るたびにスコア倍率が上がる、攻めるほど稼げる弾幕シューティングです。
        </p>
        <section className="howto">
          <h2>📖 遊び方</h2>
          <ol>
            <li>移動は WASD／矢印キー、またはドラッグ（自機は指の少し上に表示されます）。ショットは自動です。</li>
            <li>敵弾に当たらず近くを通ると「かすり」！ 20回ごとにスコア倍率が+1（最大×8）になります。</li>
            <li>運搬機🎈を落とすとアイテム：P＝火力アップ（最大5段階、並行→拡散）、S＝シールド（1回だけ被弾を防ぐ）、B＝ボム+1。</li>
            <li>ボム（Spaceキー／ボタン）は敵弾を全部消して画面全体に大ダメージ。ピンチの切り札です。</li>
            <li>被弾すると残機-1と火力-1。ステージは約80秒でボス🌩️が出現。倒すと次のステージへ（敵が強くなります）。</li>
            <li>ボスの攻撃は放射・狙撃・スパイラルの3パターン。HPが減るとスパイラルが解禁されます。</li>
          </ol>
          <p>
            💡 コツ：当たり判定は中心の赤い点だけ。弾と弾の「間」を抜けるのがかすり稼ぎの基本です。
          </p>
        </section>
      </div>
    </main>
  );
}
