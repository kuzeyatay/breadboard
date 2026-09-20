import test from "node:test";
import assert from "node:assert/strict";
import {
  convertWebsiteToMarkdown, IncompleteWebsiteError, websitePageUrl,
  websiteHtmlLinks, websiteHtmlSectionLinks, websiteCrawlRoot, isWithinWebsiteRoot, websiteSnapshotMarkdown,
} from "../src/lib/website-to-markdown.ts";

const site = "https://example.com/";
function mockSite(pages, markdown = {}) {
  const fetched = [], converted = [];
  return {
    fetched, converted,
    fetchImpl: async input => {
      const url = String(input); fetched.push(url);
      const page = pages[url];
      if (page instanceof Response) return page.clone();
      return new Response(page ?? "missing", { status: page === undefined ? 404 : 200,
        headers: { "content-type": url.endsWith(".xml") ? "application/xml" : "text/html" } });
    },
    assertPublicHostImpl: async () => {},
    convertPage: async ({url, signal}) => {
      signal?.throwIfAborted(); converted.push(url);
      return { originalUrl: url, title: url === site ? "Home" : "Lesson", markdown: markdown[url] ?? `# Lesson\n\nFull original text from ${url}.`,
        contentHash: "a".repeat(64), provider: "jina-reader-remote", fetchedAt: "2026-09-19T00:00:00Z" };
    },
  };
}

test("whole-site crawl follows navigation, image maps, rendered links, and nested sitemaps from any starting page", async () => {
  const fixture = mockSite({
    [site]: '<a href="/start">Start</a><map><area href="/map?x=1&amp;y=2"></map><a href="https://external.test/x">External</a>',
    [site+"robots.txt"]: 'Sitemap: https://example.com/nested.xml',
    [site+"sitemap.xml"]: '<sitemapindex><sitemap><loc>https://example.com/nested.xml</loc></sitemap></sitemapindex>',
    [site+"nested.xml"]: '<urlset><url><loc>https://example.com/orphan</loc></url></urlset>',
    [site+"start"]: '<a href="/">Home</a>',
    [site+"orphan"]: '<h1>Orphan</h1>',
    [site+"map?x=1&y=2"]: '<h1>Image map destination</h1>',
    [site+"rendered"]: '<h1>Rendered page</h1>',
  }, { [site+"start"]: '# Start\n\n[Client-rendered navigation](/rendered)\n\nFull text.' });
  const snapshot = await convertWebsiteToMarkdown({url:site+"start",...fixture});
  assert.equal(snapshot.complete,true);
  assert.deepEqual(new Set(snapshot.pages.map(p=>p.originalUrl)),new Set([site,site+"start",site+"orphan",site+"map?x=1&y=2",site+"rendered"]));
  assert.ok(fixture.fetched.every(u=>u.startsWith(site)));
});

test("aliases, anchors, tracking parameters, and linked assets cannot create crawl loops", async () => {
  const html='<a href="/index.html">Alias</a><a href="/#one">Anchor</a><a href="/?utm_source=test">Tracking</a><a href="/figure.png">Image</a>';
  const fixture=mockSite({[site]:html,[site+"index.html"]:html}, {[site]:"Same home page",[site+"index.html"]:"Same home page"});
  const snapshot=await convertWebsiteToMarkdown({url:site,...fixture});
  assert.equal(snapshot.pages.length,1);
  assert.equal(snapshot.aliases[site+"index.html"],site);
  assert.equal(fixture.converted.length,2);
  assert.equal(snapshot.skipped[0].url,site+"figure.png");
});

test("identical JavaScript app shells do not hide distinct rendered pages", async () => {
  const shell = '<div id="app"></div><script src="app.js"></script>';
  const fixture = mockSite({ [site]: shell, [site + "lesson"]: shell }, {
    [site]: "# Home\n\n[Lesson](/lesson)",
    [site + "lesson"]: "# Lesson\n\nDifferent rendered lesson text.",
  });
  const snapshot = await convertWebsiteToMarkdown({ url: site, ...fixture });
  assert.equal(snapshot.pages.length, 2);
  assert.match(websiteSnapshotMarkdown(snapshot), /Different rendered lesson text/);
});

test("different article entry URLs keep a stable whole-site document", async () => {
  const pages = { [site]: '<a href="/one">One</a><a href="/two">Two</a>',
    [site + "one"]: "First lesson", [site + "two"]: "Second lesson" };
  const home = await convertWebsiteToMarkdown({ url: site, ...mockSite(pages) });
  const article = await convertWebsiteToMarkdown({ url: site + "two", ...mockSite(pages) });
  assert.equal(websiteSnapshotMarkdown(article), websiteSnapshotMarkdown(home));
  const orphan = await convertWebsiteToMarkdown({ url: site + "orphan", ...mockSite({ ...pages, [site + "orphan"]: "Unlisted article" }) });
  assert.equal(orphan.pages.at(-1).originalUrl, site + "orphan");
  const shell = '<a href="/alias">Alias</a>';
  const afterAlias = await convertWebsiteToMarkdown({ url: site + "orphan", ...mockSite({
    [site]: shell, [site + "alias"]: shell, [site + "orphan"]: "Unlisted article",
  }, { [site]: "Identical home", [site + "alias"]: "Identical home" }) });
  assert.equal(afterAlias.pages.at(-1).originalUrl, site + "orphan");
});

test("sitemaps decode URL entities and reject custom entity declarations", async () => {
  const fixture = mockSite({
    [site]: "Home",
    [site + "sitemap.xml"]: '<urlset><url><loc>https://example.com/search?a=1&amp;b=2</loc></url></urlset>',
    [site + "search?a=1&b=2"]: "Search page",
  });
  const snapshot = await convertWebsiteToMarkdown({ url: site, ...fixture });
  assert.ok(snapshot.pages.some(page => page.originalUrl === site + "search?a=1&b=2"));
  const malicious = mockSite({ [site]: "Home", [site + "sitemap.xml"]:
    '<!DOCTYPE urlset [<!ENTITY secret SYSTEM "file:///secret">]><urlset>&secret;</urlset>' });
  await assert.rejects(convertWebsiteToMarkdown({ url: site, ...malicious }), /unsupported entity declarations/);
});

test("HTML extraction honors base URLs, unquoted attributes, and entities",()=>{
  assert.deepEqual(websiteHtmlLinks('<base href="/lessons/"><a href=one>One</a><area href="two?a=1&amp;b=2">',site),[site+'lessons/one',site+'lessons/two?a=1&b=2']);
  for(const url of ['https://other.test/a','https://sub.example.com/a','http://127.0.0.1/a','file:///test','https://user:pass@example.com/'])assert.equal(websitePageUrl(url,site,site),null);
  assert.equal(websitePageUrl('http://www.example.com/a#b',site,site),site+'a');
});

test("redirects never send a request outside the authorized website",async()=>{
  const fixture=mockSite({[site]:new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})});
  await assert.rejects(convertWebsiteToMarkdown({url:site,...fixture}),error=>error instanceof IncompleteWebsiteError && /Redirect leaves/.test(error.message));
  assert.ok(fixture.fetched.every(u=>u.startsWith(site)));
});

test("a missing linked page is an incomplete import, never a successful homepage import",async()=>{
  const fixture=mockSite({[site]:'<a href="/missing">Missing</a>'});
  await assert.rejects(convertWebsiteToMarkdown({url:site,...fixture}),error=>{
    assert.equal(error.snapshot.complete,false);assert.equal(error.snapshot.pages.length,1);
    assert.deepEqual(error.snapshot.failures,[{url:site+'missing',error:'HTTP 404'}]);return true;
  });
});

test("hitting page or byte bounds reports incomplete coverage",async()=>{
  const fixture=mockSite({[site]:'<a href="/second">Two</a>',[site+'second']:'Second'});
  await assert.rejects(convertWebsiteToMarkdown({url:site,...fixture,maxPages:1}),/1-page limit/);
  await assert.rejects(convertWebsiteToMarkdown({url:site,...fixture,maxBytes:5}),/size limit/);
});

test("the default crawl imports more than 500 pages without a page-count cap", async () => {
  const pages = { [site]: '<a href="/page-1">First</a>' };
  for (let i = 1; i <= 510; i++) pages[site + `page-${i}`] = i < 510
    ? `<a href="/page-${i + 1}">Next</a>` : '<h1>Last page</h1>';
  const snapshot = await convertWebsiteToMarkdown({ url: site, ...mockSite(pages) });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.pages.length, 511);
  assert.equal(snapshot.pages.at(-1).originalUrl, site + 'page-510');
});

test("sitemap discovery has no 32-file cap and terminates cyclic indexes", async () => {
  const pages = { [site]: 'Home', [site + 'sitemap.xml']: '<sitemapindex>' +
    Array.from({ length: 35 }, (_, i) => `<sitemap><loc>${site}sitemap-${i}.xml</loc></sitemap>`).join('') + '</sitemapindex>' };
  for (let i = 0; i < 35; i++) pages[site + `sitemap-${i}.xml`] = i === 34
    ? `<urlset><url><loc>${site}last</loc></url></urlset>`
    : `<sitemapindex><sitemap><loc>${site}sitemap.xml</loc></sitemap></sitemapindex>`;
  pages[site + 'last'] = 'Last sitemap lesson';
  const fixture = mockSite(pages);
  const snapshot = await convertWebsiteToMarkdown({ url: site, ...fixture });
  assert.equal(snapshot.pages.length, 2);
  assert.equal(fixture.fetched.filter(url => url.endsWith('.xml')).length, 36);
});

test("section roots match path segments and query-selected categories", () => {
  assert.equal(websiteCrawlRoot(site + 'math/#title', 'section'), site + 'math/');
  assert.equal(websiteCrawlRoot(site + 'math/', 'site'), site);
  assert.equal(isWithinWebsiteRoot(site + 'math/chapter/2', site + 'math'), true);
  for (const url of [site, site + 'mathematics', 'https://elsewhere.test/math/']) {
    assert.equal(isWithinWebsiteRoot(url, site + 'math'), false);
  }
  assert.equal(isWithinWebsiteRoot(site + '?category=math&page=2', site + '?category=math'), true);
  assert.equal(isWithinWebsiteRoot(site + '?category=history', site + '?category=math'), false);
});

test("section imports include listed articles and pagination, without crawling the rest of the site", async () => {
  const root = site + 'topics/vectors/';
  const fixture = mockSite({
    [root]: '<nav><a href="/all">All pages</a></nav><main><header><a href="/archives">Archives</a></header>' +
      '<a href="/lesson-one">One</a><aside><a href="/advert">Advert</a></aside>' +
      '<nav><a href="page/2">Next</a></nav><a href="https://outside.test/">External</a></main>',
    [root + 'page/2']: '<main><article><header><a href="/lesson-two">Two</a></header></article></main>',
    [root + 'from-sitemap']: 'In-scope sitemap page',
    [site + 'lesson-one']: '<main><a href="/unrelated">Unrelated article</a></main>',
    [site + 'lesson-two']: 'Second lesson',
    [site + 'sitemap.xml']: `<urlset><url><loc>${root}from-sitemap</loc></url><url><loc>${site}elsewhere</loc></url></urlset>`,
  }, { [root]: '[One](/lesson-one)\n[All](/all)', [site + 'lesson-one']: '[Related](/unrelated)' });
  const snapshot = await convertWebsiteToMarkdown({ url: root, scope: 'section', ...fixture });
  assert.equal(snapshot.rootUrl, root);
  assert.deepEqual(new Set(snapshot.pages.map(page => page.originalUrl)), new Set([
    root, root + 'page/2', root + 'from-sitemap', site + 'lesson-one', site + 'lesson-two',
  ]));
  for (const excluded of [site, site + 'all', site + 'archives', site + 'advert', site + 'elsewhere', site + 'unrelated']) {
    assert.ok(!fixture.fetched.includes(excluded), excluded);
  }
  const markdown = websiteSnapshotMarkdown(snapshot);
  assert.match(markdown, /\[One\]\(#website-page-\d+\)/);
  assert.match(markdown, /\[Related\]\(https:\/\/example.com\/unrelated\)/);
});

test("section discovery supports main roles, content containers, and rendered-only listings", async () => {
  for (const wrapper of ['main', 'div role="main"', 'div id="content"']) {
    const tag = wrapper.split(' ')[0];
    assert.deepEqual(websiteHtmlSectionLinks(`<nav><a href="/menu">Menu</a></nav><${wrapper}><a href="/lesson">Lesson</a></${tag}><footer><a href="/footer">Footer</a></footer>`, site), [site + 'lesson']);
  }
  const root = site + 'course/';
  const fixture = mockSite({ [root]: '<nav><a href="/menu">Menu</a></nav><main id="app"></main>', [site + 'lesson']: 'Lesson' },
    { [root]: '[Menu](/menu)\n[Parent](/)\n[Lesson](/lesson)' });
  const snapshot = await convertWebsiteToMarkdown({ url: root, scope: 'section', ...fixture });
  assert.deepEqual(snapshot.pages.map(page => page.originalUrl), [root, site + 'lesson']);
});

test("section root redirects cannot silently expand the crawl to the homepage", async () => {
  const root = site + 'course/';
  const fixture = mockSite({ [root]: new Response(null, { status: 302, headers: { location: '/' } }), [site]: '<a href="/all">All</a>' });
  await assert.rejects(convertWebsiteToMarkdown({ url: root, scope: 'section', ...fixture }), /Redirect leaves the selected section/);
  assert.equal(fixture.converted.length, 0);
});

test("encoded template links are ignored and canonical print versions share one chapter", async () => {
  for (const href of ['/article/{{ revealButtonHref }}', '/%7B%7B%20revealButtonHref%20%7D%7D', '/%257B%257Bvalue%257D%257D', '/${url}']) {
    assert.equal(websitePageUrl(href, site, site), null);
  }
  const fixture = mockSite({
    [site]: '<a href="/article/print/">Print</a><a href="/article/{{ revealButtonHref }}">Template</a>',
    [site + 'article/print/']: '<link rel="canonical" href="/article/">Print text',
    [site + 'article/']: '<link rel="canonical" href="/article/">Full article',
  }, { [site]: '[Print](/article/print/)' });
  const snapshot = await convertWebsiteToMarkdown({ url: site, ...fixture });
  assert.equal(snapshot.pages.length, 2);
  assert.equal(snapshot.aliases[site + 'article/print/'], site + 'article/');
  assert.ok(!fixture.converted.includes(site + 'article/print/'));
  assert.match(websiteSnapshotMarkdown(snapshot), /\[Print\]\(#website-page-2\)/);
});

test("canonical chains and cycles do not lose article content or local links", async () => {
  for (const cycle of [false, true]) {
    const fixture = mockSite({ [site]: '<a href="/print">Print</a>',
      [site + 'print']: '<link rel="canonical" href="/article">Print',
      [site + 'article']: `<link rel="canonical" href="${cycle ? '/print' : '/final'}">Article`,
      [site + 'final']: 'Article',
    }, { [site]: '[Print](/print)\n[Article](/article)' });
    const snapshot = await convertWebsiteToMarkdown({ url: site, ...fixture });
    assert.equal(snapshot.pages.length, 2);
    const markdown = websiteSnapshotMarkdown(snapshot);
    assert.match(markdown, /\[Print\]\(#website-page-2\)/);
    assert.match(markdown, /\[Article\]\(#website-page-2\)/);
  }
});

test("cancellation stops the crawl without continuing to another page",async()=>{
  const controller=new AbortController();const fixture=mockSite({[site]:'<a href="/second">Two</a>',[site+'second']:'Second'});
  await assert.rejects(convertWebsiteToMarkdown({url:site,...fixture,signal:controller.signal,onPage:()=>controller.abort()}),{name:'AbortError'});
  assert.deepEqual(fixture.converted,[site]);
});

test("full text and equation figures survive conversion, with internal links opening local page sections",async()=>{
  const fixture=mockSite({[site]:'<a href="/math/one">One</a><img src="/equation.gif" alt="Gauss law">',[site+'math/one']:'<h1>Math</h1>'},
    {[site]:'# Home\n\nOriginal paragraph, not a summary.\n\n[One](/math/one)',[site+'math/one']:'# Formula\n\n$$E=mc^2$$\n\n![diagram](figure.png)\n\n[Home](/)'});
  const snapshot=await convertWebsiteToMarkdown({url:site,...fixture});const result=websiteSnapshotMarkdown(snapshot);
  assert.match(result,/Original paragraph, not a summary/);
  assert.match(result,/\$\$E=mc\^2\$\$/);
  assert.match(result,/!\[Gauss law\]\(https:\/\/example.com\/equation.gif\)/);
  assert.match(result,/!\[diagram\]\(https:\/\/example.com\/math\/figure.png\)/);
  assert.match(result,/\[One\]\(#website-page-2\)/);
  assert.match(result,/\[Home\]\(#website-page-1\)/);
  assert.match(result, /^## Website page 1$/m);
  assert.match(result, /^## Website page 2$/m);
  assert.doesNotMatch(result, /<a id=/, "chapter anchors must survive the garden's HTML escaping");
});
