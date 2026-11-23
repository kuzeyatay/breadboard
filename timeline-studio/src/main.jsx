import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { registerModelCacheServiceWorker } from "./lib/serviceWorker.js";
import { connectHostSession } from "./lib/hostSession.js";
import { getStoredLanguage } from "./i18n.js";
import { hostText } from "./i18nHost.js";
import "./styles.css";

registerModelCacheServiceWorker();

const rootElement = document.getElementById("root");
void connectHostSession().then((hostSession) => {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App hostSession={hostSession} />
    </React.StrictMode>,
  );
}).catch(() => {
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = hostText(getStoredLanguage(), "expired");
  rootElement.replaceChildren(message);
});
