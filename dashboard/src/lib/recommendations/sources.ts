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
import { collectRecommendationEvidence } from './collect.ts';
import { cleanRecommendationText as text, type RecommendationContext, type RecommendationEvidence } from './types.ts';
import type { ConnectedAppProxyRequest } from '../connected-apps/types.ts';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

type ConnectedRead = (slug: string, request: ConnectedAppProxyRequest) => Promise<unknown>;

async function connectionReader(userId: number, signal: AbortSignal) {
  const [remote, local] = await Promise.allSettled([
    listComposioConnections(userId, signal), Promise.resolve().then(() => listStoredNangoConnections(userId)),
  ]);
  const composio = remote.status === 'fulfilled' ? remote.value : [];
  const embedded = local.status === 'fulfilled' ? local.value : [];
  const slugs = new Set([...composio, ...embedded].filter(item => item.enabled).map(item => item.slug));
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
  return { slugs, read };
}

async function gmail(read: ConnectedRead): Promise<RecommendationEvidence[]> {
  const list = record(await read('gmail', { method: 'GET', endpoint: '/gmail/v1/users/me/messages',
    query: { q: 'in:inbox newer_than:7d -category:promotions -category:social', maxResults: 5 } }));
  const rows = await Promise.allSettled(array(list.messages).slice(0, 5).map(async entry => {
    const id = text(record(entry).id, 200);
    if (!id) return null;
    const message = record(await read('gmail', { method: 'GET', endpoint: `/gmail/v1/users/me/messages/${encodeURIComponent(id)}`, query: { format: 'metadata' } }));
    const headers = array(record(message.payload).headers).map(record);
    const header = (name: string) => text(headers.find(item => String(item.name).toLowerCase() === name)?.value, 180);
    return { id: `gmail:${id}`, source: 'gmail' as const, title: header('subject'),
      summary: `From: ${header('from')}. ${text(message.snippet, 600)}`, timestamp: header('date') };
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
    summary: `From: ${text(record(record(item.from).emailAddress).name)}. ${text(item.bodyPreview, 600)}`,
    timestamp: text(item.receivedDateTime),
  }));
}

async function googleCalendar(read: ConnectedRead): Promise<RecommendationEvidence[]> {
  const data = record(await read('google-calendar', { method: 'GET', endpoint: '/calendar/v3/calendars/primary/events', query: {
    timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + 3 * 86400_000).toISOString(),
    maxResults: 5, singleEvents: true, orderBy: 'startTime',
  } }));
  return array(data.items).slice(0, 5).map(record).filter(item => item.status !== 'cancelled').map(item => ({
    id: `google-calendar:${text(item.id)}`, source: 'calendar', title: text(item.summary),
    summary: `Starts ${text(record(item.start).dateTime || record(item.start).date)}. ${text(item.description, 500)}`,
    timestamp: text(record(item.start).dateTime || record(item.start).date),
  }));
}

function localEvidence(userId: number, context: RecommendationContext): RecommendationEvidence[] {
  const result: RecommendationEvidence[] = [];
  const safeRead = (read: () => RecommendationEvidence[]) => { try { result.push(...read()); } catch { /* Optional store not initialized. */ } };
  safeRead(() => {
    const rows = db.prepare(`SELECT c.id, c.title, c.updated_at, g.slug,
      (SELECT substr(m.content, 1, 800) FROM conversation_messages m WHERE m.conversation_id=c.id AND m.status='complete' ORDER BY m.order_index DESC LIMIT 1) AS excerpt
      FROM conversations c LEFT JOIN clusters g ON g.id=c.default_garden_id
      WHERE c.user_id=? AND c.temporary=0 AND c.title<>'New chat' AND c.updated_at >= datetime('now','-14 days')
      AND (? IS NULL OR g.slug=?) ORDER BY c.updated_at DESC LIMIT 4`).all(userId, context.gardenSlug ?? null, context.gardenSlug ?? null) as Array<{id:number;title:string;updated_at:string;slug:string;excerpt:string}>;
    return rows.map(row => ({ id:`chat:${row.id}`,source:'chat',title:row.title,summary:row.excerpt,timestamp:row.updated_at,gardenSlug:row.slug }));
  });
  safeRead(() => {
    const rows = db.prepare(`SELECT t.id,t.title,t.description,t.due_date,p.name FROM plan_tasks t JOIN plan_projects p ON p.id=t.project_id
      WHERE t.user_id=? AND p.user_id=? AND p.archived=0 AND t.completed_at IS NULL
      ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,t.due_date,t.updated_at DESC LIMIT 4`).all(userId,userId) as Array<{id:number;title:string;description:string;due_date:string;name:string}>;
    return rows.map(row => ({ id:`task:${row.id}`,source:'task',title:row.title,summary:`Project: ${row.name}. ${row.due_date ? `Due ${row.due_date}.` : ''} ${row.description ?? ''}` }));
  });
  safeRead(() => {
    const rows = db.prepare(`SELECT id,name,slug FROM clusters WHERE user_id=? AND (? IS NULL OR slug=?) ORDER BY COALESCE(last_viewed_at,created_at) DESC LIMIT 4`)
      .all(userId,context.gardenSlug ?? null,context.gardenSlug ?? null) as Array<{id:number;name:string;slug:string}>;
    return rows.map(row => ({ id:`garden:${row.id}`,source:'garden',title:row.name,summary:'A recently opened garden.',gardenSlug:row.slug }));
  });
  safeRead(() => agenda(getCalendarStore(), userId, { from: context.localDate, days: 3, limit: 4, includeDescriptions:true }).occurrences
    .map(event => ({ id:`calendar:${event.eventId}:${event.start}`,source:'calendar',title:event.title,summary:`Starts ${event.start}. ${event.description ?? ''}`,timestamp:event.start })));
  return result;
}

export async function readRecommendationEvidence(userId: number, context: RecommendationContext): Promise<RecommendationEvidence[]> {
  const signal = AbortSignal.timeout(8_000);
  return collectRecommendationEvidence([
    async () => localEvidence(userId, context),
    async () => {
      const settings = getRecallSettings(userId);
      const config = getRecallConfig();
      if (!config.enabled || !settings.captureEnabled || !settings.agentAccess) return [];
      const result = await searchRecall(userId, { limit: 5, contentType:'screen',
        ...(context.pageTitle ? { query: context.pageTitle } : {}),
      }, { forAgent: true, config: { ...config, requestTimeoutMs: 3_000 } });
      return result.hits.map((hit, index) => ({ id:`recall:${hit.frameId ?? index}:${hit.timestamp}`,source:'recall' as const,
        title:hit.window || hit.app || 'recent activity',summary:hit.text,timestamp:hit.timestamp ?? undefined }));
    },
    async () => {
      const { slugs, read } = await connectionReader(userId, signal);
      return collectRecommendationEvidence([
        async () => slugs.has('gmail') ? gmail(read) : [],
        async () => slugs.has('microsoft-outlook') ? outlook(read) : [],
        async () => slugs.has('google-calendar') ? googleCalendar(read) : [],
      ]);
    },
  ]);
}
