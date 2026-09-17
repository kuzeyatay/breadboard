/** Supplies the browser-owned APIs absent from Electron 33. Google's original
 * worker and video scripts run unchanged, with Chromium enforcing their permissions.
 * Only the private extension host page can dispatch these UI/lifecycle events. */
export function googlePipExtensionApi(bridgePath: string): string {
  return `(() => {
    const bridgeUrl = chrome.runtime.getURL(${JSON.stringify(bridgePath)});
    const stateKey = '__breadboard_pip_host_v1';
    const event = () => {
      const listeners = new Set();
      return {
        addListener: listener => listeners.add(listener),
        removeListener: listener => listeners.delete(listener),
        hasListener: listener => listeners.has(listener),
        hasListeners: () => listeners.size > 0,
        dispatch: (...args) => Promise.all([...listeners].map(listener => listener(...args))),
      };
    };
    const clicked = event(), menuClicked = event(), installed = event(), startup = event();
    let menus = {}, action = { title: chrome.runtime.getManifest().name, badge: '' }, version;
    const restored = chrome.storage.local.get(stateKey).then(saved => {
      const state = saved[stateKey];
      if (!state) return;
      menus = state.menus || {}; action = state.action || action; version = state.version;
    });
    const save = () => chrome.storage.local.set({[stateKey]: {menus, action, version}});
    const result = (value, callback) => {
      const promise = save().then(() => value);
      if (typeof callback === 'function') { promise.then(callback); return; }
      return promise;
    };
    chrome.action.onClicked = clicked;
    for (const [method, property, argument] of [
      ['Title', 'title', 'title'], ['BadgeText', 'badge', 'text'],
      ['BadgeBackgroundColor', 'badgeBackgroundColor', 'color'], ['BadgeTextColor', 'badgeTextColor', 'color'],
    ]) {
      chrome.action['set' + method] = (details, callback) => { action[property] = details[argument]; return result(undefined, callback); };
      chrome.action['get' + method] = (_details, callback) => result(action[property], callback);
    }
    chrome.contextMenus = {
      onClicked: menuClicked,
      create: (details, callback) => {
        const id = details.id;
        if (typeof id !== 'string' || !id || Object.hasOwn(menus, id)) throw new Error('Invalid or duplicate context menu id');
        menus[id] = {...details}; result(undefined, callback); return id;
      },
      update: (id, changes, callback) => {
        if (!Object.hasOwn(menus, id)) throw new Error('Unknown context menu id');
        menus[id] = {...menus[id], ...changes, id}; return result(undefined, callback);
      },
      remove: (id, callback) => { delete menus[id]; return result(undefined, callback); },
      removeAll: callback => { menus = {}; return result(undefined, callback); },
    };
    // Electron loads the worker but does not dispatch the browser's startup
    // lifecycle. Deliver it after the host is ready, once for each loaded worker.
    chrome.runtime.onInstalled = installed;
    chrome.runtime.onStartup = startup;
    const pending = new Set();
    let scriptError;
    for (const method of ['executeScript', 'registerContentScripts', 'unregisterContentScripts']) {
      const native = chrome.scripting[method].bind(chrome.scripting);
      chrome.scripting[method] = (...args) => {
        // The package requests removal on startup even when its setting already
        // removed the script. An empty registry already satisfies that request.
        const promise = method === 'unregisterContentScripts' && args[0]?.ids
          ? chrome.scripting.getRegisteredContentScripts({ids:args[0].ids}).then(scripts =>
            scripts.length ? native({ids:scripts.map(script => script.id)}) : undefined)
          : native(...args);
        if (promise && typeof promise.then === 'function') {
          pending.add(promise);
          promise.then(() => pending.delete(promise), error => { pending.delete(promise); scriptError = error; });
        }
        return promise;
      };
    }
    const finishScripts = async () => {
      while (pending.size) await Promise.all([...pending]);
      if (scriptError) { const error = scriptError; scriptError = undefined; throw error; }
    };
    const snapshot = () => ({ title: action.title, badge: action.badge, ready: clicked.hasListeners(),
      menus: Object.values(menus).filter(item => item.contexts?.includes('action')).map(item => ({id:item.id,title:item.title,checked:item.checked,type:item.type})) });
    let initialized, initializationReady = false;
    const initialize = () => initialized ||= (async () => {
      await restored;
      const currentVersion = chrome.runtime.getManifest().version;
      // Dynamic scripts can survive worker restarts. Google's lifecycle handler
      // registers autoPip again, so release that registration before delivering it.
      const scripts = await chrome.scripting.getRegisteredContentScripts({ids:['autoPip']});
      if (scripts.length) await chrome.scripting.unregisterContentScripts({ids:['autoPip']});
      if (version !== currentVersion || !Object.hasOwn(menus, 'autoPip')) {
        menus = {};
        await installed.dispatch({reason: version ? 'update' : 'install', ...(version ? {previousVersion:version} : {})});
      } else await startup.dispatch();
      await finishScripts();
      version = currentVersion;
      await save();
      initializationReady = true;
    })();
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (message?.breadboardPipHost !== 1 || sender.id !== chrome.runtime.id || sender.url !== bridgeUrl) return;
      (async () => {
        // Keep the click's native user gesture through the synchronous listener
        // dispatch; it authorizes Google's requestPictureInPicture call.
        if (!initializationReady) await initialize();
        if (message.type === 'action') await clicked.dispatch(message.tab);
        else if (message.type === 'menu') {
          const item = menus[message.id];
          if (!item || !item.contexts?.includes('action')) throw new Error('Unknown action menu');
          const wasChecked = Boolean(item.checked);
          if (item.type === 'checkbox') item.checked = !wasChecked;
          await menuClicked.dispatch({menuItemId:item.id, wasChecked, checked:item.checked}, message.tab);
        } else if (message.type !== 'state') throw new Error('Unknown extension host command');
        await finishScripts();
        await save();
        reply({ok:true, state:snapshot()});
      })().catch(error => reply({ok:false, error:String(error?.message || error)}));
      return true;
    });
  })();`;
}
