export const INTERACTION_HYDRATION_BRIDGE_KEY = "__breadboardInteractionHydration";

type InteractionHydrationBridge = {
  ready: boolean;
  finish: () => void;
};

declare global {
  interface Window {
    __breadboardInteractionHydration?: InteractionHydrationBridge;
  }
}

/**
 * Runs from the document head, before controls are parsed or painted. React can
 * then replay a click that lands in the short interval before its delegated
 * listeners exist. The script changes no DOM or styling, so page roots remain
 * direct body children for the desktop layout selectors.
 */
export const interactionHydrationBootstrapScript = `(()=>{const key="${INTERACTION_HYDRATION_BRIDGE_KEY}";if(window[key])return;const pending=[];const capture=(event)=>{const bridge=window[key];if(!bridge||bridge.ready)return;const target=event.target;if(!(target instanceof Element))return;event.preventDefault();event.stopImmediatePropagation();pending.push({target,init:{bubbles:true,cancelable:true,composed:true,detail:event.detail,screenX:event.screenX,screenY:event.screenY,clientX:event.clientX,clientY:event.clientY,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,altKey:event.altKey,metaKey:event.metaKey,button:event.button,buttons:event.buttons}})};window[key]={ready:false,finish(){if(this.ready)return;this.ready=true;document.removeEventListener("click",capture,true);const clicks=pending.splice(0);for(const click of clicks){let target=click.target;if(!target.isConnected&&target.id)target=document.getElementById(target.id);if(!target||!target.isConnected)continue;target.dispatchEvent(new MouseEvent("click",click.init))}}};document.addEventListener("click",capture,true)})();`;

export function finishInteractionHydration(targetWindow: Window): void {
  targetWindow.__breadboardInteractionHydration?.finish();
}
