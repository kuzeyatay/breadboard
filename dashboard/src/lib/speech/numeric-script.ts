const SMALL = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function integerWords(value: number): string {
  if (value < 20) return SMALL[value];
  if (value < 100) return [TENS[Math.floor(value / 10)], value % 10 ? SMALL[value % 10] : ''].filter(Boolean).join(' ');
  if (value < 1000) return [SMALL[Math.floor(value / 100)], 'hundred', value % 100 ? integerWords(value % 100) : ''].filter(Boolean).join(' ');
  for (const [size, name] of [[1e12,'trillion'],[1e9,'billion'],[1e6,'million'],[1e3,'thousand']] as const) {
    if (value >= size) return [integerWords(Math.floor(value / size)),name,value % size ? integerWords(value % size) : ''].filter(Boolean).join(' ');
  }
  return '';
}

/** Bare digits carry no language and can be mistaken for a date by a realtime
 * reader. Spell standalone English numbers locally; prose and other selected
 * languages retain their original script. No model or resource load is needed. */
export function numericSpeechScript(text: string, language: string, conversation = false): string {
  if (!/^en(?:-|$)/i.test(language)) return text;
  const match = text.trim().match(/^([+-]?)(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?([.!?]?)$/);
  if (!match) return text;
  const [, sign, whole, fraction, punctuation] = match;
  const digits = whole.replaceAll(',', '');
  // Long identifiers and leading zeroes must retain every digit, exactly.
  const integer = digits.length > 15 || /^0\d/.test(digits)
    ? [...digits].map(digit => SMALL[Number(digit)]).join(' ')
    : integerWords(Number(digits));
  const words = [sign === '-' ? 'minus' : sign === '+' ? 'plus' : '', integer,
    fraction ? 'point ' + [...fraction].map(digit => SMALL[Number(digit)]).join(' ') : '']
    .filter(Boolean).join(' ');
  // A standalone value is a complete conversational answer. Give the reader
  // a declarative sentence without changing any digit, sign or decimal place.
  // Ordinary read-aloud and exports retain the original unframed script.
  return conversation && punctuation !== '?' ? `The answer is ${words}${punctuation || '.'}` : words + punctuation;
}

/** Verification only: one natural acknowledgement remains audible in live
 * conversation. All number words after it must still match the exact script.
 * Read-aloud and exports leave acknowledgements in the transcript and reject
 * them. Never discard signs, extra quantities, or repeated acknowledgements. */
export function numericSpeechTranscript(text: string, language: string, conversation = false): string {
  const reading = conversation && /^en(?:-|$)/i.test(language)
    ? text.replace(/^\s*(?:mm-hmm|okay)(?=$|[\s.!?,;:])(?:[.!?,;:]*\s*)/iu, '')
    : text;
  return numericSpeechScript(reading, language);
}
