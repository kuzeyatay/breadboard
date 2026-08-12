/**
 * Read-aloud passages for cloning a voice from a live recording.
 *
 * A clone is only as good as the pairing between the audio and the reference
 * text it was spoken from, so handing the user a script removes both ways that
 * pairing goes wrong: improvising something too short to characterise a voice,
 * and transcribing it from memory afterwards.
 *
 * Each passage is ordinary speech rather than a pangram — it carries the
 * rhythm, contractions and intonation a clone has to reproduce — and runs
 * around twelve seconds aloud, inside the 5–15 second window Voicebox asks for.
 */

/** Below this a take does not characterise a voice; Voicebox clones it badly. */
export const MIN_SAMPLE_SECONDS = 5;
/** Past this, extra audio stops improving the clone. */
export const AMPLE_SAMPLE_SECONDS = 20;
/** Hard stop, so a forgotten recording cannot run until the tab is closed. */
export const MAX_SAMPLE_SECONDS = 60;

const PASSAGES: Record<string, string> = {
  en: "The morning market is already busy. Bread cools on the racks, a radio plays something old, and two children argue about who saw the cat first. I'll buy the oranges before they're gone.",
  de: "Der Markt ist schon am Morgen voll. Frisches Brot kühlt in den Regalen, ein altes Radio spielt leise, und zwei Kinder streiten darüber, wer die Katze zuerst gesehen hat.",
  fr: "Le marché est déjà plein dès le matin. Le pain refroidit sur les étagères, une vieille radio joue tout doucement, et deux enfants se disputent pour savoir qui a vu le chat en premier.",
  es: "El mercado ya está lleno por la mañana. El pan se enfría en los estantes, una radio vieja suena bajito, y dos niños discuten sobre quién vio al gato primero.",
  it: "Il mercato è già pieno di gente la mattina presto. Il pane si raffredda sugli scaffali, una vecchia radio suona piano, e due bambini litigano su chi ha visto il gatto per primo.",
  pt: "O mercado já está cheio logo de manhã. O pão esfria nas prateleiras, um rádio antigo toca baixinho, e duas crianças discutem sobre quem viu o gato primeiro.",
  nl: "De markt is 's ochtends al druk. Het brood koelt af in de rekken, een oude radio speelt zachtjes, en twee kinderen maken ruzie over wie de kat het eerst zag.",
  pl: "Rynek jest pełen ludzi już od rana. Chleb stygnie na półkach, stare radio gra cicho, a dwoje dzieci kłóci się o to, kto pierwszy zobaczył kota.",
  sv: "Marknaden är full av folk redan på morgonen. Brödet svalnar på hyllorna, en gammal radio spelar tyst, och två barn bråkar om vem som såg katten först.",
  ru: "Рынок полон людей уже с самого утра. Хлеб остывает на полках, старое радио играет тихо, а двое детей спорят о том, кто первым увидел кошку.",
  tr: "Pazar sabahın erken saatlerinde bile kalabalık. Ekmekler raflarda soğuyor, eski bir radyo alçak sesle çalıyor ve iki çocuk kediyi önce kimin gördüğünü tartışıyor.",
  ar: "السوق مزدحم منذ الصباح الباكر. الخبز يبرد على الرفوف، وراديو قديم يعمل بصوت منخفض، وطفلان يتجادلان حول من رأى القطة أولًا.",
  hi: "बाज़ार सुबह से ही भरा हुआ है। ताज़ी रोटियाँ रैक पर ठंडी हो रही हैं, एक पुराना रेडियो धीरे-धीरे बज रहा है, और दो बच्चे इस बात पर झगड़ रहे हैं कि बिल्ली को पहले किसने देखा।",
  zh: "清晨的市场已经很热闹了。面包在架子上慢慢变凉，一台旧收音机小声地放着歌，两个孩子正在争论到底是谁先看见了那只猫。",
  ja: "朝の市場はもう賑やかです。焼きたてのパンが棚で冷めていき、古いラジオが小さな音で流れて、二人の子どもがどちらが先に猫を見つけたかで言い争っています。",
  ko: "아침 시장은 벌써 북적입니다. 갓 구운 빵이 선반에서 식어 가고, 낡은 라디오가 작은 소리로 흘러나오고, 아이 둘이 누가 먼저 고양이를 봤는지 다투고 있습니다.",
};

const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

export type CalibrationPassage = {
  text: string;
  /** Whether the passage was written for the language that was asked for. */
  translated: boolean;
  dir: "ltr" | "rtl";
};

/**
 * The script for `language`, falling back to English rather than to nothing:
 * reading an English passage still produces a usable clone, and an empty card
 * would leave the user with no way to record at all.
 */
export function calibrationPassage(language: string): CalibrationPassage {
  const code = String(language || "").toLowerCase().split(/[-_]/)[0];
  const text = PASSAGES[code];
  return {
    text: text || PASSAGES.en,
    translated: Boolean(text),
    dir: RTL_LANGUAGES.has(code) ? "rtl" : "ltr",
  };
}

export type SampleLengthTone = "short" | "good" | "long";

/**
 * What to tell someone about the length of a take, while it runs and once it
 * is finished. Length is the failure people cannot see coming: a three-second
 * clip is accepted everywhere down the stack and only disappoints later, in
 * the cloned voice itself.
 */
export function sampleLengthAdvice(
  seconds: number,
  phase: "recording" | "recorded",
): { tone: SampleLengthTone; message: string } {
  const rounded = Math.max(0, Math.round(seconds * 10) / 10);
  if (rounded < MIN_SAMPLE_SECONDS) {
    return {
      tone: "short",
      message:
        phase === "recording"
          ? `Keep reading — a voice needs at least ${MIN_SAMPLE_SECONDS} seconds to copy.`
          : `That take is only ${rounded} seconds. Record again and read to the end of the passage: under ${MIN_SAMPLE_SECONDS} seconds the clone comes out flat.`,
    };
  }
  if (rounded <= AMPLE_SAMPLE_SECONDS) {
    return {
      tone: "good",
      message:
        phase === "recording"
          ? "Good length. Stop when you reach the end of the passage."
          : "Good length for a clone.",
    };
  }
  return {
    tone: "long",
    message:
      phase === "recording"
        ? `That is plenty — recording stops on its own at ${MAX_SAMPLE_SECONDS} seconds.`
        : "Longer than needed, which is fine: only the first seconds shape the clone.",
  };
}
