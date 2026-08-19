// Vendored from simstudioai/sim (Apache-2.0), apps/sim/triggers/slack/shared.ts, adapted for Breadboard.
// Pruned: only the unified output schema is kept. The event catalog, filter
// helpers, and dropdown option lists belong to sim's native `slack_app` OAuth
// trigger, which Breadboard does not ship (Hooks use the bring-your-own-app
// `slack_webhook` trigger with a signing secret).

import type { TriggerOutput } from '../types'

/**
 * Unified Slack trigger output shape. Events API / interactivity /
 * slash-command payloads are normalized into this shape by the Slack webhook
 * provider handler, so downstream consumers resolve identically regardless of
 * payload family.
 */
export const SLACK_TRIGGER_OUTPUTS: Record<string, TriggerOutput> = {
  event: {
    type: 'object',
    description: 'Slack event data',
    properties: {
      event_type: {
        type: 'string',
        description:
          'Type of Slack payload: an Events API event (e.g., app_mention, message), an interactivity type (e.g., block_actions), or "slash_command" for slash commands',
      },
      subtype: {
        type: 'string',
        description:
          'Message subtype (e.g., channel_join, channel_leave, bot_message, file_share). Null for regular user messages',
      },
      channel: {
        type: 'string',
        description: 'Slack channel ID where the event occurred',
      },
      channel_name: {
        type: 'string',
        description: 'Human-readable channel name',
      },
      channel_type: {
        type: 'string',
        description:
          'Type of channel (e.g., channel, group, im, mpim). Useful for distinguishing DMs from public channels',
      },
      user: {
        type: 'string',
        description: 'User ID who triggered the event',
      },
      user_name: {
        type: 'string',
        description: 'Username who triggered the event',
      },
      bot_id: {
        type: 'string',
        description: 'Bot ID if the message was sent by a bot. Null for human users',
      },
      text: {
        type: 'string',
        description:
          'Message text content. For slash commands, the text after the command. For interactivity, the source message text (falls back to the triggering action value)',
      },
      timestamp: {
        type: 'string',
        description: 'Message timestamp from the triggering event',
      },
      thread_ts: {
        type: 'string',
        description: 'Parent thread timestamp (if message is in a thread)',
      },
      team_id: {
        type: 'string',
        description: 'Slack workspace/team ID',
      },
      event_id: {
        type: 'string',
        description: 'Unique event identifier',
      },
      reaction: {
        type: 'string',
        description:
          'Emoji reaction name (e.g., thumbsup). Present for reaction_added/reaction_removed events',
      },
      item_user: {
        type: 'string',
        description:
          'User ID of the original message author. Present for reaction_added/reaction_removed events',
      },
      command: {
        type: 'string',
        description:
          'Slash command name including the leading slash (e.g., /deploy). Present for slash commands',
      },
      action_id: {
        type: 'string',
        description:
          'action_id of the first interactive element triggered. Present for block_actions (button/select clicks)',
      },
      action_value: {
        type: 'string',
        description:
          'Value carried by the first interactive element (button value, selected option, date, etc.). Present for block_actions',
      },
      actions: {
        type: 'json',
        description:
          'Full array of interactive actions from the payload, preserving every element and its value. Present for block_actions',
      },
      response_url: {
        type: 'string',
        description:
          'Temporary URL to post a response back to the originating message or command. Present for interactivity and slash commands',
      },
      trigger_id: {
        type: 'string',
        description:
          'Short-lived trigger ID used to open a modal in response. Present for interactivity and slash commands',
      },
      callback_id: {
        type: 'string',
        description:
          'Callback ID of the shortcut or view. Present for shortcuts and modal submissions',
      },
      api_app_id: {
        type: 'string',
        description: 'Slack app ID. Present for interactivity and slash commands',
      },
      app_id: {
        type: 'string',
        description:
          "App ID of the app that produced the event (e.g. the bot that posted a message). Used to identify the app's own output",
      },
      message_ts: {
        type: 'string',
        description:
          'Timestamp of the message the interaction originated from. Present for block_actions',
      },
      view: {
        type: 'json',
        description:
          'Full Slack view object for modal interactions: state.values (submitted input values), private_metadata, id, callback_id, and hash. Present for view_submission/view_closed; null otherwise',
      },
      message: {
        type: 'json',
        description:
          'Full source message object the interaction came from, including its blocks and text. Present for block_actions on a message; null otherwise',
      },
      state: {
        type: 'json',
        description:
          'Current values of all stateful elements in the surface (state.values) at the time of a block action — e.g. inputs read on a button click. Present for block_actions; null otherwise',
      },
      hasFiles: {
        type: 'boolean',
        description: 'Whether the message has file attachments',
      },
      files: {
        type: 'file[]',
        description:
          'File attachments downloaded from the message (if includeFiles is enabled and bot token is provided)',
      },
    },
  },
}
