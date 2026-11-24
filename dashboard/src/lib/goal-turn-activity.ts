export const GOAL_TURN_EVENT = "breadboard:goal-turn";

export interface GoalTurnSnapshot {
  clientMessageId: string;
  status: string;
}
