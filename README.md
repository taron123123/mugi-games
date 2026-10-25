# むぎゲームズ (Mugi Games)

solo-guild の AI マスコット「むぎ」がご案内する、本格ブラウザゲーム集です。
インストール不要で、PC でもスマホでもそのまま遊べます。

- 本番: https://games.solo-guild.xyz
- 技術: Next.js (App Router, TypeScript) / Vercel / Canvas + WebAudio 合成サウンド

## ゲーム一覧

| ゲーム | URL | 内容 |
| --- | --- | --- |
| むぎサバイバーズ | `/games/survivors` | Vampire Survivors 系。自動攻撃で群れを倒し、経験値🌾でレベルアップ時に3択の強化を選んでビルドを育てる。回転ガマ・追尾ミサイル・雷撃などの武器、60秒ごとのエリート、3分ごとのボス |
| 麦畑防衛戦 | `/games/tower-defense` | タワーディフェンス。4種のタワー（かかし砲台／連射スプリンクラー／氷結ファン／雷タワー）を配置・強化（3段階）・売却。ボスは5ウェーブごと、20ウェーブ以降はエンドレス |
| むぎスカイ | `/games/sky-shooter` | 縦スクロールSTG。敵弾をかすってスコア倍率アップ（最大×8）、P/S/B パワーアップ、ボム、ステージごとに強くなるボス🌩️（放射・狙撃・スパイラル弾幕） |

各ゲームの結果画面からは Threads へ結果をシェアできます（`threads.net/intent/post`）。
効果音は `lib/sfx.ts` が WebAudio で合成しています（音源ファイルなし、ミュート切替あり）。

## プレイ回数カウンター

- 無料の [Abacus](https://abacus.jasoncameron.dev) カウンター API をブラウザから直接呼んでいます。
  - 読み取り: `GET /get/mugi-games-solo-guild/plays-<slug>`
  - 加算: `GET /hit/mugi-games-solo-guild/plays-<slug>`
- 加算は「1プレイの開始」ごとに1回だけ（ゲームのスタート操作時）。リトライは新しいプレイとして数え、ページ再読込でも新しいプレイとして数えます。
- 未初期化のキーは 404 になるため、その場合は 0 として表示します。取得失敗時は「—」表示で、ページは壊れません。
- 現在のキー: `plays-survivors` / `plays-tower-defense` / `plays-sky-shooter`。
- 将来は自前ストア（Vercel KV 等）に差し替え可能です（`lib/counter.ts` の2関数を置き換えるだけ）。

## 自分の記録（ローカル）

- ベスト記録と直近の履歴は各プレイヤーの `localStorage` に保存されます（端末ごと）。
- 全員のグローバルランキングはまだ入れていません。**グローバルランキングにはスコア保存用バックエンドが必要なため今後の拡張**とします。

## ゲームの追加方法

1. `lib/games.ts` の `GAMES` に `{ slug, title, shortTitle, description, tag, emoji }` を追加。
2. `components/<Name>Game.tsx` にゲーム本体（Client Component）を作成。
   - プレイ回数は `lib/usePlayCounter.ts` の `usePlayCounter(slug)` を使い、スタート操作で `registerPlay()` を1回呼ぶ。
   - 記録は `lib/records.ts` の `pushHistory()` で保存し、`components/RecordsPanel.tsx` で表示。
   - 結果画面には `components/ShareButton.tsx` で Threads シェアを付ける。
   - 効果音は `lib/sfx.ts` の `sfx.play(...)`、ミュート切替は `components/MuteButton.tsx`。
3. `app/games/<slug>/page.tsx` を作り、ゲーム・遊び方・一覧への戻りリンクを配置。
4. `app/layout.tsx` のナビにもリンクを追加。
5. `npm run build` が通ることを確認してからコミット。

## 開発

```bash
npm install
npm run dev   # http://localhost:3000
npm run build
```
