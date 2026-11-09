'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import dynamic from 'next/dynamic';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronRight, FolderOpen, Paperclip, PencilLine, Plus, Settings2, Sprout } from 'lucide-react';
import { uniqueAddConnections, connectionPresentation, matchesAddQuery, type ComposerAppConnection } from '@/lib/composer-add-options';
import type { DirectCommandGroups } from '@/lib/hermes/direct-slash-commands';
import type { HermesSurface } from '@/lib/hermes/config';
import { commandResponseUrl, loadCachedCommandResponse, peekCachedCommandResponse } from '@/lib/hermes/command-client-cache';
import ComposerGardenPicker from './composer-garden-picker';

const ComposerSketchDialog = dynamic(() => import('./composer-sketch-dialog'), { ssr: false });
const menuClass = 'z-[160] max-w-[calc(100vw-24px)] rounded-2xl border border-[color-mix(in_srgb,var(--ink)_10%,transparent)] bg-[var(--paper-raised)] p-1.5 text-[var(--ink)] shadow-[0_4px_16px_rgb(0_0_0/8%)]';
const itemClass = 'flex min-h-9 cursor-default select-none items-center gap-2 rounded-lg px-2 py-2 text-[13px] leading-5 outline-none data-[highlighted]:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&>svg]:shrink-0 [&>svg]:text-[var(--ink-muted)] [&>svg]:stroke-[1.75]';
const hintClass = 'min-w-0 truncate text-xs text-[var(--ink-muted)]';
const labelClass = 'px-2 pb-1 pt-2 text-xs text-[var(--ink-muted)]';
type Catalog = { groups: DirectCommandGroups; notices?: { connections?: string | null } };

function ConnectionLogo({ connection }: { connection: ComposerAppConnection }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const logoUrl = connection.logoUrl?.trim();
  return <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center">
    {logoUrl && failedUrl !== logoUrl ? (
      // Provider logos may be authenticated local SVGs or external catalogue assets.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain"
        referrerPolicy="no-referrer" onError={() => setFailedUrl(logoUrl)} />
    ) : <span className="text-[11px] font-semibold text-[#6750a4]">{connection.name.slice(0, 1).toUpperCase()}</span>}
  </span>;
}

export interface ComposerAddMenuHandle {
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
}

export interface ComposerAddMenuProps {
  onAddDocuments: () => void;
  onAddFiles?: (files: File[]) => void | Promise<void>;
  onOpenGardenChat?: (chatId: string) => void;
  sessionId?: string | number | null;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  anchorRef?: RefObject<HTMLDivElement | null>;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  query?: string;
  surface?: HermesSurface;
  onManageConnections?: () => void;
  onSelectConnection?: (connection: ComposerAppConnection) => void;
}

const ComposerAddMenu = forwardRef<ComposerAddMenuHandle, ComposerAddMenuProps>(function ComposerAddMenu({ onAddDocuments, onAddFiles,
  onOpenGardenChat, sessionId, disabled, busy, compact, anchorRef, inputRef,
  open: controlledOpen, onOpenChange, query = '', surface = 'dashboard_terminal', onManageConnections, onSelectConnection }, ref) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  const [panel, setPanel] = useState<'sketch' | 'garden' | null>(null);
  const [error, setError] = useState('');
  const folderRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreInputFocusRef = useRef(true);
  const responseUrl = commandResponseUrl({ surface, sessionId });
  const [catalog, setCatalog] = useState<{ url: string; data: Catalog } | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [reload, setReload] = useState(0);
  const [apps, setApps] = useState<{ url: string; connections: ComposerAppConnection[] } | null>(null);
  const [appsError, setAppsError] = useState('');
  const data = catalog?.url === responseUrl ? catalog.data : peekCachedCommandResponse<Catalog>(responseUrl);
  const appsPending = Boolean(onSelectConnection && ((apps?.url !== responseUrl && !appsError) || (!data && !catalogError)));
  const connectedApps = onSelectConnection && apps?.url === responseUrl && data && !appsError && !catalogError
    ? uniqueAddConnections(apps.connections, data.groups.mcp ?? []) : [];
  const appOptions = connectedApps.filter(app => matchesAddQuery(query, app.name, app.slug, connectionPresentation(app).description));
  const matches = (...text: string[]) => matchesAddQuery(query, ...text);
  const hasBase = matches('Files and folders Choose files Choose folder attachments') ||
    (onOpenGardenChat && matches('Work in a garden Choose a chat')) ||
    matches('Sketch Draw a sketch');
  const hasMore = onManageConnections && matches('Manage connections apps plugins');
  const [position, setPosition] = useState({ alignOffset: 0, sideOffset: 8, maxWidth: 384 });
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const anchor = anchorRef?.current;
    if (!trigger || !anchor) return;
    const triggerBox = trigger.getBoundingClientRect();
    const anchorBox = anchor.getBoundingClientRect();
    // Keep the menu above the whole composer, including multiline drafts and attachments.
    const next = {
      alignOffset: anchorBox.left - triggerBox.left,
      sideOffset: triggerBox.top - anchorBox.top + 8,
      maxWidth: Math.min(anchorBox.width, window.innerWidth - 24),
    };
    setPosition(current => current.alignOffset === next.alignOffset && current.sideOffset === next.sideOffset && current.maxWidth === next.maxWidth ? current : next);
  }, [anchorRef]);

  useEffect(() => {
    if (!open || !anchorRef?.current || !triggerRef.current) return;
    const observer = new ResizeObserver(updatePosition);
    observer.observe(anchorRef.current);
    observer.observe(triggerRef.current);
    window.addEventListener('resize', updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, anchorRef, updatePosition]);

  useEffect(() => {
    if (!open || !inputRef) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, inputRef]);

  useEffect(() => {
    if (!open || !onSelectConnection) return;
    let cancelled = false;
    setCatalogError('');
    // Read the slash catalogue only to exclude connections already available there.
    void loadCachedCommandResponse<Catalog>(responseUrl, { force: true }).then(data => {
      if (!cancelled) setCatalog({ url: responseUrl, data });
    }).catch(() => {
      if (!cancelled) setCatalogError('App connections could not be checked.');
    });
    return () => { cancelled = true; };
    // Selecting changes with the draft; fetching is tied only to opening and scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, responseUrl, reload, Boolean(onSelectConnection)]);

  useEffect(() => {
    if (!open || !onSelectConnection) return;
    const controller = new AbortController();
    setAppsError('');
    void fetch('/api/hermes/composio/integrations', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Connections unavailable');
        const result = await response.json();
        if (!controller.signal.aborted) setApps({ url: responseUrl, connections: Array.isArray(result.integrations) ? result.integrations : [] });
      }).catch(() => { if (!controller.signal.aborted) setAppsError('App connections could not be loaded.'); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, responseUrl, reload, Boolean(onSelectConnection)]);

  useImperativeHandle(ref, () => ({
    handleKeyDown(event) {
      if (!open || event.nativeEvent.isComposing) return false;
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return true; }
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return false;
      event.preventDefault();
      const items = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([data-disabled])') ?? []);
      const item = event.key === 'ArrowUp' ? items.at(-1) : items[0];
      if (event.key === 'Enter') item?.click();
      else item?.focus();
      return true;
    },
  }));

  function closePanel() {
    setPanel(null);
    requestAnimationFrame(() => (inputRef?.current ?? triggerRef.current)?.focus());
  }

  return <>
    <DropdownMenu.Root open={open} onOpenChange={(nextOpen) => {
      if (nextOpen) { updatePosition(); restoreInputFocusRef.current = true; }
      setOpen(nextOpen);
    }} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button ref={triggerRef} type="button" disabled={disabled || busy}
          className={`neu-button-icon flex shrink-0 items-center justify-center rounded-full text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-40 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
          title="Add to chat" aria-label="Add to chat" aria-busy={busy}>
          <Plus className={`h-5 w-5 ${busy ? 'animate-pulse' : ''}`} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" alignOffset={position.alignOffset} sideOffset={position.sideOffset} collisionPadding={12}
          ref={contentRef} id="composer-add-menu" aria-label="Add to chat"
          style={{ maxWidth: `min(${position.maxWidth}px, calc(100vw - 24px))` }}
          className={`${menuClass} w-96 max-h-[min(28rem,60vh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overscroll-contain`}
          onInteractOutside={(event) => {
            const target = event.target;
            if (target === inputRef?.current || target === inputRef?.current?.parentElement || target === anchorRef?.current ||
              (target instanceof Element && target.closest('button:disabled') && anchorRef?.current?.contains(target))) event.preventDefault();
            else restoreInputFocusRef.current = false;
          }}
          onCloseAutoFocus={(event) => {
            if (panel || inputRef) event.preventDefault();
            if (!panel && inputRef && restoreInputFocusRef.current) requestAnimationFrame(() => inputRef.current?.focus());
          }}>
          {hasBase && <DropdownMenu.Label className={labelClass}>Add</DropdownMenu.Label>}
          {matches('Files and folders Choose files Choose folder attachments') && <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className={itemClass}>
              <Paperclip size={17} /><span className="shrink-0">Files and folders</span><ChevronRight size={14} className="ml-auto" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className={`${menuClass} w-48`} sideOffset={5} collisionPadding={12}>
                <DropdownMenu.Item className={itemClass} onSelect={onAddDocuments}><Paperclip size={17} />Choose files</DropdownMenu.Item>
                <DropdownMenu.Item className={itemClass} disabled={!onAddFiles} onSelect={() => folderRef.current?.click()}><FolderOpen size={17} />Choose folder</DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>}
          {onOpenGardenChat && matches('Work in a garden Choose a chat') && <DropdownMenu.Item className={itemClass} onSelect={() => setPanel('garden')}>
            <Sprout size={17} /><span className="shrink-0">Work in a garden</span><span className={hintClass}>Choose a chat</span>
          </DropdownMenu.Item>}
          {matches('Sketch Draw a sketch') && <DropdownMenu.Item className={itemClass} disabled={!onAddFiles} onSelect={() => setPanel('sketch')}>
            <PencilLine size={17} /><span className="shrink-0">Sketch</span><span className={hintClass}>Draw a sketch</span>
          </DropdownMenu.Item>}
          {appOptions.length > 0 && <DropdownMenu.Group>
            <DropdownMenu.Label className={labelClass}>Apps</DropdownMenu.Label>
            {appOptions.map(app => {
              const presentation = connectionPresentation(app);
              return <DropdownMenu.Item key={app.slug} className={itemClass} onSelect={() => onSelectConnection?.(app)} title={presentation.description}>
                <ConnectionLogo connection={app} /><span className="max-w-[50%] shrink-0 truncate">{app.name}</span><span className={hintClass}>{presentation.description}</span>
              </DropdownMenu.Item>;
            })}
          </DropdownMenu.Group>}
          {hasMore && <DropdownMenu.Label className={labelClass}>More</DropdownMenu.Label>}
          {onManageConnections && matches('Manage connections apps plugins') && <DropdownMenu.Item className={itemClass} onSelect={() => { restoreInputFocusRef.current = false; onManageConnections(); }}>
            <Settings2 size={17} /><span>Manage connections</span><ChevronRight size={14} className="ml-auto" />
          </DropdownMenu.Item>}
          {appsPending && <p role="status" className="px-2 py-2 text-xs text-[var(--ink-muted)]">Loading app connections…</p>}
          {(catalogError || appsError || data?.notices?.connections) && <DropdownMenu.Item className={itemClass} onSelect={event => { event.preventDefault(); setReload(value => value + 1); }}>
            <span className="min-w-0 text-xs text-[var(--ink-muted)]">{catalogError || appsError || data?.notices?.connections} Retry</span>
          </DropdownMenu.Item>}
          {!hasBase && !hasMore && !appOptions.length && !appsPending && !catalogError && !appsError && <p role="status" className="px-2 py-4 text-sm text-[var(--ink-muted)]">No options match “{query}”.</p>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <input ref={folderRef} type="file" multiple hidden aria-label="Attach folder"
      {...{ webkitdirectory: '', directory: '' }}
      onChange={async (event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        if (!files.length) return;
        setError('');
        try { await onAddFiles?.(files); }
        catch { setError('The folder could not be attached. Please try again.'); }
      }} />
    {error && <span role="alert" className="text-xs text-[var(--danger)]">{error}</span>}
    {panel === 'sketch' && onAddFiles && <ComposerSketchDialog onClose={closePanel} onAttach={onAddFiles} />}
    {panel === 'garden' && onOpenGardenChat && <ComposerGardenPicker currentChatId={String(sessionId ?? '')}
      onClose={closePanel} onSelect={(id) => { onOpenGardenChat(id); closePanel(); }} />}
  </>;
});

export default ComposerAddMenu;
