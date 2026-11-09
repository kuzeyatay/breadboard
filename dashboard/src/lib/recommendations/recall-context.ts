import type { RecommendationEvidence } from './types.ts';
import { cleanRecommendationText as text } from './types.ts';

const COMMON = new Set('the and for with from this that meeting review notes work browser breadboard microsoft chrome google edge new tab home calendar today tomorrow lecture session lesson'.split(' '));
export function topicWords(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(word => !COMMON.has(word));
}
export function recallTopicQuery(title: string): string {
  return topicWords(title).slice(0,4).join(' ');
}
function matchesTopic(hit: {title:string;summary:string}, event: RecommendationEvidence) {
  const wanted=topicWords(event.title);
  const found=new Set(topicWords(`${hit.title} ${hit.summary}`));
  const matches=wanted.filter(word=>found.has(word));
  return matches.length>=2 || matches.some(word=>word.length>=7) || (wanted.length===1 && matches.length===1);
}
function fingerprint(value: string) {
  let hash=2166136261;
  for(const char of value) hash=Math.imul(hash^char.charCodeAt(0),16777619);
  return (hash>>>0).toString(36);
}

/** Adjacent screen frames are one activity, not five different next steps. */
export function recallRecommendationEvidence(hits: readonly {frameId?:number|null;window?:string|null;app?:string|null;text:string;timestamp?:string|null}[], calendar: readonly RecommendationEvidence[]): RecommendationEvidence[] {
  const groups=new Map<string,RecommendationEvidence>();
  for(const hit of [...hits].sort((a,b)=>(b.timestamp??'').localeCompare(a.timestamp??''))) {
    const title=text(hit.window || hit.app,180);
    if(!title || /^(new tab|new chat|home|desktop|microsoft edge|google chrome|breadboard)$/i.test(title)) continue;
    const key=`${text(hit.app).toLowerCase()}:${title.toLowerCase()}`;
    if(groups.has(key)) continue;
    const summary=text(hit.text,700);
    if(!summary) continue;
    const relatedIds=calendar.filter(event=>event.calendar?.kind==='event' && event.calendar.status!=='recently-ended' && matchesTopic({title,summary},event)).map(event=>event.id).slice(0,2);
    groups.set(key,{id:`recall-topic:${fingerprint(key)}`,source:'recall',title,summary:`Recently viewed, not necessarily unfinished: ${summary}`,
      timestamp:hit.timestamp??undefined,relatedIds});
  }
  return [...groups.values()].sort((a,b)=>Number(Boolean(b.relatedIds?.length))-Number(Boolean(a.relatedIds?.length))).slice(0,8);
}
