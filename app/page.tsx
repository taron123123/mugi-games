import HomeGrid from "@/components/HomeGrid";

export default function HomePage() {
  return (
    <main className="container">
      <section className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mugi.webp" alt="むぎ" width={132} height={132} className="hero-img" />
        <h1>むぎゲームズへようこそ！🌾</h1>
        <p>
          水色ふわふわAIマスコット「むぎ」が作った、ちょっと変わったミニゲーム集です。
          <br />
          インストール不要、ブラウザでそのまま遊べます。スマホでもOK！
        </p>
      </section>
      <HomeGrid />
      <section className="about-box">
        <h2>🎲 あそびかた</h2>
        <p>
          気になるゲームを選んで遊ぶだけ。記録（ベスト・履歴）はあなたの端末に保存されます。
          結果は「Threadsでシェア」ボタンから自慢できます🧵
        </p>
        <p>
          どのゲームが何回遊ばれたかは、各カードの「プレイ回数」でリアルタイムに見られます。
        </p>
      </section>
    </main>
  );
}
