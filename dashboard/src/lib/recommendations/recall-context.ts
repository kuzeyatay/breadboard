import type { RecommendationEvidence } from './types.ts';
import { cleanRecommendationText as text } from './types.ts';
import { matchesEventTopic, topicWords } from './planning-context.ts';

export function recallTopicQuery(title: string): string {
  return topicWords(title).slice(0,4).join(' ');
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
    const relatedIds=calendar.filter(event=>event.calendar?.kind==='event' && event.calendar.status!=='recently-ended' && matchesEventTopic(event.title,title,summary)).map(event=>event.id).slice(0,2);
    groups.set(key,{id:`recall-topic:${fingerprint(key)}`,source:'recall',title,summary:`Recently viewed, not necessarily unfinished: ${summary}`,
      timestamp:hit.timestamp??undefined,relatedIds});
  }
  return [...groups.values()].sort((a,b)=>Number(Boolean(b.relatedIds?.length))-Number(Boolean(a.relatedIds?.length))).slice(0,8);
}
