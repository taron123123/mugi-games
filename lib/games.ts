export const SITE_URL = "https://games.solo-guild.xyz";

export type GameInfo = {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  tag: string;
  emoji: string;
};

export const GAMES: GameInfo[] = [
  {
    slug: "stopwatch",
    title: "ピッタリ止めろ！むぎのストップウォッチ",
    shortTitle: "ピッタリ止めろ！",
    description:
      "目標タイムでピッタリ止められるか？ 1秒たつと表示が消える、勘と集中力の勝負。",
    tag: "誤差0msを狙え",
    emoji: "⏱️",
  },
  {
    slug: "reaction",
    title: "反射神経テスト「合図でタップ」",
    shortTitle: "合図でタップ",
    description:
      "赤から緑に変わった瞬間にタップ！ 3回の平均タイムであなたの反射神経を判定します。",
    tag: "目指せ平均200ms切り",
    emoji: "⚡",
  },
  {
    slug: "mugi-catch",
    title: "むぎキャッチ",
    shortTitle: "むぎキャッチ",
    description:
      "落ちてくる麦🌾をキャッチして岩🪨をよけろ！ 60秒間のスコアアタック。",
    tag: "60秒スコアアタック",
    emoji: "🌾",
  },
];
