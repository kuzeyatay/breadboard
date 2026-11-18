import { screenTimeRecommendationEvidence } from "../screen-time/recommendations.ts";
import 'server-only';
import db from '../db.ts';
import { listComposioConnections } from '../composio/service.ts';
import { composioClient } from '../composio/client.ts';
import { listStoredNangoConnections } from '../nango/service.ts';
import { findNangoIntegration } from '../nango/catalog.ts';
import { embeddedProviderRequest } from '../connected-apps/broker.ts';
import { getRecallSettings } from '../recall/settings.ts';
import { getRecallConfig } from '../recall/config.ts';
import { searchRecall } from '../recall/service.ts';
import { getCalendarStore } from '../calendar/instance.ts';
import { agenda } from '../calendar/agent-query.ts';
import { googleEventInput } from '../calendar/google-sync.ts';
import { collectRecommendationEvidence } from './collect.ts';
import { cleanRecommendationText as text, scopedRecommendationEvidence, type RecommendationContext, type RecommendationEvidence } from './types.ts';
import type { ConnectedAppProxyRequest } from '../connected-apps/types.ts';
import { calendarRecommendationEvidence } from './calendar-context.ts';
import { recallRecommendationEvidence, recallTopicQuery } from './recall-context.ts';
import { recommendationClock } from './clock.ts';
import { activityRecommendationEvidence, connectedAppName, connectionRecommendationEvidence } from './activity-context.ts';

/** Apps whose actual items are read below; every other connection is offered by name. */
const DEEP_READ_APPS = new Set(['gmail', 'microsoft-outlook', 'google-calendar']);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Narrow connected-mail lookup for a personal reference in a chat. */
export async function connectedContextEvidence(userId: number, query: string): Promise<RecommendationEvidence[]> {
  const { slugs, read } = await connectionReader(userId, AbortSignal.timeout(950));
  const terms = query.match(/[\p{L}\p{N}]{3,}/gu)?.filter(term => !/^(get|the|for|from|what|with|this|that|prepare|next|meeting|email|mail|find|about|message)$/i.test(term)).slice(0,5).join(" ") || "";
  const out: RecommendationEvidence[] = [];
  if (!terms) return [];
  await Promise.allSettled([
    slugs.has("gmail") && (async () => {
      const list = record(await read("gmail",{method:"GET",endpoint:"/gmail/v1/users/me/messages",query:{q:terms,maxResults:4}}));
      await Promise.all(array(list.messages).slice(0,4).map(async hit => {
        const id = text(record(hit).id,100);
        if (!id) return;
        const msg = record(await read("gmail",{method:"GET",endpoint:"/gmail/v1/users/me/messages/"+encodeURIComponent(id),query:{format:"metadata",fields:"snippet,payload(headers),internalDate"}}));
        const headers = array(record(msg.payload).headers).map(record);
        out.push({source:"gmail",id:"gmail:"+id,title:text(headers.find(h=>h.name==="Subject")?.value,150),summary:text(msg.snippet,250),timestamp:new Date(Number(msg.internalDate)).toISOString()});
      }));
    })(),
    slugs.has("microsoft-outlook") && (async () => {
      const list=record(await read("microsoft-outlook",{method:"GET",endpoint:"/v1.0/me/messages",query:{$search:'"'+terms+'"',$top:4,$select:"id,subject,bodyPreview,receivedDateTime"}}));
      for(const row of array(list.value).map(record)) out.push({source:"outlook",id:"outlook:"+text(row.id),title:text(row.subject),summary:text(row.bodyPreview,250),timestamp:text(row.receivedDateTime)});
    })(),
  ]);
  return out;
}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

type ConnectedRead = (slug: string, request: ConnectedAppProxyRequest) => Promise<unknown>;

function hasCalendarPart(payload: Record<string, unknown>): boolean {
  return /^(?:text\/calendar|application\/ics)(?:;|$)/i.test(text(payload.mimeType)) || /\.ics$/i.test(text(payload.filename)) ||
    array(payload.parts).some(part => hasCalendarPart(record(part)));
}

async function connectionReader(userId: number, signal: AbortSignal) {
  const [remote, local] = await Promise.allSettled([
    listComposioConnections(userId, signal), Promise.resolve().then(() => listStoredNangoConnections(userId)),
  ]);
  const composio = remote.status === 'fulfilled' ? remote.value : [];
  const embedded = local.status === 'fulfilled' ? local.value : [];
  const slugs = new Set([...composio, ...embedded].filter(item => item.enabled).map(item => item.slug));
  const apps = [...slugs].map(slug => ({ slug, name: findNangoIntegration(slug)?.name || connectedAppName(slug) }));
  const read: ConnectedRead = async (slug, request) => {
    signal.throwIfAborted();
    if (request.method !== 'GET') throw new Error('Recommendations only read connected apps.');
    const connection = composio.find(item => item.slug === slug && item.enabled);
    if (connection) {
      const result = await composioClient().tools.proxyExecute({
        connectedAccountId: connection.connectionId,
        endpoint: slug === 'google-calendar' ? `https://www.googleapis.com${request.endpoint}` : request.endpoint,
        method: 'GET',
        parameters: Object.entries(request.query ?? {}).filter(([, value]) => value !== undefined)
          .map(([name, value]) => ({ in: 'query' as const, name, value: String(value) })),
      }, { signal });
      if (result.status < 200 || result.status >= 300) throw new Error('Connection unavailable');
      return result.data;
    }
    const local = embedded.find(item => item.slug === slug && item.enabled);
    const integration = local && findNangoIntegration(local.integrationId);
    if (!integration) throw new Error('Connection unavailable');
    return embeddedProviderRequest({ userId, integration, request, signal });
  };
  return { slugs, apps, read };
}

async function gmail(read: ConnectedRead): Promise<RecommendationEvidence[]> {
  // Keep a busy inbox or a stream of invitations from crowding out an
  // archived booking or a personal request. Share the same ten detail reads.
  const searches = [
    'newer_than:60d {category:reservations subject:itinerary subject:booking subject:reservation subject:boarding}',
    'in:inbox category:primary newer_than:14d',
    'newer_than:60d {filename:ics subject:deadline subject:registration subject:interview subject:invitation subject:appointment subject:agenda subject:rescheduled}',
    'in:inbox newer_than:14d',
  ];
  const lists = await Promise.allSettled(searches.map(q => read('gmail', { method: 'GET', endpoint: '/gmail/v1/users/me/messages',
    query: { q: `${q} -category:promotions -category:social -in:sent`, maxResults: 5, fields: 'messages(id,threadId)' } })));
  const groups = lists.map(list => list.status === 'fulfilled' ? array(record(list.value).messages).slice(0, 5).map(record) : []);
  const threads = new Set<string>();
  const ids: string[] = [];
  for (let i = 0; i < 5 && ids.length < 10; i++) {
    for (const group of groups) {
      const entry = group[i];
      const id = text(entry?.id, 200), thread = text(entry?.threadId, 200) || id;
      if (id && !threads.has(thread)) { threads.add(thread); ids.push(id); }
      if (ids.length === 10) break;
    }
  }
  const rows = await Promise.allSettled(ids.map(async id => {
    const message = record(await read('gmail', { method: 'GET', endpoint: `/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
      query: { format: 'full', fields: 'snippet,payload(headers,mimeType,filename,parts(mimeType,filename,parts(mimeType,filename)))' } }));
    const payload = record(message.payload);
    const headers = array(payload.headers).map(record);
    const header = (name: string) => text(headers.find(item => String(item.name).toLowerCase() === name)?.value, 180);
    return { id: `gmail:${id}`, source: 'gmail' as const, title: header('subject'),
      sender: header('from'), summary: text(message.snippet, 600), timestamp: header('date'),
      calendarAttachment: hasCalendarPart(payload) || undefined };
  }));
  return rows.flatMap(row => row.status === 'fulfilled' && row.value ? [row.value] : []);
}

async function outlook(read: ConnectedRead): Promise<RecommendationEvidence[]> {
  const data = record(await read('microsoft-outlook', { method: 'GET', endpoint: '/v1.0/me/mailFolders/inbox/messages', query: {
    $top: 5, $orderby: 'receivedDateTime desc',
    $filter: `receivedDateTime ge ${new Date(Date.now() - 7 * 86400_000).toISOString()}`,
    $select: 'id,subject,from,bodyPreview,receivedDateTime',
  } }));
  return array(data.value).slice(0, 5).map(record).filter(item => text(item.id)).map(item => ({
    id: `outlook:${text(item.id)}`, source: 'outlook', title: text(item.subject),
    sender: text(record(record(item.from).emailAddress).address || record(record(item.from).emailAddress).name, 180),
    summary: text(item.bodyPreview, 600),
    timestamp: text(item.receivedDateTime),
  }));
}

const CALENDAR_DAYS = 21;

async function googleCalendar(read: ConnectedRead, context: RecommendationContext, calendarId = 'primary'): Promise<RecommendationEvidence[]> {
  const timeZone = context.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = `${context.localDate}T${context.localTime}`;
  const data = record(await read('google-calendar', { method: 'GET', endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, query: {
    timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + CALENDAR_DAYS * 86400_000).toISOString(),
    maxResults: 100, singleEvents: true, orderBy: 'startTime', timeZone,
    fields: 'items(id,status,summary,description,location,start,end,eventType,transparency,recurringEventId)',
  } }));
  return array(data.items).slice(0, 100).flatMap((raw): RecommendationEvidence[] => {
    const item = record(raw);
    if (!text(item.summary) || item.eventType === 'workingLocation') return [];
    try {
      const event = googleEventInput(item, 0, timeZone);
      if (!event || event.endsAt <= now) return [];
      return [{ id: `google-calendar:${calendarId === 'primary' ? '' : encodeURIComponent(calendarId) + ':'}${item.id}`, source: 'calendar', title: event.title, timestamp: event.startsAt,
        summary: text(event.description, 600),
        calendar: { kind: 'event', start: event.startsAt, end: event.endsAt, allDay: event.allDay,
          location: text(event.location, 180) || undefined,
          blocksTime: item.transparency === 'transparent' || item.eventType === 'birthday' ? false :
            item.transparency === 'opaque' || item.eventType === 'outOfOffice' || item.eventType === 'focusTime' ? true : undefined,
          seriesId: item.recurringEventId ? `google:${calendarId}:${item.recurringEventId}` : undefined,
          status: event.startsAt <= now ? 'ongoing' : 'upcoming' } }];
    } catch { return []; } // One malformed instance must not discard the rest of the agenda.
  });
}

function localEvidence(userId: number, context: RecommendationContext): RecommendationEvidence[] {
  const result: RecommendationEvidence[] = [];
  const safeRead = (read: () => RecommendationEvidence[]) => { try { result.push(...read()); } catch { /* Optional store not initialized. */ } };
  safeRead(() => {
    const rows = db.prepare(`SELECT c.id, c.public_id, c.title, c.updated_at, g.slug, substr(u.content, 1, 300) AS asked, substr(a.content, 1, 500) AS excerpt
      FROM conversations c LEFT JOIN clusters g ON g.id=c.default_garden_id
      JOIN conversation_messages u ON u.rowid=(SELECT m.rowid FROM conversation_messages m
        WHERE m.conversation_id=c.id AND m.role='user' AND m.status='complete' AND trim(substr(m.content, 1, 300))<>''
        AND COALESCE(m.client_message_id,'') NOT GLOB 'schedule-*'
        AND COALESCE(m.client_message_id,'') NOT GLOB 'hook-*'
        AND json_extract(CASE WHEN json_valid(m.metadata) THEN m.metadata END,'$.scheduledChatReceipt') IS NULL
        ORDER BY m.order_index DESC LIMIT 1)
      LEFT JOIN conversation_messages a ON a.conversation_id=c.id AND a.client_message_id=u.client_message_id
        AND a.role='assistant' AND a.status='complete'
      WHERE c.user_id=? AND c.temporary=0 AND c.title<>'New chat' AND c.updated_at >= datetime('now','-21 days')
      AND (? IS NULL OR g.slug=?) ORDER BY c.updated_at DESC LIMIT 5`).all(userId, context.gardenSlug ?? null, context.gardenSlug ?? null) as Array<{id:number;public_id:string;title:string;updated_at:string;slug:string;asked:string;excerpt:string|null}>;
    return rows.map(row => ({ id:`chat:${row.id}`,source:'chat',conversationId:row.public_id,
      title:/^(?:Telegram|WhatsApp)\s*[·:]/i.test(row.title) ? row.asked : row.title,
      summary:[`Last asked: ${row.asked}`,row.excerpt&&`Last reply: ${row.excerpt}`].filter(Boolean).join(' '),timestamp:row.updated_at,gardenSlug:row.slug }));
  });
  if (!context.gardenSlug) safeRead(() => {
    const rows = db.prepare(`SELECT t.id,t.title,t.description,t.due_date,p.name FROM plan_tasks t JOIN plan_projects p ON p.id=t.project_id
      WHERE t.user_id=? AND p.user_id=? AND p.archived=0 AND t.completed_at IS NULL
      ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,t.due_date,t.updated_at DESC LIMIT 4`).all(userId,userId) as Array<{id:number;title:string;description:string;due_date:string;name:string}>;
    return rows.map(row => ({ id:`task:${row.id}`,source:'task',title:row.title,summary:`Project: ${row.name}. ${row.due_date ? `Due ${row.due_date}.` : ''} ${row.description ?? ''}` }));
  });
  if (context.gardenSlug) safeRead(() => {
    const row = db.prepare('SELECT id,name,slug FROM clusters WHERE user_id=? AND slug=?')
      .get(userId, context.gardenSlug) as {id:number;name:string;slug:string} | undefined;
    return row ? [{ id:`garden:${row.id}`,source:'garden',title:row.name,summary:'Selected garden.',gardenSlug:row.slug }] : [];
  });
  if (!context.gardenSlug) safeRead(() => activityRecommendationEvidence(db, userId));
  return result;
}

export async function readRecommendationEvidence(userId: number, context: RecommendationContext): Promise<RecommendationEvidence[]> {
  context = recommendationClock(context);
  // These account-wide providers have no explicit garden membership. Do not
  // query them in a garden, including unscoped OCR captures and calendar gaps.
  if (context.gardenSlug) return collectRecommendationEvidence([
    async () => scopedRecommendationEvidence(localEvidence(userId, context), context),
  ]);
  let calendar: RecommendationEvidence[] = [];
  try {
    const schedule = agenda(getCalendarStore(), userId, { from: context.localDate, days: CALENDAR_DAYS, limit: 200, includeDescriptions:true });
    calendar = calendarRecommendationEvidence(schedule.occurrences, context, schedule.returned === schedule.total);
  } catch { /* Calendar setup or sync must not prevent other suggestions. */ }
  const signal = AbortSignal.timeout(8_000);
  const connections = connectionReader(userId, signal);
  const connected = (slug: string, load: (read: ConnectedRead) => Promise<RecommendationEvidence[]>) => async () => {
    const { slugs, read } = await connections;
    return slugs.has(slug) ? load(read) : [];
  };
  return collectRecommendationEvidence([
    async () => [...calendar, ...localEvidence(userId, context)],
    async () => screenTimeRecommendationEvidence(userId),
    async () => {
      const settings = getRecallSettings(userId);
      const config = getRecallConfig();
      if (!config.enabled || !settings.captureEnabled || !settings.agentAccess) return [];
      const topics = [...new Set([context.pageTitle,
        ...calendar.filter(item => item.calendar?.kind==='event' && item.calendar.status==='upcoming').map(item=>recallTopicQuery(item.title)),
      ].filter((query): query is string => Boolean(query)))].slice(0,2);
      const reads = await Promise.allSettled([undefined, ...topics].map(query => searchRecall(userId,
        { limit: query ? 4 : 15, contentType:'screen', ...(query ? {query} : {}) },
        { forAgent:true, config:{...config,requestTimeoutMs:3_000} })));
      return recallRecommendationEvidence(reads.flatMap(read=>read.status==='fulfilled'?read.value.hits:[]),calendar);
    },
    async () => {
      const { apps } = await connections;
      let mcp: Array<{ slug: string; name: string }> = [];
      try {
        mcp = (db.prepare('SELECT slug, display_name FROM hermes_mcp_connections WHERE user_id = ? AND enabled = 1').all(userId) as Array<{ slug: string; display_name: string | null }>)
          .map(row => ({ slug: row.slug, name: row.display_name || connectedAppName(row.slug) }));
      } catch { /* MCP store optional. */ }
      return connectionRecommendationEvidence([...apps, ...mcp], DEEP_READ_APPS);
    },
    connected('gmail', gmail),
    connected('microsoft-outlook', outlook),
    connected('google-calendar', read => googleCalendar(read, context)),
    connected('google-calendar', async read => {
      const list = record(await read('google-calendar', { method: 'GET', endpoint: '/calendar/v3/users/me/calendarList',
        query: { minAccessRole: 'reader', fields: 'items(id,primary,selected,hidden,deleted)' } }));
      const selected = array(list.items).map(record).filter(item =>
        text(item.id) && item.selected === true && !item.primary && !item.hidden && !item.deleted).slice(0, 3);
      const calendars = await Promise.allSettled(selected.map(item => googleCalendar(read, context, String(item.id))));
      return calendars.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    }),
  ]);
}
