const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../dashboard');
const localRequire = require('node:module').createRequire(path.join(root, 'package.json'));
const esbuild = localRequire('esbuild');
const postcss = localRequire('postcss');
const tailwind = localRequire('@tailwindcss/postcss');
const { chromium } = localRequire('playwright-core');

async function main() {
  const stubs = {
    auth: `export const getServerSession = async () => ({user:{id:'1',name:'kuzeyata',email:'kuzeyata@example.test'}}); export const authOptions = {};`,
    organizations: `export const listOrganizations = () => window.QA.organizations;`,
    catalog: `export const loadAgencyAgentsCatalog = () => ({status:'ready',agents:[]});`,
    preferences: `export const getNavbarFlowers = () => window.QA.flowers; export const getNavbarShortcuts = () => window.QA.shortcuts;`,
    graphIds: `export const buzzThreadNodeId = (room,id) => room+'-'+id;`,
    store: `export const listRooms = () => window.QA.rooms; export const listRoomsForUser = listRooms; export const listMembers = () => window.QA.members; export const unreadCounts = () => new Map(); export const ensureSelfMember = () => {}; export const createRoom = () => {}; export const listSpineMessages = () => window.QA.messages;`,
    navigation: `export const redirect = url => {throw Error(url)}; export const useRouter = () => ({push(){},replace(){},refresh(){},prefetch(){}}); export const usePathname = () => '/buzz'; export const useSearchParams = () => new URLSearchParams(location.search);`,
    link: `import React from 'react'; export default function Link({children, prefetch, ...props}) { return React.createElement('a',props,children); }`,
  };
  const boundaries = [
    [/^next-auth\/next$/, 'auth'], [/^@\/lib\/auth-options$/, 'auth'],
    [/^@\/lib\/organizations\/store\.ts$/, 'organizations'],
    [/^@\/lib\/hermes\/agency-agents\.ts$/, 'catalog'],
    [/^@\/lib\/profile\/navbar-shortcuts-store\.ts$/, 'preferences'],
    [/^@\/lib\/profile\/brain-graph-ids\.ts$/, 'graphIds'],
    [/^@\/lib\/buzz\/instance\.ts$/, 'store'],
    [/^next\/navigation$/, 'navigation'], [/^next\/link$/, 'link'],
  ];
  const bundle = await esbuild.build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import BuzzPage from './src/app/buzz/page';
      import { applyAppTheme } from './src/lib/app-theme';
      const root = createRoot(document.body);
      window.pickTheme = applyAppTheme;
      window.renderOrganization = async () => {
        const page = await BuzzPage({searchParams:Promise.resolve({room:'general'})});
        root.render(<><div className="desktop-title-bar" aria-hidden="true">Organization</div>{page}</>);
      };
      window.renderOrganization();
    ` },
    bundle: true, write: false, outdir: path.join(__dirname, 'bundle'),
    platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [{ name: 'isolated-page-data', setup(build) {
      boundaries.forEach(([filter, name]) => build.onResolve({filter}, () => ({path:name,namespace:'fixture'})));
      build.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:stubs[args.path],loader:'tsx',resolveDir:root}));
    } }],
  });
  const globalsPath = path.join(root, 'src/app/globals.css');
  const globals = await postcss([tailwind({base:root})]).process(fs.readFileSync(globalsPath,'utf8'),{from:globalsPath});
  const font = fs.readFileSync(path.join(root,'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');
  const css = [globals.css,
    ...['buzz-theme.css','ui/card-texture.css','buzz-host.css'].map(file => fs.readFileSync(path.join(root,'src/app/buzz',file),'utf8')),
    ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file=>file.text),
    `@font-face{font-family:'Inter Variable';font-weight:100 900;src:url(data:font/woff2;base64,${font}) format('woff2')}`,
  ].join('\n');
  const js = bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const room = {id:1,publicId:'general',organizationId:1,slug:'general',name:'general',topic:'Everything that does not have a room yet.',purpose:'',kind:'channel',visibility:'public',archivedAt:null};
  const human = {id:1,roomId:1,kind:'human',userId:1,personaSlug:null,displayName:'kuzeyata',handle:'kuzeyata',accent:'#4f6f62',respondTo:'always',model:null,conversationId:null,muted:false,joinedAt:'2026-11-08 07:00:00'};
  const agent = {...human,id:2,kind:'agent',userId:null,personaSlug:'bread',displayName:'Bread',handle:'bread'};
  const message = {id:1,roomId:1,clientMessageId:'hello',memberId:1,authorKind:'human',authorName:'kuzeyata',authorHandle:'kuzeyata',personaSlug:null,body:'hi',parentId:null,status:'complete',runId:null,metadata:null,editedAt:null,deletedAt:null,createdAt:'2026-11-08 07:57:00',updatedAt:'2026-11-08 07:57:00'};
  const fixture = {organizations:[{id:1,name:'test organization',role:'owner',members:[{userId:1,username:'kuzeyata'}]}],rooms:[room],members:[human,agent],messages:[message],flowers:true,shortcuts:{workTimer:true,plan:true,buzz:true,voice:false,fastRead:false}};
  const detail = {permissions:{canManage:true,canPost:true},room,selfMemberId:1,members:fixture.members,messages:fixture.messages};
  const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/app.css') return route.fulfill({contentType:'text/css',body:css});
      if (url.pathname === '/app.js') return route.fulfill({contentType:'application/javascript',body:js});
      if (url.pathname === '/logo.png') return route.fulfill({path:path.join(root,'public/logo.png')});
      if (url.pathname === '/api/buzz/rooms/general/messages') return route.fulfill({json:detail});
      if (url.pathname === '/api/buzz/inbox') return route.fulfill({json:{unread:[],agents:[],invites:[]}});
      if (url.pathname === '/api/buzz/rooms') return route.fulfill({json:{organizations:fixture.organizations.map(org=>({...org,people:org.members})),rooms:[{...room,archived:false,unread:0,memberCount:2,agentHandles:['bread'],peopleHandles:['kuzeyata']}]}});
      if (url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
      if (url.pathname === '/buzz') return route.fulfill({contentType:'text/html',body:`<!doctype html><html data-theme="light" data-breadboard-desktop="true"><head><link rel="stylesheet" href="/app.css"></head><body class="min-h-full flex flex-col"><script>window.QA=${JSON.stringify(fixture)};</script><script src="/app.js"></script></body></html>`});
      return route.abort();
    });
    await page.goto('http://organization.test/buzz');
    await page.getByRole('textbox',{name:'Message #general',exact:true}).waitFor();
    await page.getByText('hi',{exact:true}).waitFor();
    const report = [];
    for (const config of [
      {name:'desktop-light',width:1440,height:900,desktop:true,theme:'light'},
      {name:'desktop-dark',width:1440,height:900,desktop:true,theme:'dark'},
      {name:'narrow-light',width:640,height:850,desktop:true,theme:'light'},
      {name:'mobile-browser',width:390,height:844,desktop:false,theme:'light'},
    ]) {
      await page.setViewportSize({width:config.width,height:config.height});
      await page.evaluate(({desktop,theme}) => {
        if (desktop) document.documentElement.setAttribute('data-breadboard-desktop','true');
        else document.documentElement.removeAttribute('data-breadboard-desktop');
        window.pickTheme(theme);
      },config);
      await page.locator('.breadboard-flower-navbar').waitFor();
      const geometry = await page.evaluate(() => {
        const box = selector => {
          const e = document.querySelector(selector), r = e.getBoundingClientRect();
          return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};
        };
        return {navbar:box('.breadboard-flower-navbar'),workspace:box('.buzz-host-shell'),composer:box('.buzz-composer'),body:box('body'),documentHeight:document.documentElement.scrollHeight,viewportHeight:innerHeight,plants:document.querySelectorAll('[class$="_plant"]').length};
      });
      report.push({config,geometry});
      assert.equal(geometry.navbar.y,config.desktop?32:0,config.name+' navbar top');
      assert.equal(geometry.navbar.height,69,config.name+' navbar height');
      assert(geometry.navbar.scrollWidth<=geometry.navbar.clientWidth,config.name+' navbar fits horizontally');
      assert.equal(geometry.workspace.y,geometry.navbar.bottom,config.name+' workspace follows navbar');
      assert(geometry.composer.bottom<=config.height,config.name+' composer stays inside window');
      assert(geometry.documentHeight<=config.height,config.name+' no outer page scroll');
      assert.equal(geometry.plants,24,config.name+' shared grass and flowers render');
      await page.screenshot({path:path.join(__dirname,config.name+'.png')});
    }
    assert.deepEqual(errors,[],'no page errors');
    fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify({report,errors},null,2));
    console.log(JSON.stringify({passed:true,report,errors}));
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
