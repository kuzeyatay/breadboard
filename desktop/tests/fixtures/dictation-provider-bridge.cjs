// Exercise the user's configured provider through an existing, authenticated
// Breadboard renderer. Credentials never leave that renderer.
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { randomUUID } = require('node:crypto');

exports.openDictationProviderBridge = async function (endpoint) {
  assert.ok(endpoint, 'BREADBOARD_DICTATION_CDP must point to the running Breadboard');
  const targets = await (await fetch(endpoint + '/json/list')).json();
  const target = targets.find(t => /^http:\/\/127\.0\.0\.1:\d+\/notification-overlay$/.test(t.url));
  assert.ok(target, 'existing authenticated Breadboard renderer');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let requestId = 0;
  const pending = new Map();
  const owner = 'dictation-test-' + randomUUID(), sessions = new Set();
  let foreground = false, allocations = 0, closing;
  socket.on('message', data => {
    const message = JSON.parse(data);
    pending.get(message.id)?.resolve(message);
  });
  socket.on('close', () => { for (const reply of pending.values()) reply.reject(new Error('Breadboard renderer closed')); });
  async function evaluate(expression) {
    const id = ++requestId;
    let timer;
    try {
      const reply = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        timer = setTimeout(() => reject(new Error('Speech request timed out')), 90000);
      });
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      const result = await reply;
      if (result.error || result.result?.exceptionDetails) throw new Error('The authenticated speech request failed');
      return result.result.result.value;
    } finally { clearTimeout(timer); pending.delete(id); }
  }
  const state = `globalThis.__breadboardDictationTestBridges.get(${JSON.stringify(owner)})`;
  await evaluate(`(()=>{globalThis.__breadboardDictationTestBridges??=new Map();globalThis.__breadboardDictationTestBridges.set(${JSON.stringify(owner)},{channel:new BroadcastChannel('breadboard:audio-focus'),priority:new BroadcastChannel('breadboard:dictation-priority'),requests:new Map()});return true;})()`);
  async function publishFocus() {
    // Broadcast inside Breadboard's origin: the isolated renderer has another
    // origin and cannot otherwise ask the companion to yield idle voice slots.
    return evaluate(`(()=>{const s=${state},message={id:${JSON.stringify(owner)},holds:${foreground || allocations || sessions.size ? 1 : 0}};s?.channel.postMessage(message);s?.priority.postMessage(message);return true;})()`);
  }
  const heartbeat = setInterval(() => { if (foreground || allocations || sessions.size) void publishFocus().catch(() => {}); }, 5000);
  heartbeat.unref();
  return {
    async setAudioFocus(active) { foreground = active; await publishFocus(); },
    close() {
      return closing ??= (async () => {
        clearInterval(heartbeat); foreground = false;
        try {
          await evaluate(`(async()=>{const state=${state};if(!state)return;for(const controller of state.requests.values())controller.abort();await Promise.all(${JSON.stringify([...sessions])}.map(id=>fetch('/api/speech/subscription/'+encodeURIComponent(id),{method:'DELETE',signal:AbortSignal.timeout(8000)}).catch(()=>{})));state.channel.postMessage({id:${JSON.stringify(owner)},holds:0});state.priority.postMessage({id:${JSON.stringify(owner)},holds:0});state.channel.close();state.priority.close();globalThis.__breadboardDictationTestBridges.delete(${JSON.stringify(owner)});return true;})()`);
        } finally { socket.close(); }
      })();
    },
    async forward(req, signal) {
      assert.ok(req.url.startsWith('/api/speech/'), 'only own speech routes are forwarded');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = { url: req.url, method: req.method, type: req.headers['content-type'], body: Buffer.concat(chunks).toString('base64') };
      const allocating = req.url === '/api/speech/subscription' && req.method === 'POST';
      const deleting = req.method === 'DELETE' && /^\/api\/speech\/subscription\/[^/?]+$/.test(req.url);
      const token = randomUUID();
      const abort = () => { void evaluate(`(()=>{${state}?.requests.get(${JSON.stringify(token)})?.abort();return true;})()`).catch(() => {}); };
      if (allocating) allocations++;
      try {
        if (allocating) await publishFocus();
        signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
        const result = await evaluate(`(async input=>{const state=${state},controller=new AbortController();state.requests.set(${JSON.stringify(token)},controller);try{const response=await fetch(input.url,{method:input.method,headers:input.type?{'content-type':input.type}:{},body:input.body?Uint8Array.from(atob(input.body),c=>c.charCodeAt(0)):undefined,signal:controller.signal});return {status:response.status,body:await response.text()};}finally{state.requests.delete(${JSON.stringify(token)});}})(${JSON.stringify(input)})`);
        if (allocating && result.status >= 200 && result.status < 300) {
          const id = JSON.parse(result.body).id;
          if (typeof id === 'string') sessions.add(id);
        }
        if (deleting && (result.status < 300 || result.status === 404)) sessions.delete(decodeURIComponent(req.url.split('/').at(-1)));
        return result;
      } finally {
        signal?.removeEventListener('abort', abort);
        if (allocating) allocations--;
        if (allocating || deleting) await publishFocus().catch(() => {});
      }
    },
  };
};
