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
    slug: "survivors",
    title: "むぎサバイバーズ",
    shortTitle: "むぎサバイバーズ",
    description:
      "押し寄せる敵の群れを自動攻撃でなぎ倒し、🌾を集めてレベルアップ！ 3つの強化を選んでビルドを組み立て、どこまで生き延びられるか挑むサバイバルアクション。",
    tag: "生き延びろ、育てろ、無双しろ",
    emoji: "⚔️",
  },
  {
    slug: "tower-defense",
    title: "麦畑防衛戦",
    shortTitle: "麦畑防衛戦",
    description:
      "畑に迫る敵の行列を、4種のタワーで迎え撃つタワーディフェンス。配置・強化・売却をやりくりしてウェーブを乗り切れ。20ウェーブ以降はエンドレス！",
    tag: "配置が勝負の本格TD",
    emoji: "🏯",
  },
  {
    slug: "sky-shooter",
    title: "むぎスカイ",
    shortTitle: "むぎスカイ",
    description:
      "むぎが飛行機で大空へ！ 弾幕をかすって倍率を上げ、パワーアップとボムで敵編隊とボスを撃ち抜く縦スクロールシューティング。",
    tag: "かすって稼ぐ弾幕STG",
    emoji: "✈️",
  },
];
