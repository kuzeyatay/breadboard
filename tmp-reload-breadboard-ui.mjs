const endpoint = "http://127.0.0.1:62519/json/list";

const targets = await fetch(endpoint).then((response) => {
  if (!response.ok) throw new Error(`DevTools target listing failed: HTTP ${response.status}`);
  return response.json();
});

const localPages = targets.filter(
  (target) =>
    target?.type === "page" &&
    typeof target.url === "string" &&
    target.url.startsWith("http://127.0.0.1:51857/") &&
    typeof target.webSocketDebuggerUrl === "string",
);

if (localPages.length === 0) {
  throw new Error("No Breadboard renderer pages were exposed by Electron DevTools.");
}

function reload(target) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out reloading ${target.url}`));
    }, 10_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Page.reload", params: { ignoreCache: true } }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(`${target.url}: ${message.error.message}`));
      else resolve({ id: target.id, title: target.title, url: target.url });
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`DevTools socket failed for ${target.url}`));
    });
  });
}

const reloaded = await Promise.all(localPages.map(reload));
console.log(JSON.stringify({ reloadedCount: reloaded.length, reloaded }, null, 2));
