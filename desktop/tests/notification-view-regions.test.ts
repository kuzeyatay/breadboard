import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import type { Rectangle, View, WebContents } from 'electron';

const contents = (zoom = 1) => Object.assign(new EventEmitter(), {
  isDestroyed: (): boolean => false, getZoomFactor: () => zoom,
  executeJavaScript: async (_source: string): Promise<Rectangle[]> => [],
});
type Contents = ReturnType<typeof contents>;
class TestView {
  children: TestView[] = [];
  shown = true;
  constructor(public bounds: Rectangle) {}
  getBounds() { return this.bounds; }
  setVisible(value: boolean) { this.shown = value; }
}
class TestContentsView extends TestView {
  constructor(bounds: Rectangle, readonly webContents: Contents) { super(bounds); }
}

function fixture() {
  let now = 1000;
  const page=contents();
  const root=new TestView({x:0,y:0,width:600,height:400});
  const window={webContents:page,contentView:root,isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,
    getContentSize:()=>[600,400],getContentBounds:()=>({x:100,y:200,width:600,height:400}),
    getNativeWindowHandle:()=>{const buffer=Buffer.alloc(8);buffer.writeBigUInt64LE(1n);return buffer;}};
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){}});
  const module={exports:{} as typeof import('../src/main/notification-visible-region')};
  const electron={WebContentsView:TestContentsView,screen:{
    dipToScreenRect:(_window:unknown,rect:Rectangle)=>Object.fromEntries(Object.entries(rect).map(([key,value])=>[key,value*2])),
    screenToDipRect:(_window:unknown,rect:Rectangle)=>Object.fromEntries(Object.entries(rect).map(([key,value])=>[key,value/2])),
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main/notification-visible-region.js'),'utf8'),{
    module,exports:module.exports,require:(name:string)=>name==='electron'?electron:name==='node:child_process'?{spawn:()=>child}:require(name),
    process:{platform:'win32',env:{}},__dirname,Buffer,Date:{now:()=>now},setInterval:()=>({unref(){}}),clearInterval(){},
  });
  const api=module.exports;
  const stop=api.watchNotificationVisibility(window as never,()=>{});
  const sample=()=>child.stdout.write(JSON.stringify({'1':[{x:200,y:400,width:1200,height:800}]})+'\n');sample();
  return {root,page,stop,rects:(target:Contents=page)=>JSON.parse(JSON.stringify(api.notificationVisibleRects(window as never,target as WebContents))),
    advance:(ms:number)=>{now+=ms;sample();},track:(view:TestContentsView)=>api.trackTransparentNotificationView(view as never,'.painted'),
    show:(view:TestView,value:boolean)=>api.setNotificationViewVisible(view as unknown as View,value)};
}

test('only higher native siblings cover an answer, including later parent containers',()=>{
  const f=fixture(),answer=contents(),parent=new TestView({x:100,y:50,width:300,height:200});
  const view=new TestContentsView({x:0,y:0,width:300,height:200},answer);parent.children=[view];f.root.children=[parent];
  assert.deepEqual(f.rects(answer),[{x:0,y:0,width:300,height:200}]);
  const cover=new TestContentsView({x:100,y:50,width:300,height:200},contents());f.root.children.push(cover);
  assert.deepEqual(f.rects(answer),[]);
  f.root.children=[cover,parent];assert.deepEqual(f.rects(answer),[{x:0,y:0,width:300,height:200}]);
  const group=new TestView({x:100,y:50,width:300,height:200});group.children=[new TestContentsView({x:0,y:0,width:300,height:200},contents())];
  f.root.children=[parent,group];assert.deepEqual(f.rects(answer),[]);f.stop();
});

test('hidden native views and hidden ancestor containers do not count as covers or readable answers',()=>{
  const f=fixture(),answer=contents(),view=new TestContentsView({x:0,y:0,width:600,height:400},answer);
  const group=new TestView({x:0,y:0,width:600,height:400});group.children=[new TestContentsView({x:0,y:0,width:600,height:400},contents())];
  f.root.children=[view,group];assert.deepEqual(f.rects(answer),[]);
  f.show(group,false);assert.equal(group.shown,false);assert.deepEqual(f.rects(answer),[{x:0,y:0,width:600,height:400}]);
  f.show(group,true);assert.deepEqual(f.rects(answer),[]);f.show(group,false);f.show(view,false);assert.deepEqual(f.rects(answer),[]);f.stop();
});

test('partial strips, overlapping covers, ancestor clips and zoom retain exact uncovered coordinates',()=>{
  const f=fixture(),answer=contents(2),parent=new TestView({x:100,y:100,width:300,height:200});
  parent.children=[new TestContentsView({x:-20,y:-10,width:500,height:300},answer)];f.root.children=[parent];
  const cover=new TestContentsView({x:140,y:100,width:260,height:200},contents());f.root.children.push(cover);
  assert.deepEqual(f.rects(answer),[{x:10,y:5,width:20,height:100}]);
  cover.bounds.x=101;cover.bounds.width=299;assert.deepEqual(f.rects(answer),[{x:10,y:5,width:0.5,height:100}]);
  const overlap=new TestContentsView({x:100,y:100,width:20,height:200},contents());f.root.children.push(overlap);
  assert.deepEqual(f.rects(answer),[]);f.root.children=[parent];parent.bounds.height=10;
  assert.deepEqual(f.rects(answer),[{x:10,y:5,width:150,height:5}]);f.stop();
});

test('the base window document is covered by its native children while empty transparent containers do not cover',()=>{
  const f=fixture();f.root.children=[new TestView({x:0,y:0,width:600,height:400})];
  assert.deepEqual(f.rects(),[{x:0,y:0,width:600,height:400}]);
  f.root.children.push(new TestContentsView({x:0,y:0,width:600,height:400},contents()));assert.deepEqual(f.rects(),[]);f.stop();
});

const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('transparent native backdrops cover only painted regions; hidden, detached and destroyed views cannot retain a cover',async()=>{
  const f=fixture(),answer=contents(),view=new TestContentsView({x:100,y:50,width:300,height:200},answer);
  const panel=contents(),cover=new TestContentsView({x:0,y:0,width:600,height:400},panel);
  let painted=[{x:400,y:50,width:200,height:200}],queries=0;
  panel.executeJavaScript=async()=>{queries++;return painted;};f.track(cover);f.root.children=[view,cover];
  const readable=[{x:0,y:0,width:300,height:200}];
  assert.deepEqual(f.rects(answer),[],'unknown geometry cannot acknowledge an answer through a panel');await settle();assert.deepEqual(f.rects(answer),readable);
  painted=[{x:100,y:50,width:300,height:200}];f.advance(200);f.rects(answer);await settle();assert.deepEqual(f.rects(answer),[]);
  const calls=queries;f.show(cover,false);f.advance(200);assert.deepEqual(f.rects(answer),readable);assert.equal(queries,calls);
  f.show(cover,true);f.root.children=[view];assert.deepEqual(f.rects(answer),readable);assert.equal(queries,calls);
  f.root.children.push(cover);panel.isDestroyed=()=>true;assert.deepEqual(f.rects(answer),readable);assert.equal(queries,calls);f.stop();
});

test('painted-region sampling never overlaps and old document responses cannot override a replacement',async()=>{
  const f=fixture(),answer=contents(),view=new TestContentsView({x:0,y:0,width:600,height:400},answer);
  const panel=contents(),cover=new TestContentsView({x:0,y:0,width:600,height:400},panel);
  let queries=0,resolve!:(rects:Rectangle[])=>void;
  panel.executeJavaScript=()=>{queries++;return new Promise(done=>{resolve=done;});};f.track(cover);f.root.children=[view,cover];
  const readable=[{x:0,y:0,width:600,height:400}];
  f.rects(answer);f.advance(400);f.rects(answer);assert.equal(queries,1);
  resolve(readable);await settle();assert.deepEqual(f.rects(answer),[]);
  // The second query stays in flight. Unknown geometry does not claim a read.
  assert.equal(queries,2);f.advance(1200);assert.deepEqual(f.rects(answer),[]);assert.equal(queries,2);
  panel.emit('did-start-navigation',{},'file:///replacement',false,true);
  resolve(readable);await settle();assert.deepEqual(f.rects(answer),[],'old document result does not certify the replacement');
  resolve([]);await settle();assert.deepEqual(f.rects(answer),readable,'fresh empty document leaves no stale painted cover');f.stop();
});
