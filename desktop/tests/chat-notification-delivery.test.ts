import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import type { ChatNotificationDelivery, isChatNotificationCardVisible } from '../src/main/chat-notification-delivery';
import type { DesktopChatNotification } from '../src/shared/ipc-contract';
import { IPC_CHANNELS, isDesktopChatNotifications, isTabsCommand } from '../src/shared/ipc-contract';
import { createDesktopApi } from '../src/preload/preload';

const card = (id: string, extra: Partial<DesktopChatNotification> = {}): DesktopChatNotification => ({
  id, title: 'Chat', body: 'Answer', urls: ['http://127.0.0.1:1234/new-tab?terminalChat=exact-chat'],
  rect: { x: 10, y: 20, width: 200, height: 80 }, delivered: false, soundEnabled: true, ...extra,
});

function fixture() {
  const timers = new Set<{ run: () => void; unref: () => void }>();
  const alerts: FakeNotification[] = [];
  let supported = true, fail = false, deferred = false;
  class FakeNotification extends EventEmitter {
    static isSupported() { return supported; }
    closed = 0;
    constructor(readonly options: { title: string; body: string; silent: boolean }) { super(); alerts.push(this); }
    show() { if (!deferred) this.emit(fail ? 'failed' : 'show'); }
    close() { this.closed++; this.emit('close'); }
  }
  const module = { exports: {} as { ChatNotificationDelivery: typeof ChatNotificationDelivery; isChatNotificationCardVisible: typeof isChatNotificationCardVisible } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main/chat-notification-delivery.js'),'utf8'), {
    module, exports: module.exports, require: () => ({ Notification: FakeNotification }),
    setTimeout: (run: () => void) => { const timer = { run, unref() {} }; timers.add(timer); return timer; },
    clearTimeout: (timer: { run: () => void; unref: () => void }) => timers.delete(timer),
  });
  const delivery = new module.exports.ChatNotificationDelivery();
  const sources = new Map<number, { cards: DesktopChatNotification[]; visible: boolean; enabled: boolean; received: string[]; opened: string[][] }>();
  function source(id: number, cards: DesktopChatNotification[], visible = false) {
    const state = sources.get(id) ?? { cards, visible, enabled: true, received: [], opened: [] };
    state.cards = cards; state.visible = visible; sources.set(id,state);
    delivery.update(id, { cards, enabled: () => state.enabled, visible: () => state.visible,
      delivered: ids => state.received.push(...ids), open: card => state.opened.push(card.urls) });
    return state;
  }
  return { delivery, alerts, sources, source, readable: module.exports.isChatNotificationCardVisible, settings: (values: { supported?: boolean; fail?: boolean; deferred?: boolean }) => {
    supported = values.supported ?? supported; fail = values.fail ?? fail; deferred = values.deferred ?? deferred;
  }, flush: () => { const current = [...timers]; timers.clear(); current.forEach(timer => timer.run()); }, pending: () => timers.size };
}

test('covered or minimized hosts deliver once, respect mute, and withdraw despite a stale second host', () => {
  const f = fixture();
  const one = f.source(1,[card('a')]);
  const two = f.source(2,[card('a',{soundEnabled:false})]);
  f.flush();
  assert.equal(f.alerts.length,1); assert.equal(f.alerts[0]!.options.silent,true);
  assert.deepEqual(one.received,['a']); assert.deepEqual(two.received,['a']);
  f.delivery.refresh(); f.flush(); assert.equal(f.alerts.length,1);
  f.source(1,[]); assert.equal(f.alerts[0]!.closed,1);
  f.delivery.refresh(); f.flush(); assert.equal(f.alerts.length,1);
});

test('a one-pixel sliver cannot count as reading a card, while a 40px strip can', () => {
  const f=fixture(), rect=card('geometry').rect!;
  assert.equal(f.readable(rect,[{...rect,width:1}]),false);
  assert.equal(f.readable(rect,[{...rect,width:40}]),true);
  assert.equal(f.readable(rect,[{...rect,height:1}]),false);
  assert.equal(f.readable(rect,[{...rect,width:24,height:16}]),true);
  assert.equal(f.readable(rect,[]),false);
  assert.equal(f.readable(null,undefined),false);
});

test('any visible card suppresses OS delivery without consuming its in-app sound, and returning withdraws an OS alert', () => {
  const f = fixture();
  f.source(1,[card('visible')]); const other = f.source(2,[card('visible')],true);
  f.flush(); assert.equal(f.alerts.length,0); assert.deepEqual(other.received,[]);
  f.source(2,[card('visible')],false); f.flush(); assert.equal(f.alerts.length,0,'already visible card is not announced on minimize');
  f.source(1,[card('fresh')]); f.source(2,[card('fresh')]); f.flush(); assert.equal(f.alerts.length,1);
  f.source(2,[card('fresh')],true); assert.equal(f.alerts[0]!.closed,1);
  f.source(2,[card('fresh')],false); f.flush(); assert.equal(f.alerts.length,1);
});

test('reading before the delivery delay cancels, and an existing persisted delivery prevents replay', () => {
  const f = fixture(); f.source(1,[card('early')]); assert.equal(f.pending(),1);
  f.source(1,[]); f.flush(); assert.equal(f.alerts.length,0);
  f.source(1,[card('previous',{delivered:true})]); f.flush(); assert.equal(f.alerts.length,0);
  const source=f.source(1,[card('disabled')]); source.enabled=false; f.delivery.refresh(); f.flush();
  assert.equal(f.alerts.length,0);
});

test('native clicks use the current exact-chat route and alert cleanup is bounded', () => {
  const f = fixture(); const source=f.source(1,[card('click')]); f.flush();
  f.alerts[0]!.emit('click'); assert.deepEqual(source.opened,[card('click').urls]);
  assert.equal(f.alerts[0]!.closed,1);
  f.source(1,[card('next')]); f.flush(); f.delivery.remove(1);
  assert.equal(f.alerts[1]!.closed,1); assert.equal(f.pending(),0);
});

test('an overlay that reloads does not re-alert or re-chime notices it already delivered', () => {
  const f = fixture(); const overlay = f.source(1,[card('kept')]); f.flush();
  assert.equal(f.alerts.length,1); assert.deepEqual(overlay.received,['kept']);
  f.delivery.remove(1);
  f.source(1,[card('kept')]); f.flush(); f.delivery.refresh(); f.flush();
  assert.equal(f.alerts.length,1); assert.deepEqual(overlay.received,['kept']);
});

test('failed or unsupported OS delivery does not loop, and a late show after removal is closed', () => {
  const f = fixture(); f.settings({fail:true}); f.source(1,[card('failed')]); f.flush();
  f.delivery.refresh(); f.flush(); assert.equal(f.alerts.length,1); assert.equal(f.sources.get(1)!.received.length,0);
  f.settings({fail:false,supported:false}); f.source(1,[card('unsupported')]); f.flush(); assert.equal(f.alerts.length,1);
  f.settings({supported:true,deferred:true}); f.source(1,[card('late')]); f.flush(); f.source(1,[]);
  f.alerts[1]!.emit('show'); assert.ok(f.alerts[1]!.closed>=1); assert.equal(f.sources.get(1)!.received.length,0);
});

test('IPC accepts bounded chat descriptors and rejects invalid geometry or missing delivery controls', () => {
  assert.equal(isDesktopChatNotifications([card('ok')]),true);
  assert.equal(isTabsCommand({type:'notification-chat-delivery',cards:[card('ok')]}),true);
  assert.equal(isDesktopChatNotifications([card('bad',{rect:{x:0,y:0,width:NaN,height:10}})]),false);
  assert.equal(isDesktopChatNotifications([{...card('bad'),soundEnabled:undefined}]),false);
  assert.equal(isDesktopChatNotifications(Array.from({length:101},()=>card('too-many'))),false);
});

test('preload delivers OS receipts to subscribers and rejects malformed payloads', () => {
  const listeners = new Map<string, (event: unknown, value: unknown) => void>();
  const api=createDesktopApi({ invoke:async()=>true, on:(channel,listener)=>{listeners.set(channel,listener);} });
  const received: string[]=[];
  const unsubscribe=api.onChatNotificationDelivered(ids=>received.push(...ids));
  const emit=listeners.get(IPC_CHANNELS.chatNotificationDelivered)!;
  emit({},['one']); emit({},'bad'); emit({},[42]); unsubscribe(); emit({},['after-unsubscribe']);
  assert.deepEqual(received,['one']);
});
