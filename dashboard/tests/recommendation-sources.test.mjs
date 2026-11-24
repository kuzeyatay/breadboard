import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import Database from 'better-sqlite3';
import { generateRecommendations } from './helpers/recommendation-model-fixture.mjs';
import { parseRecommendations, selectRecommendations } from '../src/lib/recommendations/types.ts';

const root=path.resolve(import.meta.dirname,'..');
async function bundle(file,mocks) {
  const built=await build({entryPoints:[path.join(root,file)],bundle:true,write:false,format:'cjs',platform:'node',
    plugins:[{name:'test-boundaries',setup(builder){
      builder.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));
    }}]});
  const module={exports:{}};
  new Function('module','exports','require',built.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));
  return module.exports;
}

const sources=await bundle('src/lib/recommendations/sources.ts',{
  '../personal-context/browser.ts':'export const browserVisitFacts=async()=>[{title:"Encoder calibration"}];',
  '../screen-time/recommendations.ts':'export const screenTimeRecommendationEvidence=()=>[];',
  'server-only':'',
  '../db.ts':'export default {prepare:sql=>globalThis.recFixture.db.prepare(sql)};',
  '../composio/service.ts':'export const listComposioConnections=async(userId)=>globalThis.recFixture.connections(userId);',
  '../composio/client.ts':'export const composioClient=()=>({tools:{proxyExecute:(request,options)=>globalThis.recFixture.read(request,options)}});',
  '../nango/service.ts':'export const listStoredNangoConnections=()=>[];',
  '../nango/catalog.ts':'export const findNangoIntegration=()=>null;',
  '../connected-apps/broker.ts':'export const embeddedProviderRequest=()=>{throw Error("No embedded account connected")};',
  '../recall/settings.ts':'export const getRecallSettings=()=>globalThis.recFixture.settings;',
  '../recall/config.ts':'export const getRecallConfig=()=>({enabled:true});',
  '../recall/service.ts':'export const searchRecall=(user,args,options)=>globalThis.recFixture.recall(user,args,options);',
  '../calendar/instance.ts':'export const getCalendarStore=()=>({});',
  '../calendar/agent-query.ts':'export const agenda=(store,user,args)=>{globalThis.recFixture.agendaCalls.push({user,args});return globalThis.recFixture.agenda;};',
});

function fixture(t) {
  const db=new Database(':memory:');t.after(()=>{db.close();delete globalThis.recFixture;});
  db.exec(`CREATE TABLE clusters(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,slug TEXT,last_viewed_at TEXT,created_at TEXT);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY,user_id INTEGER,title TEXT,default_garden_id INTEGER,temporary INTEGER,updated_at TEXT,public_id TEXT NOT NULL UNIQUE);
    CREATE TABLE conversation_messages(conversation_id INTEGER,content TEXT,status TEXT,order_index INTEGER,role TEXT NOT NULL DEFAULT 'assistant',client_message_id TEXT,metadata TEXT);
    CREATE TABLE plan_projects(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,archived INTEGER);
    CREATE TABLE plan_tasks(id INTEGER PRIMARY KEY,user_id INTEGER,project_id INTEGER,title TEXT,description TEXT,due_date TEXT,completed_at TEXT,updated_at TEXT);
    INSERT INTO plan_projects VALUES(1,1,'Circuits',0),(2,2,'Private project',0),(3,1,'Old project',1);
    INSERT INTO plan_tasks VALUES(1,1,1,'Build circuit simulation','Check damping',NULL,NULL,datetime('now')),
      (2,2,2,'Other task secret','',NULL,NULL,datetime('now')),
      (3,1,1,'Completed task','',NULL,datetime('now'),datetime('now')),
      (4,1,3,'Archived task','',NULL,NULL,datetime('now'));
    INSERT INTO clusters VALUES(1,1,'Circuits','circuits',datetime('now'),datetime('now')),(2,2,'Private other garden','secret',datetime('now'),datetime('now'));
    INSERT INTO conversations VALUES(1,1,'My lab notes',1,0,datetime('now'),'conv_lab'),(2,2,'Other user secret',2,0,datetime('now'),'conv_other'),(3,1,'Temporary secret',1,1,datetime('now'),'conv_temp');
    INSERT INTO conversation_messages VALUES(1,'Can you check my circuit measurements?','complete',0,'user','turn',NULL),
      (1,'Review the transient result','complete',1,'assistant','turn',NULL),(2,'Private body','complete',1,'user','other',NULL),(3,'Off the record','complete',1,'user','temp',NULL);`);
  const calls=[];
  const state={db,calls,agendaCalls:[],agenda:{occurrences:[],returned:0,total:0},settings:{captureEnabled:true,agentAccess:true},
    connections:async user=>['gmail','microsoft-outlook','google-calendar'].map(slug=>({slug,enabled:true,connectionId:`${user}:${slug}`})),
    read:async(request,options)=>{
      calls.push(request);assert.equal(request.method,'GET');assert.ok(options.signal);
      if(request.endpoint.endsWith('/messages')&&request.connectedAccountId.endsWith(':gmail'))return {status:200,data:{messages:[{id:'m1'}]}};
      if(request.endpoint.endsWith('/messages/m1'))return {status:200,data:{payload:{headers:[{name:'Subject',value:'Lab feedback'},{name:'From',value:'Tutor'},{name:'Date',value:'2026-11-06'}]},snippet:'Revise the measurements section.'}};
      if(request.connectedAccountId.endsWith(':microsoft-outlook'))return {status:200,data:{value:[{id:'o1',subject:'Meeting agenda',bodyPreview:'Bring your notes',from:{emailAddress:{name:'Sam'}}}]}};
      if(request.endpoint.endsWith('/calendarList')) return {status:200,data:{items:[]}};
      return {status:200,data:{items:[{id:'e1',summary:'Lab meeting',start:{dateTime:new Date(Date.now()+86400_000).toISOString()},end:{dateTime:new Date(Date.now()+90000_000).toISOString()}}]}};
    },
    recall:async(user,args,options)=>{assert.equal(user,1);assert.equal(options.forAgent,true);assert.equal(options.config.requestTimeoutMs,3000);return {hits:[{frameId:7,window:'Transient response',app:'Breadboard',text:'Reviewing the circuit notes',timestamp:'2026-11-06'}]};},
  };
  globalThis.recFixture=state;return state;
}

test('web search suggestions use permitted browser captures and the account’s visited Breadboard pages', async t => {
  const state = fixture(t);
  let reads = 0;
  state.recall = async (user, args, options) => {
    reads++;
    assert.equal(user, 1);
    assert.equal(options.forAgent, true);
    assert.equal(args.contentType, 'screen');
    return { hits: [
      ['msedge.exe', 'Circuit damping - Google Search - Microsoft Edge'],
      ['Breadboard', 'Encoder calibration'], ['Breadboard', 'Personal notebook'],
      ['Notepad', 'Encoder calibration'], ['chrome', 'New Tab - Google Chrome'],
      ['chrome', 'Secret topic - Incognito'], ['Breadboard', 'Private — Encoder calibration'],
    ].map(([app, window]) => ({ app, window, text: 'Page contents', timestamp: '2026-11-24' })) };
  };
  const context = { surface: 'web-search' };
  const evidence = await sources.readRecommendationEvidence(1, context);
  assert.deepEqual(evidence.map(item => item.title), ['Circuit damping', 'Encoder calibration']);
  const fallback = await generateRecommendations({ context, evidence, model: 'none' });
  assert.deepEqual(fallback.map(card => card.prompt), ['Circuit damping', 'Encoder calibration']);
  assert.deepEqual(fallback.map(card => card.reason), evidence.map(page => `Recall suggested this because you recently viewed “${page.title}”.`));
  const question = 'How does damping affect circuit settling time?';
  const cards = await generateRecommendations({ context, evidence, model: 'test-model', fetcher: async (_url, init) => {
    const { messages } = JSON.parse(init.body);
    assert.ok(messages.some(message => message.role === 'system' && message.content.includes('standalone search queries')));
    const content = JSON.stringify([{ prompt: question, sourceIds: [evidence[0].id] }]);
    return Response.json({ choices: [{ message: { content } }] });
  } });
  assert.equal(cards[0].prompt, question);
  assert.equal(cards[0].reason, fallback[0].reason);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.agendaCalls, []);
  state.settings.agentAccess = false;
  assert.deepEqual(await sources.readRecommendationEvidence(1, context), []);
  assert.equal(reads, 1);
});

test('real adapters read connected mail/calendar and permitted Recall using only this account',async t=>{
  const state=fixture(t);
  const evidence=await sources.readRecommendationEvidence(1,{});
  assert.ok(['gmail','outlook','calendar','recall','chat','task'].every(source=>evidence.some(item=>item.source===source)));
  const chats = evidence.filter(item => item.source === 'chat');
  assert.deepEqual(chats.map(item => item.conversationId), ['conv_lab']);
  const proposal = {prompt:'Check the transient result against my circuit measurements.',sourceIds:['chat:1'],conversationId:'conv_other'};
  const [card] = selectRecommendations(parseRecommendations([proposal], chats), chats);
  assert.equal(card.conversationId, 'conv_lab');
  const [restored] = selectRecommendations([], chats, [{...card, conversationId:undefined}]);
  assert.equal(restored.conversationId, 'conv_lab');
  assert.ok(!evidence.some(item=>item.source==='garden'),'opening a garden is not a home-screen signal');
  assert.ok(state.calls.every(call=>call.connectedAccountId.startsWith('1:')));
  assert.doesNotMatch(JSON.stringify(evidence),/Other user|Temporary secret|Off the record|Private body|Private other|Other task secret|Completed task|Archived task/);
  assert.ok(state.calls.every(call=>!call.endpoint.includes('send')&&!call.endpoint.includes('modify')));
});

test('a reminder-only Telegram transcript is excluded, while an actual exchange in the same thread survives', async t => {
  const state = fixture(t);
  state.db.exec(`INSERT INTO conversations VALUES(5,1,'Telegram · Alex: ⏰ In 20 minutes: Courses open for registration',1,0,datetime('now'),'conv_telegram');
    INSERT INTO conversation_messages VALUES(5,'⏰ In 20 minutes: Courses open for registration','complete',0,'assistant','external-outbound-telegram-x',NULL),
      (5,'Remind me in 20 minutes','complete',1,'user','receipt','{"scheduledChatReceipt":{}}'),
      (5,'Check tomorrow’s weather in Delft','complete',2,'user','schedule-9-123',NULL),
      (5,'File this result','complete',3,'user','hook-9-456',NULL);`);
  const read = () => sources.readRecommendationEvidence(1, {gardenSlug:'circuits'});
  assert.ok(!(await read()).some(item => item.id === 'chat:5'));
  state.db.exec(`INSERT INTO conversation_messages VALUES
    (5,'How can I calibrate the encoder?','complete',2,'user','encoder',NULL),
    (5,'Compare the measured rotation with a reference angle.','complete',3,'assistant','encoder',NULL),
    (5,'⏰ Another notification','complete',4,'assistant','external-outbound-telegram-y',NULL);`);
  const chat = (await read()).find(item => item.id === 'chat:5');
  assert.match(chat.summary, /calibrate the encoder.*reference angle/);
  assert.doesNotMatch(JSON.stringify(chat), /Telegram|notification|registration|⏰/);
});

test('an archived itinerary and a class on a second calendar reach the same suggestion', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-16T10:00:00Z')});
  const state = fixture(t);
  state.connections = async () => ['gmail','google-calendar'].map(slug => ({slug,enabled:true,connectionId:slug}));
  state.settings.agentAccess = false;
  const context = {localDate:'2026-11-16',localTime:'10:00'};
  const detailReads = [];
  const unexpected = [];
  state.read = async ({endpoint,parameters}) => {
    const query = Object.fromEntries(parameters.map(({name,value}) => [name,value]));
    if (endpoint.endsWith('/messages')) return {status:200,data:{messages:
      query.q.includes('in:inbox') ? [] : [{id:'trip',threadId:'booking'}, {id:'duplicate',threadId:'booking'}]}};
    if (endpoint.endsWith('/messages/trip')) {
      detailReads.push(endpoint);
      assert.equal(query.format, 'full');
      assert.match(query.fields,/snippet.*headers/);
      assert.doesNotMatch(query.fields,/body|data/);
      return {status:200,data:{payload:{headers:[{name:'Subject',value:'Your flight to Budapest'}]},
        snippet:'Booking confirmed. Depart 2026-11-25, return 2026-11-29.'}};
    }
    if (endpoint.endsWith('/calendarList')) return {status:200,data:{items:[
      {id:'uni',selected:true},{id:'hidden',selected:true,hidden:true},{id:'primary',primary:true,selected:true}]}};
    if (endpoint.endsWith('/primary/events')) return {status:200,data:{items:[]}};
    if (endpoint.endsWith('/uni/events')) {
      assert.ok(Date.parse(query.timeMax) - Date.parse(query.timeMin) >= 20 * 86400_000);
      return {status:200,data:{items:[{id:'lecture',summary:'Robotics lecture',start:{date:'2026-11-25'},end:{date:'2026-11-26'}}]}};
    }
    unexpected.push(endpoint);
    throw Error(`Unexpected read: ${endpoint}`);
  };
  const evidence = await sources.readRecommendationEvidence(1, context);
  assert.equal(detailReads.length,1);
  assert.deepEqual(unexpected,[]);
  const expectedIds = ['gmail:trip','google-calendar:uni:lecture'];
  const offline = await generateRecommendations({evidence,context,model:'none'});
  assert.deepEqual(offline[0].sourceIds,expectedIds);
  assert.match(offline[0].prompt,/Budapest.*Robotics lecture/);
  const prompt = 'Plan my robotics coursework around the Budapest trip.';
  const cards = await generateRecommendations({evidence,context,shown:offline,model:'selected',fetcher:async (_url, init) => {
    const request = JSON.parse(JSON.parse(init.body).messages.at(-1).content);
    assert.deepEqual(request.onScreen,[]);
    assert.ok(request.evidence.find(item => item.id === expectedIds[0]).summary.includes('2026-11-29'));
    assert.equal(request.evidence.find(item => item.id === expectedIds[1]).calendar.end,'2026-11-25T23:59');
    return Response.json({choices:[{message:{content:JSON.stringify([{prompt,sourceIds:expectedIds}])}}]});
  }});
  assert.deepEqual(cards.map(card => card.prompt),[prompt]);
  assert.equal(cards[0].sourceLabel,'Gmail · Calendar');
});

test('busy notification threads leave room for a booking and a personal request within ten Gmail reads', async t => {
  const state = fixture(t);
  const context = {localDate:'2026-11-16',localTime:'10:00'};
  state.connections = async () => [{slug:'gmail', enabled:true, connectionId:'mail'}];
  state.agenda = {total:1,returned:1,occurrences:[{eventId:91,title:'Meridian planning meeting',
    start:'2026-11-26T11:00',end:'2026-11-26T12:00',calendar:'Work'}]};
  const details = [];
  state.read = async ({endpoint,parameters}) => {
    if (endpoint.endsWith('/messages')) {
      const q = parameters.find(parameter=>parameter.name==='q').value;
      const group = q.includes('category:reservations') ? 'booking' : q.includes('category:primary') ? 'personal' :
        q.includes('filename:ics') ? 'invite' : 'notification';
      return {status:200,data:{messages:Array.from({length:5},(_,i)=>({id:`${group}${i}`}))}};
    }
    const id = endpoint.split('/').at(-1);
    details.push(id);
    const subject = id === 'booking0' ? 'Your trip to Budapest' : id === 'personal0' ? 'Cover illustration' : 'Workflow run finished';
    const snippet = id === 'booking0' ? 'Reservation confirmed for 25–29 November 2026.' :
      id === 'personal0' ? 'Could you review the cover illustration before printing?' : 'View the run summary.';
    return {status:200,data:{snippet,payload:{headers:[{name:'Subject',value:subject}]}}};
  };
  const evidence = await sources.readRecommendationEvidence(1,context);
  assert.equal(details.length,10);
  const cards = await generateRecommendations({evidence,context,model:'none'});
  assert.ok(cards.some(card=>card.sourceIds.includes('gmail:booking0') && card.prompt.includes('Meridian planning meeting')));
  assert.ok(cards.some(card=>card.sourceIds.includes('gmail:personal0') && /review.*Cover illustration.*feedback/i.test(card.prompt)));
  assert.ok(!cards.some(card=>card.prompt.includes('Workflow run finished')));
});

test('built-in Calendar queries expanded upcoming occurrences and targets Recall at their topics',async t=>{
  const state=fixture(t);
  state.agenda={total:1,returned:1,occurrences:[{eventId:91,title:'RLC lab meeting',start:'2026-11-07T11:00',end:'2026-11-07T12:00',calendar:'Study'}]};
  const queries=[];
  state.recall=async(user,args,options)=>{
    assert.equal(user,1);assert.equal(options.forAgent,true);queries.push(args.query);
    return {hits:[{window:'RLC lab measurements',app:'Reader',text:'Damping and transient measurements',timestamp:'2026-11-07T09:00:00Z'}]};
  };
  const evidence=await sources.readRecommendationEvidence(1,{localDate:'2026-11-07',localTime:'10:30',pageTitle:'Circuit measurements'});
  assert.deepEqual(state.agendaCalls,[{user:1,args:{from:'2026-11-07',days:21,limit:200,includeDescriptions:true}}]);
  assert.deepEqual(queries,[undefined,'Circuit measurements','rlc lab']);
  const meeting=evidence.find(item=>item.title==='RLC lab meeting');
  assert.equal(meeting.calendar.status,'upcoming');
  const recalled=evidence.filter(item=>item.source==='recall');
  assert.equal(recalled.length,1);
  assert.deepEqual(recalled[0].relatedIds,[meeting.id]);
});

test('a Gmail calendar attachment identifies an invitation with no event words in its subject or snippet', async t => {
  const state = fixture(t);
  state.connections = async () => [{slug:'gmail',enabled:true,connectionId:'mail'}];
  state.read = async ({endpoint,parameters}) => {
    const query = Object.fromEntries(parameters.map(({name,value}) => [name,value]));
    if (endpoint.endsWith('/messages')) return {status:200,data:{messages:query.q.includes('filename:ics') ? [{id:'qbr'}] : []}};
    return {status:200,data:{snippet:'Tot vrijdag.',payload:{headers:[{name:'Subject',value:'QBR'}],
      parts:[{mimeType:'multipart/alternative',parts:[{mimeType:'text/calendar'}]}]}}};
  };
  const evidence = await sources.readRecommendationEvidence(1,{});
  const invite = evidence.find(item => item.id === 'gmail:qbr');
  assert.equal(invite.calendarAttachment,true);
  const [card] = await generateRecommendations({evidence:[invite],context:{},model:'none'});
  assert.match(card.prompt,/QBR.*schedule/);
  const event = {id:'calendar:qbr',source:'calendar',title:'QBR',summary:'',
    calendar:{kind:'event',start:'2026-11-20T09:00',end:'2026-11-20T10:00',status:'upcoming'}};
  const withCalendar = await generateRecommendations({evidence:[invite,event],context:{},model:'none'});
  assert.deepEqual(withCalendar[0].sourceIds,[invite.id,event.id]);
});

test('a Google trip pairs with the rescheduled class in Breadboard’s own Calendar', async t => {
  const state = fixture(t);
  const context = {localDate:'2026-11-16',localTime:'09:00'};
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-16T09:00Z')});
  const lesson = {eventId:10,seriesId:10,calendar:'University',title:'Control systems tutorial'};
  const occurrences = [
    {...lesson,start:'2026-11-17T11:00',end:'2026-11-17T12:00'},
    {...lesson,eventId:11,edited:true,start:'2026-11-26T13:00',end:'2026-11-26T14:00'},
  ];
  state.agenda = {total:2,returned:2,occurrences};
  state.connections = async () => [{slug:'google-calendar',enabled:true,connectionId:'calendar'}];
  state.read = async ({endpoint}) => ({status:200,data:{items:endpoint.endsWith('/primary/events') ? [
    {id:'visit',summary:'Vienna trip',start:{date:'2026-11-25'},end:{date:'2026-11-28'}},
  ] : []}});
  const evidence = await sources.readRecommendationEvidence(1, context);
  const cards = await generateRecommendations({evidence,context,model:'none'});
  const combined = cards.find(card => card.sourceIds.includes('google-calendar:visit'));
  assert.deepEqual(combined.sourceIds,['google-calendar:visit','calendar:11:2026-11-26T13:00']);
  assert.match(combined.prompt,/Control systems tutorial.*Vienna/);
});

test('disabled Recall access is not bypassed and a failed mail service leaves other evidence intact',async t=>{
  const state=fixture(t);state.settings.agentAccess=false;
  state.recall=()=>assert.fail('Recall must not be queried');
  const read=state.read;state.read=(request,options)=>request.connectedAccountId.endsWith(':gmail')?Promise.reject(Error('offline')):read(request,options);
  const evidence=await sources.readRecommendationEvidence(1,{});
  assert.equal(evidence.some(item=>item.source==='recall'||item.source==='gmail'),false);
  assert.ok(evidence.some(item=>item.source==='outlook'));
  assert.ok(evidence.some(item=>item.gardenSlug==='circuits'));
});

test('a Google meeting conflicts with a named Breadboard event; a free mirror and a back-to-back visit do not', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-16T09:00Z')});
  const state = fixture(t);
  const context = {timeZone:'UTC'};
  const local = (eventId,title,start,end) => ({eventId,title,start:`2026-11-20T${start}`,end:`2026-11-20T${end}`,calendar:'Personal'});
  const occurrences = [local(1,'Linden','14:00','15:00'),local(2,'Open gallery','14:05','15:50'),local(3,'Dental visit','15:45','16:00')];
  state.agenda = {total:3,returned:3,occurrences};
  state.connections = async () => [{slug:'google-calendar',enabled:true,connectionId:'work'}];
  const remote = (id,summary,start,end,extra = {}) => ({id,summary,start:{dateTime:`2026-11-20T${start}:00Z`},end:{dateTime:`2026-11-20T${end}:00Z`},...extra});
  state.read = async ({endpoint}) => ({status:200,data:{items:endpoint.endsWith('/primary/events') ? [
    remote('board','Meridian board meeting','14:30','15:45'),
    remote('open','Open gallery','14:05','15:50',{transparency:'transparent'}),
  ] : []}});
  const evidence = await sources.readRecommendationEvidence(1,context);
  assert.equal(evidence.find(item => item.title === 'Open gallery').calendar.blocksTime,false);
  assert.ok(!evidence.some(item => item.calendar?.kind === 'overlap' && item.title.includes('gallery')));
  const cards = await generateRecommendations({evidence,context,model:'none'});
  const conflict = cards.find(item => item.sourceIds.includes('google-calendar:board'));
  assert.deepEqual(new Set(conflict.sourceIds),new Set(['calendar:1:2026-11-20T14:00','google-calendar:board']));
  assert.match(conflict.prompt,/14:30–15:00/);
  assert.doesNotMatch(conflict.prompt,/coursework|catch.up|gallery|Dental/);
});

test('garden reads stay inside the selected owned garden without querying account-wide providers',async t=>{
  const state=fixture(t);
  state.db.exec(`INSERT INTO clusters VALUES(3,1,'Neuro','neuro',datetime('now'),datetime('now'));
    INSERT INTO conversations VALUES(4,1,'Neuro room problem',3,0,datetime('now'),'conv_neuro');
    INSERT INTO conversation_messages VALUES(4,'Check the conflicting room numbers','complete',1,'user','neuro',NULL);`);
  state.connections=()=>assert.fail('No account-wide connected apps in a garden');
  state.recall=()=>assert.fail('Unscoped screen captures cannot establish garden membership');
  const evidence=await sources.readRecommendationEvidence(1,{gardenSlug:'circuits'});
  assert.equal(state.agendaCalls.length,0);
  assert.equal(state.calls.length,0);
  assert.deepEqual(new Set(evidence.map(item=>item.source)),new Set(['chat','garden']));
  assert.ok(evidence.every(item=>item.gardenSlug==='circuits'));
  assert.doesNotMatch(JSON.stringify(evidence),/Neuro|room problem|task|secret/);
  assert.deepEqual(await sources.readRecommendationEvidence(1,{gardenSlug:'secret'}),[]);
});

const route=await bundle('src/app/api/recommendations/route.ts',{
  '@/lib/server-auth':'export const requireUserId=async()=>{if(globalThis.recRoute.denied)throw Object.assign(Error("Unauthorized"),{status:401});return 7};',
  '@/lib/hermes/route-helpers':'export const readJsonBody=request=>request.json(); export const apiErrorResponse=error=>Response.json({}, {status:error.status||500});',
  '@/lib/chatmock-server':'export const resolveChatmockBaseUrl=()=>({baseURL:"http://model.test/v1"});',
  '@/lib/recommendations/service':'export const recommendationsForUser=async(...args)=>{globalThis.recRoute.calls.push(args);return []}; export const preparedVoiceOpenersForUser=()=>[];',
  '@/lib/recommendations/types':'export const cleanRecommendationText=(value,max)=>typeof value==="string"?value.trim().slice(0,max):"";',
});

test('recommendation route enforces authentication and skips private context for public/temporary/unpersonalized views',async()=>{
  globalThis.recRoute={calls:[],denied:false};
  const request=body=>new Request('http://local/api/recommendations',{method:'POST',body:JSON.stringify(body)});
  for(const body of [{temporary:true},{scope:'public'},{personalize:false}])assert.equal((await route.POST(request(body))).status,200);
  assert.equal(globalThis.recRoute.calls.length,0);
  await route.POST(request({userId:999,gardenSlug:'circuits'}));
  assert.equal(globalThis.recRoute.calls[0][0],7,'the request cannot select another account');
  globalThis.recRoute.denied=true;
  assert.equal((await route.POST(request({}))).status,401);
  assert.equal(globalThis.recRoute.calls.length,1);
  delete globalThis.recRoute;
});

test('the PDF assistant scopes personal suggestions to the open document and uses its page for the question cards', async () => {
  const { readFileSync } = await import('node:fs');
  const pdf = readFileSync(path.join(root, 'src/app/components/pdf-assistant.tsx'), 'utf8');
  const panel = pdf.slice(pdf.indexOf('<AgentRuntimePanel'), pdf.indexOf('sessionId={session.sessionId}', pdf.indexOf('<AgentRuntimePanel')));
  assert.match(panel, /personalizedSuggestions=\{!temporary\}/);
  assert.match(panel, /suggestionPageTitle=\{title\}/);
  assert.match(panel, /gardenSlug=\{gardenSlug\}/);
  assert.match(pdf, /fetch\("\/api\/pdf-suggestions"/);
});
