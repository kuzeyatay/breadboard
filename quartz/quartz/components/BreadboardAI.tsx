// Breadboard page-scoped AI panel for Quartz.
//
// This renders a floating "Ask AI" control and a drawer. All intelligence lives
// in the Breadboard dashboard: the browser talks ONLY to the dashboard API
// (never OpenHarness directly). The panel is read-only by default; any write is
// a typed proposal handled by Breadboard.
//
// The dashboard base URL is configurable for Quartz builds via the
// BREADBOARD_DASHBOARD_URL env var (read at build time here). The current
// garden id and page slug are derived from the page's own slug and passed as
// data attributes for the client script.

// @ts-ignore - resolved by esbuild at build time
import script from "./scripts/breadboardAI.inline"
import styles from "./styles/breadboardAI.scss"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

function dashboardUrl(): string {
  return process.env.BREADBOARD_DASHBOARD_URL ?? "http://localhost:3000"
}

const BreadboardAI: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
  const slug = String(fileData.slug ?? "")
  // Garden id is the first path segment of the page slug (content/<garden>/...).
  const gardenId = slug.split("/")[0] ?? ""
  const pageTitle = String(fileData.frontmatter?.title ?? "")

  // Do not render on the top-level index (no garden context).
  if (!gardenId || slug === "index") return null

  return (
    <div
      class="breadboard-ai"
      data-dashboard={dashboardUrl()}
      data-garden={gardenId}
      data-page={slug}
      data-title={pageTitle}
    >
      <button
        class="breadboard-ai-toggle"
        aria-label="Ask AI about this page"
        title="Ask AI about this page"
      >
        <span class="breadboard-ai-toggle-icon" aria-hidden="true">
          ✦
        </span>
        <span class="breadboard-ai-toggle-label">Ask AI</span>
      </button>

      <div class="breadboard-ai-panel" role="dialog" aria-label="Page AI assistant" hidden>
        <div class="breadboard-ai-header">
          <div class="breadboard-ai-context" aria-live="polite">
            <span class="breadboard-ai-dot" aria-hidden="true"></span>
            <span class="breadboard-ai-page-name"></span>
          </div>
          <div class="breadboard-ai-header-actions">
            <button class="breadboard-ai-new" title="Start a new chat">
              New chat
            </button>
            <button
              class="breadboard-ai-history-toggle"
              title="Show past chats on this page"
              aria-expanded="false"
            >
              History
            </button>
            <button class="breadboard-ai-close" aria-label="Close AI panel">
              ✕
            </button>
          </div>
        </div>

        <div class="breadboard-ai-history" hidden>
          <div class="breadboard-ai-history-status" aria-live="polite"></div>
          <ul class="breadboard-ai-history-list"></ul>
        </div>

        <div class="breadboard-ai-actions">
          <button data-prompt="Explain this page from first principles.">Explain</button>
          <button data-prompt="Give a concrete worked example based on this page.">Example</button>
          <button data-prompt="Quiz me on this page.">Quiz me</button>
          <button data-prompt="Show the sources this page is grounded in.">Sources</button>
          <button data-prompt="Find connections between this page and related notes.">
            Connections
          </button>
        </div>

        <div class="breadboard-ai-messages" aria-live="polite"></div>

        <div class="breadboard-ai-error" role="alert" hidden></div>

        <section class="breadboard-ai-activity" hidden>
          <div class="breadboard-ai-activity-header">
            <span class="breadboard-ai-activity-title">Working</span>
            <button type="button" class="breadboard-ai-activity-toggle">
              Hide activity
            </button>
            <button type="button" class="breadboard-ai-stop" hidden>
              Stop
            </button>
          </div>
          <ol class="breadboard-ai-activity-list"></ol>
          <div class="breadboard-ai-permission" hidden></div>
          <details class="breadboard-ai-evidence" hidden>
            <summary>Evidence</summary>
            <div class="breadboard-ai-evidence-body"></div>
          </details>
        </section>

        <form class="breadboard-ai-composer">
          <textarea
            class="breadboard-ai-input"
            rows={2}
            placeholder="Ask about this page…"
            aria-label="Ask about this page"
          ></textarea>
          <div class="breadboard-ai-command-hub" hidden>
            <input
              class="breadboard-ai-command-search"
              type="search"
              placeholder="Search skills, MCP, and prompts…"
              aria-label="Search commands"
            />
            <div class="breadboard-ai-command-results"></div>
            <div class="breadboard-ai-command-status" aria-live="polite"></div>
          </div>
          <div class="breadboard-ai-composer-row">
            <button
              type="button"
              class="breadboard-ai-command-button"
              aria-label="Open command hub"
              aria-expanded="false"
            >
              /
            </button>
            <div class="breadboard-ai-intelligence" hidden>
              <select class="breadboard-ai-model" aria-label="Model"></select>
              <select class="breadboard-ai-effort" aria-label="Reasoning effort"></select>
            </div>
            <button type="submit" class="breadboard-ai-send">
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

BreadboardAI.afterDOMLoaded = script
BreadboardAI.css = styles

export default (() => BreadboardAI) satisfies QuartzComponentConstructor
