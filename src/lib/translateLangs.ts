import type { TranslateLang } from "../types";

/** PLaMo 3 Translate languages (model card) with display names. */
export const TRANSLATE_LANGS: { code: TranslateLang; en: string; ja: string }[] = [
  { code: "ja", en: "Japanese", ja: "日本語" },
  { code: "en", en: "English", ja: "英語" },
  { code: "zh-hans", en: "Chinese (Simplified)", ja: "中国語（簡体字）" },
  { code: "zh-hant", en: "Chinese (Traditional)", ja: "中国語（繁体字）" },
  { code: "ko", en: "Korean", ja: "韓国語" },
  { code: "de", en: "German", ja: "ドイツ語" },
  { code: "fr", en: "French", ja: "フランス語" },
  { code: "es", en: "Spanish", ja: "スペイン語" },
  { code: "it", en: "Italian", ja: "イタリア語" },
  { code: "nl", en: "Dutch", ja: "オランダ語" },
  { code: "ru", en: "Russian", ja: "ロシア語" },
  { code: "pl", en: "Polish", ja: "ポーランド語" },
  { code: "vi", en: "Vietnamese", ja: "ベトナム語" },
  { code: "th", en: "Thai", ja: "タイ語" },
  { code: "id", en: "Indonesian", ja: "インドネシア語" },
  { code: "ms", en: "Malay", ja: "マレー語" },
  { code: "hi", en: "Hindi", ja: "ヒンディー語" },
  { code: "ar", en: "Arabic", ja: "アラビア語" },
  { code: "he", en: "Hebrew", ja: "ヘブライ語" },
  { code: "fa", en: "Persian", ja: "ペルシア語" },
  { code: "az", en: "Azerbaijani", ja: "アゼルバイジャン語" },
  { code: "be", en: "Belarusian", ja: "ベラルーシ語" },
  { code: "bg", en: "Bulgarian", ja: "ブルガリア語" },
  { code: "bn", en: "Bengali", ja: "ベンガル語" },
  { code: "ca", en: "Catalan", ja: "カタルーニャ語" },
  { code: "ceb", en: "Cebuano", ja: "セブアノ語" },
  { code: "et", en: "Estonian", ja: "エストニア語" },
  { code: "eu", en: "Basque", ja: "バスク語" },
  { code: "gu", en: "Gujarati", ja: "グジャラート語" },
  { code: "hr", en: "Croatian", ja: "クロアチア語" },
  { code: "hu", en: "Hungarian", ja: "ハンガリー語" },
  { code: "hy", en: "Armenian", ja: "アルメニア語" },
  { code: "jv", en: "Javanese", ja: "ジャワ語" },
  { code: "ka", en: "Georgian", ja: "ジョージア語" },
  { code: "kk", en: "Kazakh", ja: "カザフ語" },
  { code: "km", en: "Khmer", ja: "クメール語" },
  { code: "lt", en: "Lithuanian", ja: "リトアニア語" },
  { code: "lv", en: "Latvian", ja: "ラトビア語" },
  { code: "ml", en: "Malayalam", ja: "マラヤーラム語" },
  { code: "mr", en: "Marathi", ja: "マラーティー語" },
  { code: "my", en: "Burmese", ja: "ビルマ語" },
  { code: "ne", en: "Nepali", ja: "ネパール語" },
  { code: "pa", en: "Punjabi", ja: "パンジャブ語" },
  { code: "si", en: "Sinhala", ja: "シンハラ語" },
  { code: "sk", en: "Slovak", ja: "スロバキア語" },
  { code: "sl", en: "Slovenian", ja: "スロベニア語" },
  { code: "sr", en: "Serbian", ja: "セルビア語" },
  { code: "sw", en: "Swahili", ja: "スワヒリ語" },
  { code: "ta", en: "Tamil", ja: "タミル語" },
  { code: "te", en: "Telugu", ja: "テルグ語" },
  { code: "tl", en: "Tagalog", ja: "タガログ語" },
  { code: "ur", en: "Urdu", ja: "ウルドゥー語" },
  { code: "uz", en: "Uzbek", ja: "ウズベク語" },
];

/** Short code for badges: "zh-hans" → "ZH-HANS", "en" → "EN". */
export function langBadge(code: string | null | undefined): string {
  return code ? code.toUpperCase() : "AUTO";
}

/** Guess a note's language when the Translate node's source is "auto"
 *  (Japanese script → ja, otherwise en; never the same as `target`). */
export function guessSourceLang(text: string, target: string): TranslateLang {
  const guess: TranslateLang = /[぀-ヿ㐀-鿿]/.test(text) ? "ja" : "en";
  if (guess !== target) return guess;
  return target === "ja" ? "en" : "ja";
}
