import { numericSpeechScript } from './numeric-script.ts';

type Unit = 'celsius' | 'fahrenheit';
const UNITS = /°\s*[cf]\b|[℃℉]|\bdegrees?\s+[cf]\b|\b(?:degrees?\s+)?(?:celsius|centigrade|fahrenheit)\b/giu;
const NUMBER = '[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const QUANTITY = new RegExp(`(?<![\\p{L}\\p{N}.,])(${NUMBER})(?:\\s*(?:[-–—]|to|through)\\s*(${NUMBER}))?\\s*$`, 'u');

/** Canonical unit words retain the original script offsets used by recovery. */
export function temperatureWord(text: string, word: string, index: number): string | undefined {
  const token=word.normalize('NFKC').toLowerCase();
  if (token==='°c' || token==='centigrade') return 'celsius';
  if (token==='°f') return 'fahrenheit';
  if (/^[cf]$/.test(token) && /(?:°|\bdegrees?)\s*$/iu.test(text.slice(0,index))) {
    return token==='c'?'celsius':'fahrenheit';
  }
  return undefined;
}

function quantities(text: string): string {
  return text.normalize('NFKC').replace(/−/g,'-')
    .replace(/(?<=\d)\s*[-–—]\s*(?=[+-]?\d)/g,' to ')
    .replace(/[–—]/g,' to ')
    .replace(new RegExp(NUMBER,'g'),value=>numericSpeechScript(value,'en'))
    .toLowerCase().replace(/\bnegative\b/g,'minus').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

const NUMBER_WORD = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|point|plus|minus)$/;
function exactQuantitySuffix(prefix: string, form: string): boolean {
  if (prefix===form) return true;
  if (!prefix.endsWith(' '+form)) return false;
  const before=prefix.slice(0,-form.length).trim();
  // Six is not minus six, sixty-six, one hundred six, or point six.
  if (NUMBER_WORD.test(before)) return false;
  return !NUMBER_WORD.test(before.replace(/\s+(?:to|through|and)$/,''));
}

function markers(text: string) {
  return [...text.matchAll(UNITS)].map(match=>({
    unit: /f|℉/i.test(match[0])?'fahrenheit' as Unit:'celsius' as Unit,
    start:match.index,end:match.index+match[0].length,
  }));
}

/** Accept standard unit pronunciations without overlooking a changed value.
 * Numeric scripts accept written numbers and their English cardinal readings.
 * This is a temperature check, not a general claim of numeric speech fidelity. */
export function createTemperatureReadingGuard(script: string, language='en') {
  const expected=markers(script).map(marker=>{
    const value=script.slice(0,marker.start).replace(/−/g,'-').match(QUANTITY);
    const first=value&&/^en(?:-|$)/i.test(language)?quantities(value[1]):undefined;
    const last=value?.[2]?quantities(value[2]):undefined;
    return {...marker,forms:first?(last?[`${first} to ${last}`,`${first} through ${last}`,`${first} and ${last}`]:[first]):undefined};
  });
  let confirmed=0,diverged=false;
  return {
    feed(transcript: string) {
      if (!expected.length || diverged) return;
      const heard=markers(transcript).filter(marker=>marker.end<transcript.length || !/[\p{L}\p{N}]$/u.test(transcript));
      for (let index=0;index<heard.length;index++) {
        const wanted=expected[index],actual=heard[index];
        const prefix=quantities(transcript.slice(0,actual.start));
        if (!wanted || wanted.unit!==actual.unit || wanted.forms && !wanted.forms.some(form=>exactQuantitySuffix(prefix,form))) {
          diverged=true;return;
        }
      }
      confirmed=heard.length;
    },
    get diverged(){return diverged;},
    get remaining(){return expected.length-confirmed;},
  };
}
