/**
 * Languages offerable to attendees.
 *
 * Google's live-translate documentation says the
 * `gemini-3.5-live-translate-preview` model supports "over 70 languages" by
 * BCP-47 code, but the page does not publish the table in a form we can pull
 * in, so this list is curated rather than authoritative. The codes the
 * documentation names outright — English, Spanish, French, German, Chinese
 * (Simplified and Traditional), Japanese, Afrikaans, Kazakh, Khmer, Zulu —
 * are all here and are covered by a test; the rest are the languages an event
 * in Korea is most likely to need, and are a reasonable bet rather than a
 * promise.
 *
 * That is exactly why the panel also accepts a typed code: when this list is
 * missing something the model supports, an engineer must not be blocked by it.
 *
 * There is deliberately no source-language field anywhere in this system's
 * Gemini calls. `translationConfig` takes only `targetLanguageCode` — the
 * model detects the input language itself and, with echo on, parrots speech
 * that is already in the target language. So every offered language is a
 * translation lane; the only untranslated lane is the optional passthrough
 * one, a debugging aid rather than a language.
 */
export interface GeminiLanguage {
  /** BCP-47, as passed to translationConfig.targetLanguageCode. */
  code: string;
  /** The language's name in its own script — what an attendee reads. */
  endonym: string;
  /** Its name in Korean — what the engineer reads. */
  ko: string;
}

export const GEMINI_LANGUAGES: readonly GeminiLanguage[] = [
  { code: "ko", endonym: "한국어", ko: "한국어" },
  { code: "en", endonym: "English", ko: "영어" },
  { code: "ja", endonym: "日本語", ko: "일본어" },
  { code: "zh-CN", endonym: "简体中文", ko: "중국어(간체)" },
  { code: "zh-TW", endonym: "繁體中文", ko: "중국어(번체)" },
  { code: "es", endonym: "Español", ko: "스페인어" },
  { code: "fr", endonym: "Français", ko: "프랑스어" },
  { code: "de", endonym: "Deutsch", ko: "독일어" },
  { code: "pt", endonym: "Português", ko: "포르투갈어" },
  { code: "it", endonym: "Italiano", ko: "이탈리아어" },
  { code: "nl", endonym: "Nederlands", ko: "네덜란드어" },
  { code: "pl", endonym: "Polski", ko: "폴란드어" },
  { code: "ru", endonym: "Русский", ko: "러시아어" },
  { code: "uk", endonym: "Українська", ko: "우크라이나어" },
  { code: "tr", endonym: "Türkçe", ko: "터키어" },
  { code: "ar", endonym: "العربية", ko: "아랍어" },
  { code: "fa", endonym: "فارسی", ko: "페르시아어" },
  { code: "he", endonym: "עברית", ko: "히브리어" },
  { code: "hi", endonym: "हिन्दी", ko: "힌디어" },
  { code: "bn", endonym: "বাংলা", ko: "벵골어" },
  { code: "ta", endonym: "தமிழ்", ko: "타밀어" },
  { code: "te", endonym: "తెలుగు", ko: "텔루구어" },
  { code: "ur", endonym: "اردو", ko: "우르두어" },
  { code: "ne", endonym: "नेपाली", ko: "네팔어" },
  { code: "si", endonym: "සිංහල", ko: "싱할라어" },
  { code: "th", endonym: "ไทย", ko: "태국어" },
  { code: "lo", endonym: "ລາວ", ko: "라오어" },
  { code: "km", endonym: "ខ្មែរ", ko: "크메르어" },
  { code: "my", endonym: "မြန်မာ", ko: "미얀마어" },
  { code: "vi", endonym: "Tiếng Việt", ko: "베트남어" },
  { code: "id", endonym: "Bahasa Indonesia", ko: "인도네시아어" },
  { code: "ms", endonym: "Bahasa Melayu", ko: "말레이어" },
  { code: "fil", endonym: "Filipino", ko: "필리핀어" },
  { code: "mn", endonym: "Монгол", ko: "몽골어" },
  { code: "kk", endonym: "Қазақша", ko: "카자흐어" },
  { code: "uz", endonym: "Oʻzbekcha", ko: "우즈베크어" },
  { code: "az", endonym: "Azərbaycanca", ko: "아제르바이잔어" },
  { code: "hy", endonym: "Հայերեն", ko: "아르메니아어" },
  { code: "ka", endonym: "ქართული", ko: "조지아어" },
  { code: "el", endonym: "Ελληνικά", ko: "그리스어" },
  { code: "cs", endonym: "Čeština", ko: "체코어" },
  { code: "sk", endonym: "Slovenčina", ko: "슬로바키아어" },
  { code: "hu", endonym: "Magyar", ko: "헝가리어" },
  { code: "ro", endonym: "Română", ko: "루마니아어" },
  { code: "bg", endonym: "Български", ko: "불가리아어" },
  { code: "hr", endonym: "Hrvatski", ko: "크로아티아어" },
  { code: "sr", endonym: "Српски", ko: "세르비아어" },
  { code: "sl", endonym: "Slovenščina", ko: "슬로베니아어" },
  { code: "sq", endonym: "Shqip", ko: "알바니아어" },
  { code: "mk", endonym: "Македонски", ko: "마케도니아어" },
  { code: "da", endonym: "Dansk", ko: "덴마크어" },
  { code: "sv", endonym: "Svenska", ko: "스웨덴어" },
  { code: "nb", endonym: "Norsk", ko: "노르웨이어" },
  { code: "fi", endonym: "Suomi", ko: "핀란드어" },
  { code: "is", endonym: "Íslenska", ko: "아이슬란드어" },
  { code: "et", endonym: "Eesti", ko: "에스토니아어" },
  { code: "lv", endonym: "Latviešu", ko: "라트비아어" },
  { code: "lt", endonym: "Lietuvių", ko: "리투아니아어" },
  { code: "ca", endonym: "Català", ko: "카탈루냐어" },
  { code: "gl", endonym: "Galego", ko: "갈리시아어" },
  { code: "eu", endonym: "Euskara", ko: "바스크어" },
  { code: "af", endonym: "Afrikaans", ko: "아프리칸스어" },
  { code: "sw", endonym: "Kiswahili", ko: "스와힐리어" },
  { code: "zu", endonym: "isiZulu", ko: "줄루어" },
  { code: "am", endonym: "አማርኛ", ko: "암하라어" },
];

/**
 * A shape check, not a membership check. The panel lets an engineer type a
 * code this list is missing, so this is the only thing standing between a
 * typo and a lane the server cannot open — but it cannot know whether Google
 * supports the code, only whether it looks like BCP-47 at all.
 */
export function isLanguageCode(value: string): boolean {
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(value);
}

const BY_CODE = new Map(GEMINI_LANGUAGES.map((l) => [l.code, l]));

/** Both names for a code the list knows; the bare code for one it does not. */
export function languageLabel(code: string): string {
  const known = BY_CODE.get(code);
  return known ? `${known.endonym} · ${known.ko}` : code;
}

export function findLanguage(code: string): GeminiLanguage | undefined {
  return BY_CODE.get(code);
}
