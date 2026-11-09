import type { GestureControlAction, GestureControlState, GestureSettings, HandGestureAction } from "../../../desktop/src/shared/gesture-control";
export type { GestureControlAction, GestureControlState, GestureSettings, HandGestureAction };

export function gestureControlBridge() {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { breadboardDesktop?: {
    gestureControl?: (action: GestureControlAction, settings?: GestureSettings) => Promise<GestureControlState>;
  } }).breadboardDesktop?.gestureControl;
}
