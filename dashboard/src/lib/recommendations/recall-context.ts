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

type RecallFrame = {frameId?:number|null;window?:string|null;app?:string|null;text:string;timestamp?:string|null};

/** Adjacent screen frames are one activity, not five different next steps. */
export function recallRecommendationEvidence(hits: readonly RecallFrame[], calendar: readonly RecommendationEvidence[]): RecommendationEvidence[] {
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

/** Breadboard also hosts non-web views, so recognize its pages by their recorded visit titles. */
export function webRecallEvidence(hits: readonly RecallFrame[], visitedTitles: readonly string[]): RecommendationEvidence[] {
  const known = new Set(visitedTitles.map(title => title.trim().toLowerCase()));
  const browserApp = /^(?:google chrome|chrome|chromium|microsoft edge|msedge|mozilla firefox|firefox|safari|brave(?: browser)?|vivaldi|opera|arc)(?:\.exe)?$/i;
  const browserSuffix = /\s+[-–—|]\s+(?:Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Safari|Vivaldi|Opera|Breadboard)$/i;
  const pages = hits.flatMap(hit => {
    const window = hit.window?.trim() ?? '';
    if (!window || /^Private\s+—|\b(?:inprivate|incognito|private browsing)\b/i.test(window)) return [];
    const page = window.replace(browserSuffix, '').trim();
    const app = hit.app?.trim() ?? '';
    const breadboardVisit = /\b(?:breadboard|electron)\b/i.test(app) && known.has(page.toLowerCase());
    if (!browserApp.test(app) && !breadboardVisit) return [];
    const title = page.replace(/\s+-\s+(?:Google Search|Bing)$/i, '').trim();
    if (!title || /^(?:new tab|home|settings|downloads|history|about:blank)$/i.test(title)) return [];
    return [{ ...hit, window: title }];
  });
  return recallRecommendationEvidence(pages, []);
}
