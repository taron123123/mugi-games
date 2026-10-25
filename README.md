# むぎゲームズ (Mugi Games)

solo-guild の AI マスコット「むぎ」がご案内する、ちょっと変わったブラウザミニゲーム集です。
インストール不要で、PC でもスマホでもそのまま遊べます。

- 本番: https://games.solo-guild.xyz
- 技術: Next.js (App Router, TypeScript) / Vercel

## ゲーム一覧

| ゲーム | URL | 内容 |
| --- | --- | --- |
| ピッタリ止めろ！むぎのストップウォッチ | `/games/stopwatch` | 目標タイムでピッタリ止める。1秒で表示が隠れます。「今日のチャレンジ」は日付シードで決まる全員共通の目標 |
| 反射神経テスト「合図でタップ」 | `/games/reaction` | 赤→緑の合図でタップ。3回の平均タイムで判定 |
| むぎキャッチ | `/games/mugi-catch` | Canvas ゲーム。麦🌾を拾い岩🪨を避ける60秒スコアアタック |

各ゲームの結果画面からは Threads へ結果をシェアできます（`threads.net/intent/post`）。

## プレイ回数カウンター

- 無料の [Abacus](https://abacus.jasoncameron.dev) カウンター API をブラウザから直接呼んでいます。
  - 読み取り: `GET /get/mugi-games-solo-guild/plays-<slug>`
  - 加算: `GET /hit/mugi-games-solo-guild/plays-<slug>`
- 加算は「1プレイの開始」ごとに1回だけ（ゲームのスタート操作時）。リトライは新しいプレイとして数え、ページ再読込でも新しいプレイとして数えます。
- 未初期化のキーは 404 になるため、その場合は 0 として表示します。取得失敗時は「—」表示で、ページは壊れません。
- v1 はこの無料 API で運用しています。将来は自前ストア（Vercel KV 等）に差し替え可能です（`lib/counter.ts` の2関数を置き換えるだけ）。

## 自分の記録（ローカル）

- ベスト記録と直近の履歴は各プレイヤーの `localStorage` に保存されます（端末ごと）。
- 全員のグローバルランキングは v1 では入れていません。**グローバルランキングには保存用バックエンドが必要なため今後の拡張**とします。

## ゲームの追加方法

1. `lib/games.ts` の `GAMES` に `{ slug, title, shortTitle, description, tag, emoji }` を追加。
2. `components/<Name>Game.tsx` にゲーム本体（Client Component）を作成。
   - プレイ回数は `lib/usePlayCounter.ts` の `usePlayCounter(slug)` を使い、スタート操作で `registerPlay()` を1回呼ぶ。
   - 記録は `lib/records.ts` の `pushHistory()` で保存し、`components/RecordsPanel.tsx` で表示。
   - 結果画面には `components/ShareButton.tsx` で Threads シェアを付ける。
3. `app/games/<slug>/page.tsx` を作り、ゲーム・遊び方・一覧への戻りリンクを配置。
4. `npm run build` が通ることを確認してからコミット。

## 開発

```bash
npm install
npm run dev   # http://localhost:3000
npm run build
```
