import { useState } from "react";
import { createRoot } from "react-dom/client";
import VoiceAssistantPanel from "../../../dashboard/src/app/profile/voice-assistant-panel";

function ProfileControls() {
  const [limit, setLimit] = useState(5);
  const [channel, setChannel] = useState("off");
  return <>
    {/* Profile's activity calendar can precede hundreds of settings controls. */}
    {Array.from({ length: 305 }, (_, index) => <button key={index}>Activity {index}</button>)}
    <VoiceAssistantPanel />
    <section><h2>Review delivery</h2>
      <label>Questions per day<input type="range" min="1" max="50" step="1" value={limit} onChange={event => setLimit(Number(event.target.value))} /></label>
      <output>Daily limit: {limit}</output>
      <label>Delivery channel<select value={channel} onChange={event => setChannel(event.target.value)}>
        <option value="off">Off</option><option value="telegram">Telegram</option><option value="whatsapp" disabled>WhatsApp</option>
      </select></label>
      <output>Channel: {channel}</output>
    </section>
    <section><h2>Other switches</h2>
      <label>Native checkbox<input type="checkbox" /></label>
      <span id="custom-switch-label">Custom switch</span>
      <div role="switch" tabIndex={0} aria-labelledby="custom-switch-label" aria-checked="false" onClick={event => {
        const el = event.currentTarget; el.setAttribute("aria-checked", String(el.getAttribute("aria-checked") !== "true"));
      }}>Switch</div>
      <button role="switch" aria-label="Blocked switch" aria-checked="false" aria-disabled="true" onClick={() => { throw new Error("Disabled switch must not run"); }}>Blocked</button>
      <button role="switch" aria-label="Read-only switch" aria-checked="false" aria-readonly="true">Read only</button>
    </section>
  </>;
}

createRoot(document.getElementById("profile-controls")!).render(<ProfileControls />);
