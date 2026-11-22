// Injected into Doory's index.html by serve.py when it runs inside Breadboard's Design page.
// It reports where the editor is, wears Breadboard's live theme, and drops Doory's own name and bunny.
(function () {
  var NAME = /\bDoory\b/g;
  var THEME_KEY = 'bb-design-theme';
  var FONT = "'Source Sans 3', 'Source Sans Pro', Arial, Helvetica, sans-serif";

  function mix(color, percent, base) { return 'color-mix(in srgb, ' + color + ' ' + percent + '%, ' + base + ')'; }

  // Breadboard's tokens (paper, ink, botanical) onto Doory's, so every Doory surface follows the app theme.
  function applyTheme(t) {
    if (!t || !t.bg) return;
    var a = t.accent, raised = t.raised;
    var shadow = t.scheme === 'dark' ? '0 0 0' : '19 32 27';
    var vars = {
      '--color-bg': t.bg, '--color-bg-subtle': t.surface, '--color-bg-muted': t.strong,
      '--color-surface': raised, '--color-surface-raised': raised, '--color-canvas-workspace': t.bg,
      '--color-border': t.line, '--color-border-strong': t.lineStrong, '--color-checker': t.lineStrong,
      '--ink': t.ink, '--paper': raised, '--color-text': t.ink, '--color-text-muted': t.muted, '--color-text-subtle': t.muted,
      '--color-brand': a, '--color-brand-hover': t.accentHover, '--color-brand-active': t.accentHover,
      '--color-brand-soft': mix(a, 14, raised), '--color-brand-soft-hover': mix(a, 22, raised), '--color-on-brand': raised,
      '--color-cta': a, '--color-cta-hover': t.accentHover, '--color-on-cta': raised, '--color-cta-shadow': 'transparent',
      '--accent-lilac': a, '--selection-color': a, '--focus-ring': '0 0 0 3px ' + mix(a, 40, 'transparent'),
      '--violet-50': mix(a, 6, raised), '--violet-100': mix(a, 12, raised), '--violet-200': mix(a, 20, raised),
      '--violet-300': mix(a, 32, raised), '--violet-400': mix(a, 60, raised), '--violet-500': a, '--violet-600': a,
      '--violet-700': t.accentHover, '--violet-800': t.accentHover, '--violet-900': t.accentHover, '--violet-950': t.ink,
      '--pastel-lilac': mix(a, 30, raised), '--pastel-sky': mix(a, 22, raised),
      '--shadow-sm': '0 1px 2px rgb(' + shadow + ' / 0.08)',
      '--shadow-md': '0 4px 12px rgb(' + shadow + ' / 0.1)',
      '--shadow-lg': '0 18px 40px rgb(' + shadow + ' / 0.16)',
      '--shadow-artboard': '0 2px 6px rgb(' + shadow + ' / 0.12), 0 12px 32px rgb(' + shadow + ' / 0.12)',
      '--shadow-card': '0 0 0 1px ' + t.line + ', 0 12px 30px -18px rgb(' + shadow + ' / 0.3)',
      '--font-sans': FONT, '--font-display': FONT,
    };
    var css = 'html:root,html:root[data-contrast]{color-scheme:' + (t.scheme === 'dark' ? 'dark' : 'light') + ';';
    for (var key in vars) if (vars[key]) css += key + ':' + vars[key] + ';';
    css += '}body{background:var(--color-bg);color:var(--color-text)}';
    var style = document.getElementById('bb-theme');
    if (!style) { style = document.createElement('style'); style.id = 'bb-theme'; }
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style); // last, so it wins over Doory's tokens
    try { localStorage.setItem(THEME_KEY, JSON.stringify(t)); } catch (e) { /* first paint just uses Doory's until the parent answers */ }
  }

  // The bunny mark and wordmark (Logo renders role=img aria-label="Doory"), and the bunny stickers.
  var brand = document.createElement('style');
  // Breadboard has one local account, so Doory's account menu (avatar, sign out) has nothing to offer.
  brand.textContent = "@font-face{font-family:'Source Sans 3';src:url('/bb-fonts/SourceSans3.ttf') format('truetype');font-weight:200 900;font-display:swap}" +
    ':root{--font-sans:' + FONT + ';--font-display:' + FONT + '}' +
    // The logo is matched by its bunny, not its label: renaming turns aria-label "Doory" into "Design".
    'span[role="img"]:has(> img[src*="bunny"]),img[src*="bunny"],[aria-label^="Account menu for"]{display:none!important}' +
    // Home's start panel is a hard-coded lilac gradient with room on the right for the bunny.
    '[class^="_hero_"],[class*=" _hero_"]{background:var(--color-bg-subtle)!important;border:1px solid var(--color-border);padding-right:var(--space-6)!important}' +
    // Hard-coded white fills around thumbnails and on the "All sizes" tile; the design pages themselves stay white.
    '[class^="_thumb_"],[class*=" _thumb_"]{background:var(--color-surface)!important;border-color:var(--color-border)!important}' +
    '[class^="_allSizes_"],[class*=" _allSizes_"]{background:transparent!important}' +
    // The download dialog's preview stage is dark in every theme; Breadboard's ground instead of Doory's plum.
    // ponytail: the class hash belongs to download.module.css as built; it changes only if that file changes.
    '[class*="_preview_wx6q6_"]{background:#141815!important}';
  (document.head || document.documentElement).appendChild(brand);

  function rename(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (var node = walker.nextNode(); node; node = walker.nextNode()) {
      if (NAME.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(NAME, 'Design');
      NAME.lastIndex = 0;
    }
    var labelled = root.querySelectorAll ? root.querySelectorAll('[aria-label*="Doory"],[title*="Doory"],[placeholder*="Doory"],[alt*="Doory"]') : [];
    for (var i = 0; i < labelled.length; i++) {
      ['aria-label', 'title', 'placeholder', 'alt'].forEach(function (name) {
        var value = labelled[i].getAttribute(name);
        if (value && value.indexOf('Doory') >= 0) labelled[i].setAttribute(name, value.replace(NAME, 'Design'));
      });
    }
  }
  function cleanTitle() {
    var title = document.title.replace(/\s*·\s*Doory\s*$/, '').replace(NAME, 'Design');
    if (title !== document.title) document.title = title;
    return title;
  }

  try { applyTheme(JSON.parse(localStorage.getItem(THEME_KEY) || 'null')); } catch (e) { /* no cached theme yet */ }
  window.addEventListener('message', function (event) {
    if (event.source === parent && event.data && event.data.source === 'breadboard-theme') applyTheme(event.data.theme);
  });

  document.addEventListener('DOMContentLoaded', function () {
    rename(document.body);
    new MutationObserver(function (changes) {
      changes.forEach(function (change) {
        if (change.type === 'characterData') rename(change.target.parentNode || document.body);
        else if (change.type === 'attributes') rename(change.target.parentNode || document.body);
        else change.addedNodes.forEach(function (node) {
          if (node.nodeType === 3) rename(node.parentNode || document.body);
          else if (node.nodeType === 1) rename(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder', 'alt'] });
  });

  var last = '';
  setInterval(function () {
    // The marketing home is Doory's own landing page; Design starts at the designs list.
    if (location.pathname === '/') { location.replace('/dashboard'); return; }
    var title = cleanTitle();
    var report = location.href + '\n' + title;
    if (report === last) return;
    last = report;
    try { parent.postMessage({ source: 'doory', href: location.href, title: title }, '*'); } catch (e) { /* not framed */ }
  }, 500);
})();
