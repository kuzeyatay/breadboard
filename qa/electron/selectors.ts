import type { Locator, Page } from "playwright";

type Role = Parameters<Page["getByRole"]>[0];
type RoleOptions = NonNullable<Parameters<Page["getByRole"]>[1]>;
type LabelOptions = NonNullable<Parameters<Page["getByLabel"]>[1]>;
type PlaceholderOptions = NonNullable<Parameters<Page["getByPlaceholder"]>[1]>;
type TextOptions = NonNullable<Parameters<Page["getByText"]>[1]>;
type SemanticName = string | RegExp;

export interface RoleSelector {
  readonly kind: "role";
  readonly role: Role;
  readonly name: SemanticName;
  readonly exact?: RoleOptions["exact"];
}

export interface LabelSelector {
  readonly kind: "label";
  readonly label: SemanticName;
  readonly exact?: LabelOptions["exact"];
}

export interface PlaceholderSelector {
  readonly kind: "placeholder";
  readonly placeholder: SemanticName;
  readonly exact?: PlaceholderOptions["exact"];
}

export interface TextSelector {
  readonly kind: "text";
  readonly text: SemanticName;
  readonly exact?: TextOptions["exact"];
}

export type SemanticSelector =
  | RoleSelector
  | LabelSelector
  | PlaceholderSelector
  | TextSelector;
export type SelectorRoot = Page | Locator;

export function role(
  ariaRole: Role,
  name: SemanticName,
  exact?: boolean,
): RoleSelector {
  return { kind: "role", role: ariaRole, name, ...(exact === undefined ? {} : { exact }) };
}

export function label(labelText: SemanticName, exact?: boolean): LabelSelector {
  return {
    kind: "label",
    label: labelText,
    ...(exact === undefined ? {} : { exact }),
  };
}

export function placeholder(
  placeholderText: SemanticName,
  exact?: boolean,
): PlaceholderSelector {
  return {
    kind: "placeholder",
    placeholder: placeholderText,
    ...(exact === undefined ? {} : { exact }),
  };
}

export function text(textValue: SemanticName, exact?: boolean): TextSelector {
  return { kind: "text", text: textValue, ...(exact === undefined ? {} : { exact }) };
}

/** Resolve a semantic constant against either a Page or an already-scoped Locator. */
export function locate(root: SelectorRoot, selector: SemanticSelector): Locator {
  switch (selector.kind) {
    case "role":
      return root.getByRole(selector.role, {
        name: selector.name,
        ...(selector.exact === undefined ? {} : { exact: selector.exact }),
      });
    case "label":
      return root.getByLabel(selector.label, {
        ...(selector.exact === undefined ? {} : { exact: selector.exact }),
      });
    case "placeholder":
      return root.getByPlaceholder(selector.placeholder, {
        ...(selector.exact === undefined ? {} : { exact: selector.exact }),
      });
    case "text":
      return root.getByText(selector.text, {
        ...(selector.exact === undefined ? {} : { exact: selector.exact }),
      });
    default:
      // A selector constant with an unrecognised kind is a harness defect.
      // Returning `undefined` here would make a downstream truthiness check
      // pass while nothing was ever queried, so fail loudly instead.
      throw new Error(
        `Unsupported QA selector kind: ${JSON.stringify((selector as { kind?: unknown }).kind)}`,
      );
  }
}

/**
 * Product-language selectors shared by scenarios. Dynamic entities should be
 * found by their visible user-provided names and scoped to the containing row.
 */
export const SELECTORS = {
  startup: {
    loading: role("region", "Loading Breadboard", true),
    continue: role("button", "Welcome to Breadboard. Press space to continue.", true),
    retry: role("button", "Retry", true),
    openLogs: role("button", "Open logs", true),
    copyDiagnostics: role("button", "Copy diagnostics", true),
    quit: role("button", "Quit", true),
    failureHeading: role("heading", "A service could not start", true),
    reconnecting: role("heading", "Reconnecting to your workspace", true),
  },
  auth: {
    signInHeading: role("heading", "Sign in", true),
    createAccountHeading: role("heading", "Create account", true),
    inviteCode: label("Invite code", true),
    username: label("Username", true),
    email: label("Email", true),
    password: label("Password", true),
    confirmPassword: label("Confirm password", true),
    signIn: role("button", "Sign in", true),
    createAccount: role("button", "Create account", true),
  },
  navigation: {
    gardens: role("link", "Gardens", true),
    myGardens: role("button", "My gardens", true),
    publicGardens: role("button", "Public gardens", true),
  },
  gardens: {
    newGarden: role("button", "New garden", true),
    newGardenHeading: role("heading", "New garden", true),
    name: placeholder("My garden", true),
    description: placeholder("What's this garden about?", true),
    create: role("button", "Create", true),
    save: role("button", "Save", true),
    cancel: role("button", "Cancel", true),
    searchMine: placeholder("Search your gardens", true),
    searchPublic: placeholder("Search public gardens", true),
    clearSearch: role("button", "Clear search", true),
    edit: role("button", "Edit garden", true),
    export: role("button", "Export garden", true),
    openView: role("link", "Explore", true),
    openDashboard: role("link", "Workspace", true),
  },
  workspace: {
    documents: role("button", /^Documents(?: \(\d+(?:\/\d+)?\))?$/),
    addDocument: role("button", "Add document", true),
    generateLearningMap: label("Generate Learning Map", true),
    sourceLabel: placeholder("e.g. Lecture 3, Chapter 5", true),
    upload: role("button", /^Upload(?: \d+ files?)?$/),
    uploadComplete: text("Upload complete", true),
    cancelUpload: role("button", /^(?:Cancel|Cancel upload)$/),
    closeUpload: role("button", "Close", true),
    newChat: role("button", "New chat", true),
    chatComposer: placeholder("Ask about your documents…", true),
    renameChat: role("button", "Rename chat", true),
    deleteChat: role("button", "Delete chat", true),
    videos: role("button", /^Videos(?:$|\s|\()/),
    videoFile: label("Video file", true),
    transcribeVideo: role("button", "Transcribe video", true),
  },
  terminal: {
    open: role("button", "Open terminal", true),
    toggleSidebar: role("button", "Toggle the sidebar", true),
    reconnect: role("button", /^(?:Reconnect terminal|Refreshing terminal connection)$/),
    runtimeStatus: role("status", /^Agent runtime is (?:available|unavailable)$/),
    composer: placeholder(/^Ask anything across (?:your|all public) gardens…$/),
    actions: role("navigation", "Terminal actions", true),
    newChat: role("button", "New chat", true),
    artifacts: role("button", "Artifacts", true),
    uploads: role("button", "Uploads", true),
    search: role("button", "Search", true),
    scheduled: role("button", "Scheduled", true),
    hooks: role("button", "Hooks", true),
    processes: role("button", "Processes", true),
  },
  capabilities: {
    open: role("button", "Open capabilities", true),
    close: role("button", "Close capabilities", true),
    tabs: role("tablist", "Capability types", true),
    skills: role("tab", "Skills", true),
    workflows: role("tab", "Workflows", true),
    agents: role("tab", "Agents", true),
    prompts: role("tab", "Prompts", true),
    agentsList: role("listbox", "Agents", true),
    searchAgents: label("Search agents", true),
    searchAgencyAgents: label("Search Agency agents", true),
    skillsCatalog: role("region", "skills.sh catalog", true),
    searchSkills: label("Search skills.sh", true),
    filterSkills: role("button", /^Filter skills:/),
    publicSkills: role("listbox", "Public skills", true),
    backToSkills: role("button", /Back to skills/),
  },
  artifacts: {
    panel: role("region", "Artifacts", true),
    search: label("Search artifacts", true),
    empty: text("No artifacts yet.", true),
  },
  common: {
    dialog: role("dialog", /.+/),
    alert: role("alert", /.+/),
    status: role("status", /.+/),
    yes: role("button", "Yes", true),
    no: role("button", "No", true),
    close: role("button", "Close", true),
  },
} as const;

/** Lower-case alias for ergonomic imports. */
export const selectors = SELECTORS;
