/**
 * Languages offerable to attendees — one table for the operator's picker and
 * the attendee page, so a code the engineer turns on is always a name (not a
 * bare "ZH-CN") on the phones.
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
 * That is exactly why the operator's panel also accepts a typed code: when
 * this list is missing something the model supports, an engineer must not be
 * blocked by it.
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
  /**
   * The attendee page's one control, labelled in the language the reader
   * chose: someone who picked 中文 should not have to read "Mute" to find
   * the button. Short imperative labels, as a phone's own mute switch would
   * carry them. Left out where no confident rendering was to hand — the
   * page then falls back to its Korean/English pair, which is wrong for
   * nobody rather than a guess that is wrong for someone.
   */
  mute?: string;
  unmute?: string;
}

export const GEMINI_LANGUAGES: readonly GeminiLanguage[] = [
  { code: "ko", endonym: "한국어", ko: "한국어", mute: "음소거", unmute: "소리 켜기" },
  { code: "en", endonym: "English", ko: "영어", mute: "Mute", unmute: "Unmute" },
  { code: "ja", endonym: "日本語", ko: "일본어", mute: "ミュート", unmute: "ミュート解除" },
  { code: "zh-CN", endonym: "简体中文", ko: "중국어(간체)", mute: "静音", unmute: "取消静音" },
  { code: "zh-TW", endonym: "繁體中文", ko: "중국어(번체)", mute: "靜音", unmute: "取消靜音" },
  { code: "es", endonym: "Español", ko: "스페인어", mute: "Silenciar", unmute: "Activar sonido" },
  {
    code: "fr",
    endonym: "Français",
    ko: "프랑스어",
    mute: "Couper le son",
    unmute: "Activer le son",
  },
  { code: "de", endonym: "Deutsch", ko: "독일어", mute: "Stumm", unmute: "Ton an" },
  { code: "pt", endonym: "Português", ko: "포르투갈어", mute: "Silenciar", unmute: "Ativar som" },
  { code: "it", endonym: "Italiano", ko: "이탈리아어", mute: "Silenzia", unmute: "Riattiva audio" },
  { code: "nl", endonym: "Nederlands", ko: "네덜란드어", mute: "Dempen", unmute: "Geluid aan" },
  { code: "pl", endonym: "Polski", ko: "폴란드어", mute: "Wycisz", unmute: "Włącz dźwięk" },
  { code: "ru", endonym: "Русский", ko: "러시아어", mute: "Без звука", unmute: "Включить звук" },
  {
    code: "uk",
    endonym: "Українська",
    ko: "우크라이나어",
    mute: "Без звуку",
    unmute: "Увімкнути звук",
  },
  { code: "tr", endonym: "Türkçe", ko: "터키어", mute: "Sessiz", unmute: "Sesi aç" },
  { code: "ar", endonym: "العربية", ko: "아랍어", mute: "كتم الصوت", unmute: "تشغيل الصوت" },
  { code: "fa", endonym: "فارسی", ko: "페르시아어", mute: "بی‌صدا", unmute: "صدا روشن" },
  { code: "he", endonym: "עברית", ko: "히브리어", mute: "השתק", unmute: "בטל השתקה" },
  { code: "hi", endonym: "हिन्दी", ko: "힌디어", mute: "म्यूट", unmute: "अनम्यूट" },
  { code: "bn", endonym: "বাংলা", ko: "벵골어", mute: "মিউট", unmute: "আনমিউট" },
  { code: "ta", endonym: "தமிழ்", ko: "타밀어", mute: "ஒலி நிறுத்து", unmute: "ஒலி இயக்கு" },
  { code: "te", endonym: "తెలుగు", ko: "텔루구어", mute: "మ్యూట్", unmute: "అన్‌మ్యూట్" },
  { code: "ur", endonym: "اردو", ko: "우르두어", mute: "خاموش", unmute: "آواز چالو" },
  { code: "ne", endonym: "नेपाली", ko: "네팔어", mute: "म्युट", unmute: "अनम्युट" },
  { code: "si", endonym: "සිංහල", ko: "싱할라어" },
  { code: "th", endonym: "ไทย", ko: "태국어", mute: "ปิดเสียง", unmute: "เปิดเสียง" },
  { code: "lo", endonym: "ລາວ", ko: "라오어", mute: "ປິດສຽງ", unmute: "ເປີດສຽງ" },
  { code: "km", endonym: "ខ្មែរ", ko: "크메르어", mute: "បិទសំឡេង", unmute: "បើកសំឡេង" },
  { code: "my", endonym: "မြန်မာ", ko: "미얀마어", mute: "အသံပိတ်", unmute: "အသံဖွင့်" },
  { code: "vi", endonym: "Tiếng Việt", ko: "베트남어", mute: "Tắt tiếng", unmute: "Bật tiếng" },
  {
    code: "id",
    endonym: "Bahasa Indonesia",
    ko: "인도네시아어",
    mute: "Bisukan",
    unmute: "Bunyikan",
  },
  { code: "ms", endonym: "Bahasa Melayu", ko: "말레이어", mute: "Senyapkan", unmute: "Bunyikan" },
  { code: "fil", endonym: "Filipino", ko: "필리핀어", mute: "I-mute", unmute: "I-unmute" },
  { code: "mn", endonym: "Монгол", ko: "몽골어", mute: "Дууг хаах", unmute: "Дууг нээх" },
  { code: "kk", endonym: "Қазақша", ko: "카자흐어", mute: "Дыбысты өшіру", unmute: "Дыбысты қосу" },
  {
    code: "uz",
    endonym: "Oʻzbekcha",
    ko: "우즈베크어",
    mute: "Ovozni oʻchirish",
    unmute: "Ovozni yoqish",
  },
  { code: "az", endonym: "Azərbaycanca", ko: "아제르바이잔어", mute: "Səssiz", unmute: "Səsi aç" },
  {
    code: "hy",
    endonym: "Հայերեն",
    ko: "아르메니아어",
    mute: "Անջատել ձայնը",
    unmute: "Միացնել ձայնը",
  },
  { code: "ka", endonym: "ქართული", ko: "조지아어", mute: "ხმის გამორთვა", unmute: "ხმის ჩართვა" },
  { code: "el", endonym: "Ελληνικά", ko: "그리스어", mute: "Σίγαση", unmute: "Κατάργηση σίγασης" },
  { code: "cs", endonym: "Čeština", ko: "체코어", mute: "Ztlumit", unmute: "Zapnout zvuk" },
  { code: "sk", endonym: "Slovenčina", ko: "슬로바키아어", mute: "Stlmiť", unmute: "Zapnúť zvuk" },
  { code: "hu", endonym: "Magyar", ko: "헝가리어", mute: "Némítás", unmute: "Hang be" },
  {
    code: "ro",
    endonym: "Română",
    ko: "루마니아어",
    mute: "Dezactivare sunet",
    unmute: "Activare sunet",
  },
  { code: "bg", endonym: "Български", ko: "불가리아어", mute: "Без звук", unmute: "Включи звука" },
  {
    code: "hr",
    endonym: "Hrvatski",
    ko: "크로아티아어",
    mute: "Isključi zvuk",
    unmute: "Uključi zvuk",
  },
  { code: "sr", endonym: "Српски", ko: "세르비아어", mute: "Искључи звук", unmute: "Укључи звук" },
  {
    code: "sl",
    endonym: "Slovenščina",
    ko: "슬로베니아어",
    mute: "Izklopi zvok",
    unmute: "Vklopi zvok",
  },
  { code: "sq", endonym: "Shqip", ko: "알바니아어", mute: "Hiq zërin", unmute: "Aktivizo zërin" },
  {
    code: "mk",
    endonym: "Македонски",
    ko: "마케도니아어",
    mute: "Исклучи звук",
    unmute: "Вклучи звук",
  },
  { code: "da", endonym: "Dansk", ko: "덴마크어", mute: "Slå lyd fra", unmute: "Slå lyd til" },
  { code: "sv", endonym: "Svenska", ko: "스웨덴어", mute: "Ljud av", unmute: "Ljud på" },
  { code: "nb", endonym: "Norsk", ko: "노르웨이어", mute: "Lyd av", unmute: "Lyd på" },
  { code: "fi", endonym: "Suomi", ko: "핀란드어", mute: "Mykistä", unmute: "Ääni päälle" },
  {
    code: "is",
    endonym: "Íslenska",
    ko: "아이슬란드어",
    mute: "Slökkva á hljóði",
    unmute: "Kveikja á hljóði",
  },
  { code: "et", endonym: "Eesti", ko: "에스토니아어", mute: "Vaigista", unmute: "Heli sisse" },
  {
    code: "lv",
    endonym: "Latviešu",
    ko: "라트비아어",
    mute: "Izslēgt skaņu",
    unmute: "Ieslēgt skaņu",
  },
  {
    code: "lt",
    endonym: "Lietuvių",
    ko: "리투아니아어",
    mute: "Išjungti garsą",
    unmute: "Įjungti garsą",
  },
  { code: "ca", endonym: "Català", ko: "카탈루냐어", mute: "Silencia", unmute: "Activa el so" },
  { code: "gl", endonym: "Galego", ko: "갈리시아어", mute: "Silenciar", unmute: "Activar o son" },
  { code: "eu", endonym: "Euskara", ko: "바스크어", mute: "Isilarazi", unmute: "Soinua aktibatu" },
  { code: "af", endonym: "Afrikaans", ko: "아프리칸스어", mute: "Demp", unmute: "Klank aan" },
  { code: "sw", endonym: "Kiswahili", ko: "스와힐리어", mute: "Zima sauti", unmute: "Washa sauti" },
  { code: "zu", endonym: "isiZulu", ko: "줄루어", mute: "Thulisa", unmute: "Vula umsindo" },
  { code: "am", endonym: "አማርኛ", ko: "암하라어", mute: "ድምጽ አጥፋ", unmute: "ድምጽ አብራ" },
];

const BY_CODE = new Map(GEMINI_LANGUAGES.map((l) => [l.code, l]));

export function findLanguage(code: string): GeminiLanguage | undefined {
  return BY_CODE.get(code);
}
