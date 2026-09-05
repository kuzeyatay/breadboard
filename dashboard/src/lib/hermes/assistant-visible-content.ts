import { openGymVisibleContent } from "../open-gym/result.ts";

/**
 * Text shown in the ordinary assistant response body.
 *
 * Hermes keeps public, pre-tool narration separate from the durable answer so
 * the final response can replace it cleanly. Progress narration is disclosed
 * by the response's Thinking row; it must never masquerade as answer text.
 */
export function assistantVisibleContent(content: string): string {
  return content.trim() ? openGymVisibleContent(content) : "";
}
