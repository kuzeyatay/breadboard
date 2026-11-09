import { speechSentenceEnds } from './passages.ts';
import { numericSpeechScript } from './numeric-script.ts';
import { createTemperatureReadingGuard, temperatureWord } from './temperature-reading.ts';
import { createScriptGuard, type ScriptGuard } from './script-guard.ts';

// Deliberately conservative: grammar, fillers and a small dictionary of ordinary
// equivalents may vary. Unrecognized content words are not silently discarded.
// This is a local reading check, not a general semantic-equivalence model.
// A single nonlexical acknowledgement is permitted only before the reading.
// Keep mm-mm, yes/no, repeats and mid-answer sounds in the content check.
const LEADING_VOCAL_ACK = /^\s*mm-hmm(?=$|[\s.!?,;:])(?:[.!?,;:]*\s*)/iu;
const GRAMMAR = new Set('a an the uh um er please'.split(' '));
const EQUIVALENTS: Record<string, string> = {
  hi:'hello',hey:'hello',hiya:'hello',yeah:'yes',yep:'yes',yup:'yes',ok:'okay',alright:'okay',
  thanks:'thank',responses:'answers',response:'answer',reply:'answer',replies:'answers',
  begin:'start',begins:'starts',began:'started',beginning:'starting',
  choose:'select',choosing:'selecting',chose:'selected',pick:'select',picked:'selected',
  require:'need',requires:'needs',required:'needed',
  assist:'help',assistance:'help',
  finish:'complete',finished:'completed',done:'completed',
  negative:'minus',centigrade:'celsius',dollars:'dollar',euros:'euro',pounds:'pound',cents:'cent',
};
const CONTRACTIONS: Record<string, string[]> = {
  im:['i','am'],youre:['you','are'],were:['we','are'],theyre:['they','are'],
  its:['it','is'],thats:['that','is'],theres:['there','is'],heres:['here','is'],whats:['what','is'],
  ive:['i','have'],youve:['you','have'],weve:['we','have'],theyve:['they','have'],
  ill:['i','will'],youll:['you','will'],well:['we','will'],theyll:['they','will'],itll:['it','will'],
  cant:['can','not'],cannot:['can','not'],wont:['will','not'],dont:['do','not'],doesnt:['does','not'],
  didnt:['did','not'],isnt:['is','not'],arent:['are','not'],wasnt:['was','not'],werent:['were','not'],
  hasnt:['has','not'],havent:['have','not'],hadnt:['had','not'],shouldnt:['should','not'],
  wouldnt:['would','not'],couldnt:['could','not'],mustnt:['must','not'],
};
const NUMBER_WORDS = new Set('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion point plus minus'.split(' '));
const NEGATION = new Set(['no','not','never','without','neither']);
const TEMPERATURE_UNITS = new Set(['celsius','fahrenheit']);
const APPROXIMATE_QUANTITY = new Set(['about','around','near','approximately','roughly']);
const WORD = /[+−-]?\d+(?:,\d{3})*(?:\.\d+)?|[℃℉$€£%–—]|[\p{L}]+(?:['’][\p{L}]+)*/gu;
type Token = { word: string; start: number; end: number; capital: boolean };

/** Spoken lists can share an explicit temperature unit: "eleven degrees
 * Celsius and five", or "eleven and five degrees Celsius". Only allow this
 * within one sentence, with one unit type and no unrelated quantities. */
function temperatureCoordination(content: Token[]) {
  const units=content.flatMap((token,index)=>TEMPERATURE_UNITS.has(token.word)?[index]:[]);
  const quantityStarts=new Set<number>(),quantitySlots=new Set<number>();
  for(const unit of units){
    let first=unit;
    while(first>0&&(NUMBER_WORDS.has(content[first-1].word)||['to','through'].includes(content[first-1].word)))first--;
    if(first===unit)continue;
    quantityStarts.add(first);
    for(let index=first;index<unit;index++)quantitySlots.add(index);
  }
  const shareable=units.length>1&&units.every(index=>content[index].word===content[units[0]].word)
    &&content.every((token,index)=>!NUMBER_WORDS.has(token.word)||quantitySlots.has(index))
    &&units.every(index=>quantitySlots.has(index-1));
  return {quantityStarts,optionalUnits:new Set(shareable?units:[])};
}

function tokens(text: string): Token[] {
  const result: Token[] = [];
  for (const match of text.matchAll(WORD)) {
    const original = match[0];
    const plain = original.normalize('NFKC').toLowerCase().replaceAll('’', "'");
    const unit = temperatureWord(text, original, match.index)
      ?? ({'$':'dollar','€':'euro','£':'pound','%':'percent'} as Record<string,string>)[original];
    if (/[–—]/u.test(original)) {
      if (/\d\s*$/u.test(text.slice(0,match.index)) && /^\s*[+−-]?\d/u.test(text.slice(match.index+1)))
        result.push({word:'to',start:match.index,end:match.index+1,capital:false});
      continue;
    }
    if (/^degrees?$/u.test(plain) && /^\s+(?:celsius|centigrade|fahrenheit)\b/iu.test(text.slice(match.index+original.length))) continue;
    let contraction = plain.includes("'") || !['its','ill','well','were'].includes(plain)
      ? CONTRACTIONS[plain.replaceAll("'",'')] : undefined;
    if (plain==="it's" && /^\s+(?:been|got)\b/iu.test(text.slice(match.index+original.length))) contraction=['it','has'];
    const range = plain.startsWith('-') && /\d$/u.test(text.slice(0,match.index));
    const words = contraction ?? (unit ? [unit] : /^[+−-]?\d/u.test(plain)
      ? [...(range?['to']:[]),...numericSpeechScript((range?plain.slice(1):plain).replace('−','-'),'en').split(/\s+/u)]
      : [plain.replaceAll("'",'')]);
    for (const value of words) result.push({ word:EQUIVALENTS[value] ?? value,
      start:match.index,end:match.index+original.length,capital:/^\p{Lu}/u.test(original) });
  }
  const normalized: Token[] = [];
  for (let index=0;index<result.length;index++) {
    const item=result[index],next=result[index+1];
    if (['dollar','euro','pound'].includes(item.word) && next && NUMBER_WORDS.has(next.word)) {
      let end=index+1;
      while(result[end] && NUMBER_WORDS.has(result[end].word)) end++;
      normalized.push(...result.slice(index+1,end),{...item,end:result[end-1].end});index=end-1;continue;
    }
    if(item.word==='would' && next && ['i','you','we','they','he','she'].includes(next.word) && result[index+2]?.word==='like') {
      normalized.push({...item,word:'do'},next,{...item,word:'want',end:result[index+2].end});index+=2;continue;
    }
    if ((item.word==='would' && next?.word==='like') || (item.word==='all' && next?.word==='set')) {
      normalized.push({...item,word:item.word==='would'?'want':'ready',end:next.end});index++;continue;
    }
    if (item.word==='go' && next?.word==='ahead' && result[index+2]?.word==='and') {index+=2;continue;}
    if (item.word==='every' && next && ['last','single'].includes(next.word)) {
      normalized.push({...item,end:next.end});index++;continue;
    }
    if (item.word==='right' && next?.word==='now') continue;
    if (!GRAMMAR.has(item.word)) normalized.push(item);
  }
  return normalized;
}

/** Small conversational rewrites may change grammatical wording and fillers.
 * Each sentence's content must still be represented in the original order.
 * Quantities, entities and negation retain their order and association. Strict
 * read-aloud, downloads and unsupported languages retain the existing guard. */
export function createConversationReadingGuard(script: string, language='en'): ScriptGuard & {feed(text:string,final?:boolean):void} {
  if (!/^en(?:-|$)/i.test(language)) return createScriptGuard(script,{lookahead:1,tolerance:3,language});
  const ends = [...speechSentenceEnds(script)];
  if (ends.at(-1)!==script.length) ends.push(script.length);
  let start=0;
  const sentences=ends.map(end=>{
    const text=script.slice(start,end),offset=start;start=end;
    const content=tokens(text).map(item=>({...item,start:item.start+offset,end:item.end+offset}));
    return {start:offset+(text.match(/^\s*/u)?.[0].length??0),end,content,...temperatureCoordination(content)};
  }).filter(sentence=>sentence.content.length);
  const expected=sentences.flatMap(sentence=>sentence.content);
  if(!expected.length) return createScriptGuard(script,{lookahead:1,tolerance:3,language});
  const quantityOrder=expected.filter(item=>NUMBER_WORDS.has(item.word)).map(item=>item.word);
  const entityWords=new Set(expected.filter(item=>item.capital && !NUMBER_WORDS.has(item.word)
    && !Object.values(EQUIVALENTS).includes(item.word)).map(item=>item.word));
  const entityOrder=expected.filter(item=>entityWords.has(item.word)).map(item=>item.word);
  const negations=(items:Token[])=>items.flatMap((item,index)=>NEGATION.has(item.word)
    ? [item.word+':'+(items[index+1]?.word??'')] : []);
  const negativeOrder=negations(expected);
  const temperatures=createTemperatureReadingGuard(script,language);
  let diverged=false,position=0,resumeAt=sentences[0]?.start??0,remaining=expected.length,complete=false;
  const prefix=(actual:string[],wanted:string[])=>actual.every((word,index)=>word===wanted[index]);
  return {
    feed(transcript,final=false) {
      if (diverged) return;
      const vocalAcknowledgement = !LEADING_VOCAL_ACK.test(script) && LEADING_VOCAL_ACK.test(transcript);
      if (vocalAcknowledgement) transcript=transcript.replace(LEADING_VOCAL_ACK,'');
      // Do not evaluate a partially streamed word, number or contraction.
      const stable=final || !/[\p{L}\p{N}]$/u.test(transcript)
        ? transcript : transcript.slice(0,[...transcript.matchAll(WORD)].at(-1)?.index??0);
      const heard=tokens(stable);
      const checked:Token[]=[];
      const explicitUnits=new Set<number>();
      let sentenceIndex=0,matched=new Set<number>(),unknown=0,consecutiveUnknown=0;
      const sameWord=(sentence:typeof sentences[number],slot:number,word:string)=>sentence.content[slot]?.word===word
        || (APPROXIMATE_QUANTITY.has(word)&&APPROXIMATE_QUANTITY.has(sentence.content[slot]?.word??'')
          &&sentence.quantityStarts.has(slot+1));
      for (let index=0;index<heard.length;index++) {
        const word=heard[index].word;
        let sentence=sentences[sentenceIndex];
        // A single acknowledgement is conversational scaffolding, not an
        // answer. It never confirms any sentence or advances its recovery point.
        if (index===0 && word==='okay' && sentence?.content[0]?.word!=='okay' && !vocalAcknowledgement) continue;
        if (!sentence) {checked.push(heard[index]);unknown++;consecutiveUnknown++;continue;}
        let next=sentence.content.findIndex((_,slot)=>!matched.has(slot));
        const atSentenceEnd=next===sentence.content.length-1;
        const nextSentence=sentences[sentenceIndex+1];
        const canShareUnit=()=>explicitUnits.has(sentenceIndex)||[...sentence.optionalUnits].some(slot=>slot>next);
        if(sentence.optionalUnits.has(next)&&word!==sentence.content[next].word
          &&canShareUnit()
          &&(sameWord(sentence,next+1,word)||(atSentenceEnd&&explicitUnits.has(sentenceIndex)
            &&nextSentence&&sameWord(nextSentence,0,word)))){
          // An omitted repeated unit needs an explicit unit in this same
          // sentence before the sentence can be credited as complete.
          checked.push({...heard[index],word:sentence.content[next].word});matched.add(next);next++;
          if(atSentenceEnd){sentence=sentences[++sentenceIndex];matched=new Set();next=0;}
        }
        // "Eleven degrees Celsius and five degrees" keeps the stated scale.
        // A bare degree never supplies evidence of a scale by itself.
        const repeatedDegree=['degree','degrees'].includes(word)&&sentence.optionalUnits.has(next)&&canShareUnit();
        const found=sameWord(sentence,next,word)||repeatedDegree?next:-1;
        checked.push(found<0?heard[index]:{...heard[index],word:sentence.content[found].word});
        if(found<0) {unknown++;consecutiveUnknown++;}
        else {
          if(TEMPERATURE_UNITS.has(word))explicitUnits.add(sentenceIndex);
          matched.add(found);consecutiveUnknown=0;
        }
        if(matched.size===sentence.content.length) {sentenceIndex++;matched=new Set();}
        if(consecutiveUnknown>=3) break;
      }
      const last=sentences[sentenceIndex];
      const finalSlot=last?last.content.length-1:-1;
      if(last&&matched.size===finalSlot&&last.optionalUnits.has(finalSlot)
        &&!matched.has(finalSlot)&&explicitUnits.has(sentenceIndex)
        &&(final||/[.!?]/u.test(stable.slice(heard.at(-1)?.end??0)))){
        checked.push(last.content[finalSlot]);sentenceIndex++;matched=new Set();
      }
      // Validate quantities and their units against the expanded coordination,
      // requiring at least one explicit unit and rejecting mixed/wrong units. The
      // content matcher still requires every other word in its original order.
      temperatures.feed(checked.map(item=>item.word).join(' ')+' ');
      const numbers=checked.filter(item=>NUMBER_WORDS.has(item.word)).map(item=>item.word);
      const entities=checked.filter(item=>entityWords.has(item.word)).map(item=>item.word);
      const negative=negations(final?checked:checked.slice(0,checked.at(-1)&&NEGATION.has(checked.at(-1)!.word)?-1:undefined));
      const changedFact=temperatures.diverged || !prefix(numbers,quantityOrder) || !prefix(entities,entityOrder)
        || !prefix(negative,negativeOrder) || (!script.includes('?') && stable.includes('?'));
      const current=sentences[sentenceIndex];
      const firstMissing=current?.content.findIndex((_,index)=>!matched.has(index))??-1;
      position=current ? (firstMissing>0?current.content[firstMissing-1].end:current.start) : script.length;
      resumeAt=current?.start??script.length;
      remaining=(current?.content.length??0)-matched.size+
        sentences.slice(sentenceIndex+1).reduce((sum,sentence)=>sum+sentence.content.length,0);
      remaining=Math.max(remaining,temperatures.remaining);
      complete=remaining===0 && unknown===0 && heard.length>0;
      // Grammar-only differences do not retire a warm reader. Unknown content
      // must still fail: do not interpret a loose overlap score as correctness.
      if(changedFact || consecutiveUnknown>=3 || (final && unknown>0)) diverged=true;
    },
    get diverged(){return diverged;},get position(){return position;},get resumeAt(){return resumeAt;},
    get remainingWords(){return remaining;},get complete(){return complete;},
  };
}
