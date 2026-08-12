import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const identity = await import("../src/lib/get-doc/identity.ts");
const sources = await import("../src/lib/get-doc/sources.ts");
const search = await import("../src/lib/get-doc/search.ts");
const download = await import("../src/lib/get-doc/download.ts");
const queryPlan = await import("../src/lib/get-doc/query-plan.ts");
const runManager = await import("../src/lib/get-doc/run-manager.ts");
const artifactImport = await import("../src/lib/hermes/artifact-import.ts");
const renderers = await import("../src/lib/hermes/artifact-renderers.ts");
const defaults = await import("../src/lib/agent-settings/defaults.ts");
const catalog = await import("../src/lib/agent-settings/catalog.ts");
const combinations = await import("../src/lib/hermes/capability-combinations.ts");

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

test("Get Doc has one canonical slash command", () => {
  assert.equal(identity.GET_DOC_COMMAND, "/agents:get-doc");
  assert.equal(
    identity.getDocUserMessage("the original ResNet paper"),
    "/agents:get-doc the original ResNet paper",
  );
  assert.equal(
    identity.taskFromGetDocCommand("  /AGENTS:GET-DOC  papers on sleep and memory"),
    "papers on sleep and memory",
  );
  assert.equal(identity.taskFromGetDocCommand("/agents:get-doc"), "");
  assert.equal(identity.taskFromGetDocCommand("/agents:deep-research something"), null);
});

test("inline flags shape the search and never leak into the query", () => {
  const request = identity.parseDocumentSearchRequest(
    "transformer efficiency --limit 25 --since 2021 --until 2024 --all --source openalex,arxiv",
  );
  assert.equal(request.query, "transformer efficiency");
  assert.equal(request.limit, 25);
  assert.equal(request.yearFrom, 2021);
  assert.equal(request.yearTo, 2024);
  assert.equal(request.openAccessOnly, false);
  assert.deepEqual(request.sources, ["openalex", "arxiv"]);
});

test("a stored preference fills in only what the message left unsaid", () => {
  const stored = { limit: 20, openAccessOnly: false, yearFrom: 2015, sources: ["europepmc"] };
  const untouched = identity.parseDocumentSearchRequest("crispr off-target effects", stored);
  assert.equal(untouched.limit, 20);
  assert.equal(untouched.openAccessOnly, false);
  assert.equal(untouched.yearFrom, 2015);

  const overridden = identity.parseDocumentSearchRequest(
    "crispr off-target effects --limit 5 --oa",
    stored,
  );
  assert.equal(overridden.limit, 5, "the flag in the message beats the preference");
  assert.equal(overridden.openAccessOnly, true);
  assert.equal(overridden.query, "crispr off-target effects");
});

test("a backwards year range is read as a slip, not as an empty search", () => {
  const request = identity.parseDocumentSearchRequest("x --since 2024 --until 2020");
  assert.equal(request.yearFrom, 2020);
  assert.equal(request.yearTo, 2024);
});

test("limits are clamped rather than trusted", () => {
  assert.equal(identity.parseDocumentSearchRequest("x --limit 999").limit, identity.MAX_RESULT_LIMIT);
  assert.equal(identity.parseDocumentSearchRequest("x --limit 0").limit, 1);
});

// ---- catalog parsing --------------------------------------------------------

test("OpenAlex works are normalized, abstract included", () => {
  const parsed = sources.parseOpenAlexWorks({
    results: [
      {
        id: "https://openalex.org/W1",
        doi: "https://doi.org/10.1234/Example",
        display_name: "Deep Residual Learning",
        publication_year: 2016,
        cited_by_count: 100000,
        authorships: [{ author: { display_name: "Kaiming He" } }],
        primary_location: {
          source: { display_name: "CVPR" },
          landing_page_url: "http://example.org/paper",
        },
        best_oa_location: { pdf_url: "http://example.org/paper.pdf" },
        open_access: { is_oa: true, oa_url: "http://example.org/oa" },
        abstract_inverted_index: { Deeper: [0], networks: [1], win: [2] },
      },
      { display_name: "" },
    ],
  });
  assert.equal(parsed.length, 1, "a work with no title is dropped");
  const [work] = parsed;
  assert.equal(work.doi, "10.1234/example");
  assert.equal(work.venue, "CVPR");
  assert.equal(work.abstract, "Deeper networks win");
  assert.equal(work.citationCount, 100000);
  assert.equal(work.openAccess, true);
  assert.equal(
    work.pdfUrl,
    "https://example.org/paper.pdf",
    "http links are upgraded to https before anything downloads them",
  );
  assert.equal(work.landingPage, "https://example.org/paper");
});

test("arXiv Atom entries produce a direct PDF link", () => {
  const feed = `<feed>
    <entry>
      <id>http://arxiv.org/abs/1706.03762v5</id>
      <title>Attention Is All You Need</title>
      <summary>We propose a new simple network architecture.</summary>
      <published>2017-06-12T00:00:00Z</published>
      <author><name>Ashish Vaswani</name></author>
      <author><name>Noam Shazeer</name></author>
      <link title="pdf" href="http://arxiv.org/pdf/1706.03762v5"/>
    </entry>
  </feed>`;
  const [entry] = sources.parseArxivFeed(feed);
  assert.equal(entry.title, "Attention Is All You Need");
  assert.deepEqual(entry.authors, ["Ashish Vaswani", "Noam Shazeer"]);
  assert.equal(entry.year, 2017);
  assert.equal(entry.openAccess, true);
  assert.equal(entry.pdfUrl, "https://arxiv.org/pdf/1706.03762v5");
});

test("Europe PMC open-access records fall back to the rendered PDF", () => {
  const [result] = sources.parseEuropePmcResults({
    resultList: {
      result: [
        {
          title: "Sleep and memory consolidation",
          authorString: "Walker M, Stickgold R.",
          pubYear: "2004",
          journalInfo: { journal: { title: "Neuron" } },
          doi: "10.1016/j.neuron.2004.08.031",
          abstractText: "A review.",
          isOpenAccess: "Y",
          citedByCount: 1200,
          pmcid: "PMC1234567",
          fullTextUrlList: { fullTextUrl: [] },
        },
      ],
    },
  });
  assert.deepEqual(result.authors, ["Walker M", "Stickgold R"]);
  assert.equal(result.venue, "Neuron");
  assert.equal(result.pdfUrl, "https://europepmc.org/articles/PMC1234567?pdf=render");
});

test("Crossref supplies metadata but never a full-text link", () => {
  const [item] = sources.parseCrossrefItems({
    message: {
      items: [
        {
          DOI: "10.1000/Xyz",
          title: ["A Paywalled Study"],
          author: [{ given: "Ada", family: "Lovelace" }],
          issued: { "date-parts": [[1999, 4]] },
          "container-title": ["Journal of Things"],
          abstract: "<jats:p>Some <jats:italic>marked up</jats:italic> text.</jats:p>",
          "is-referenced-by-count": 12,
          URL: "https://doi.org/10.1000/xyz",
          link: [{ URL: "https://publisher.example/full.pdf", "content-type": "application/pdf" }],
        },
      ],
    },
  });
  assert.equal(item.doi, "10.1000/xyz");
  assert.deepEqual(item.authors, ["Ada Lovelace"]);
  assert.equal(item.year, 1999);
  assert.equal(item.abstract, "Some marked up text.");
  assert.equal(
    item.pdfUrl,
    null,
    "publisher text-mining links are not free full text and must not become a Download button",
  );
});

test("Semantic Scholar hands over its open-access PDF", () => {
  const [paper] = sources.parseSemanticScholarPapers({
    data: [
      {
        title: "A Paper",
        year: 2020,
        venue: "NeurIPS",
        authors: [{ name: "Someone" }],
        externalIds: { DOI: "10.5555/abc", ArXiv: "2001.00001" },
        openAccessPdf: { url: "https://example.org/open.pdf" },
        citationCount: 5,
        url: "https://www.semanticscholar.org/paper/abc",
      },
    ],
  });
  assert.equal(paper.pdfUrl, "https://example.org/open.pdf");
  assert.equal(paper.openAccess, true);
  assert.equal(paper.doi, "10.5555/abc");
});

test("Unpaywall answers only when the DOI really is open", () => {
  assert.equal(sources.parseUnpaywall({ is_oa: false, best_oa_location: null }), null);
  assert.deepEqual(
    sources.parseUnpaywall({
      is_oa: true,
      best_oa_location: {
        url_for_pdf: "https://repo.example/paper.pdf",
        url_for_landing_page: "https://repo.example/record",
        version: "publishedVersion",
      },
    }),
    {
      pdfUrl: "https://repo.example/paper.pdf",
      landingPage: "https://repo.example/record",
      version: "publishedVersion",
    },
  );
});

test("DOIs are normalized however a catalog spells them", () => {
  assert.equal(sources.normalizeDoi("https://doi.org/10.1234/ABC"), "10.1234/abc");
  assert.equal(sources.normalizeDoi("doi: 10.1234/abc"), "10.1234/abc");
  assert.equal(sources.normalizeDoi("not-a-doi"), null);
});

// ---- merging and ranking ----------------------------------------------------

const hit = (overrides) => ({
  source: "openalex",
  title: "A Study of Things",
  authors: ["A Author"],
  year: 2020,
  venue: "Venue",
  doi: null,
  abstract: null,
  openAccess: false,
  citationCount: null,
  landingPage: null,
  pdfUrl: null,
  ...overrides,
});

test("the same work from several catalogs becomes one entry", () => {
  const merged = search.mergeHits([
    hit({ source: "openalex", doi: "10.1/x", citationCount: 40 }),
    hit({ source: "crossref", doi: "10.1/x", abstract: "The long abstract." }),
    hit({ source: "arxiv", doi: "10.1/x", pdfUrl: "https://arxiv.org/pdf/1", openAccess: true }),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ["openalex", "crossref", "arxiv"]);
  assert.equal(merged[0].abstract, "The long abstract.");
  assert.equal(merged[0].citationCount, 40);
  assert.equal(merged[0].pdfUrl, "https://arxiv.org/pdf/1");
  assert.equal(merged[0].pdfSource, "arxiv", "arXiv's own PDF is preferred over a catalog's guess");
  assert.equal(merged[0].openAccess, true);
});

test("works with no DOI merge on title and year, not across different years", () => {
  const merged = search.mergeHits([
    hit({ source: "openalex", title: "Sleep and Memory" }),
    hit({ source: "europepmc", title: "sleep and memory!" }),
    hit({ source: "core", title: "Sleep and Memory", year: 1999 }),
  ]);
  assert.equal(merged.length, 2);
});

test("ranking puts a downloadable, corroborated match first", () => {
  const ranked = search.rankHits(
    search.mergeHits([
      hit({ source: "openalex", title: "Unrelated Work", citationCount: 9000 }),
      hit({ source: "openalex", title: "Sleep and Memory Consolidation", doi: "10.1/a" }),
      hit({ source: "europepmc", title: "Sleep and Memory Consolidation", doi: "10.1/a" }),
      hit({
        source: "arxiv",
        title: "Sleep and Memory Consolidation",
        doi: "10.1/a",
        pdfUrl: "https://arxiv.org/pdf/2",
      }),
    ]),
    "sleep and memory consolidation",
  );
  assert.equal(ranked[0].title, "Sleep and Memory Consolidation");
});

test("an abstract is cut at a sentence, not mid-word", () => {
  const summary = search.summarizeAbstract(
    `Abstract: ${"First sentence here. ".repeat(30)}`,
    120,
  );
  assert.ok(summary.length <= 121, summary);
  assert.ok(!summary.startsWith("Abstract"));
});

// ---- download safety --------------------------------------------------------

test("private, loopback and metadata addresses are refused", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(download.isPublicAddress(address), false, `${address} must be refused`);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) {
    assert.equal(download.isPublicAddress(address), true, `${address} should be allowed`);
  }
});

test("a non-https download address is refused before any request is made", async () => {
  await assert.rejects(
    () => download.downloadPdf("http://example.com/paper.pdf"),
    (error) => error.code === "insecure_url",
  );
  await assert.rejects(
    () => download.downloadPdf("file:///etc/passwd"),
    (error) => error.code === "insecure_url",
  );
  await assert.rejects(
    () => download.downloadPdf("https://127.0.0.1/paper.pdf"),
    (error) => error.code === "private_address",
  );
});

test("downloaded files are named after the paper", () => {
  assert.equal(
    download.pdfFilename({
      title: "Attention Is All You Need",
      year: 2017,
      firstAuthor: "Ashish Vaswani",
    }),
    "vaswani-2017-attention-is-all-you-need.pdf",
  );
  assert.equal(
    download.pdfFilename({ title: "", year: null, firstAuthor: null }),
    "document.pdf",
  );
});

test("the download route names a document, never a URL", () => {
  const route = source(
    "src/app/api/get-doc/runs/[runId]/documents/[documentId]/download/route.ts",
  );
  assert.match(route, /findDocument\(userId, runId, documentId\)/);
  assert.doesNotMatch(
    route,
    /body\.(?:url|pdfUrl|downloadUrl)/,
    "a client-supplied address would defeat the run-scoped lookup",
  );
});

// ---- artifact import --------------------------------------------------------

test("only real PDFs import as pdf artifacts", (t) => {
  const directory = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "get-doc-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const good = path.join(directory, "paper.pdf");
  fs.writeFileSync(good, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]));
  const profile = artifactImport.inspectArtifactImport(good, "pdf");
  assert.equal(profile.rendererId, "pdf-file");
  assert.equal(profile.mimeType, "application/pdf");
  assert.equal(profile.extension, ".pdf");

  const loginPage = path.join(directory, "login.pdf");
  fs.writeFileSync(loginPage, "<html><body>Sign in to continue</body></html>");
  assert.throws(
    () => artifactImport.inspectArtifactImport(loginPage, "pdf"),
    (error) => error.code === "artifact_import_signature",
  );
});

test("the pdf-file renderer is import-only", async () => {
  const renderer = renderers.artifactRenderer("pdf-file");
  assert.ok(renderer);
  assert.equal(renderer.kind, "pdf");
  const validation = await renderer.validate("%PDF-1.7");
  assert.equal(validation.ok, false, "text content must not be publishable as a PDF artifact");
});

// ---- the written answer -----------------------------------------------------

const documentFixture = (overrides = {}) => ({
  id: "doc_1",
  title: "Sleep and Memory Consolidation",
  authors: ["Matthew Walker", "Robert Stickgold", "A Third", "A Fourth"],
  year: 2004,
  venue: "Neuron",
  doi: "10.1/a",
  abstract: "A review of sleep-dependent memory processing.",
  description: "Reviews how sleep consolidates memory.",
  openAccess: true,
  citationCount: 1200,
  landingPage: "https://example.org/record",
  pdfUrl: "https://example.org/paper.pdf",
  pdfSource: "europepmc",
  sources: ["openalex", "europepmc"],
  ...overrides,
});

test("the written list keeps every link so it still works after the run expires", () => {
  const written = runManager.summarizeDocuments({
    request: identity.parseDocumentSearchRequest("sleep and memory"),
    documents: [documentFixture(), documentFixture({ id: "doc_2", pdfUrl: null, title: "Closed" })],
    reports: [],
    saved: new Map([["doc_1", { artifactId: "art_1", filename: "a.pdf", byteSize: 10, savedAt: "" }]]),
  });
  assert.match(written, /2 documents for “sleep and memory” — 1 with a free PDF/);
  assert.match(written, /Matthew Walker, Robert Stickgold, A Third et al\. · 2004 · Neuron/);
  assert.match(written, /\[PDF\]\(https:\/\/example\.org\/paper\.pdf\)/);
  assert.match(written, /saved to artifacts/);
});

test("an empty search says what to try next", () => {
  const written = runManager.summarizeDocuments({
    request: identity.parseDocumentSearchRequest("nothing at all"),
    documents: [],
    reports: [],
    saved: new Map(),
  });
  assert.match(written, /No documents matched/);
  assert.match(written, /--all/);
});

// ---- model handling ---------------------------------------------------------

test("a plan is read out of fenced or reasoning-wrapped JSON", () => {
  assert.deepEqual(
    queryPlan.extractJson('<think>weighing it up</think>```json\n{"queries":["a"]}\n```'),
    { queries: ["a"] },
  );
  assert.deepEqual(queryPlan.extractJson('Sure! {"queries":["b"]} hope that helps'), {
    queries: ["b"],
  });
  assert.equal(queryPlan.extractJson("no json here"), null);
});

// ---- wiring -----------------------------------------------------------------

test("Get Doc is a runtime agent on both chat surfaces", () => {
  const profile = combinations.runtimeAgentById("get-doc");
  assert.ok(profile);
  assert.equal(profile.command, "/agents:get-doc");
  assert.deepEqual([...profile.surfaces], ["dashboard_terminal", "garden_chat"]);
  assert.equal(combinations.runtimeAgentByToken("agents:get-doc")?.id, "get-doc");
});

test("its settings only fill in what a message leaves unsaid", () => {
  const agent = catalog.findConfigurableAgent("get-doc");
  assert.ok(agent);
  const values = catalog.agentSettingDefaults(agent);
  const resolved = defaults.getDocDefaults(values);
  assert.equal(resolved.limit, 10);
  assert.equal(resolved.openAccessOnly, true);
  assert.equal(resolved.yearFrom, null, "0 in the form means any year");
  assert.equal(resolved.sources, null, "no catalog selected means every catalog");

  const chosen = defaults.getDocDefaults({
    limit: 5,
    openAccess: false,
    since: 2020,
    sources: ["arxiv", "nonsense"],
  });
  assert.equal(chosen.limit, 5);
  assert.equal(chosen.openAccessOnly, false);
  assert.equal(chosen.yearFrom, 2020);
  assert.deepEqual(chosen.sources, ["arxiv"]);
});

test("both chat surfaces route the command and render the card", () => {
  for (const file of [
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  ]) {
    const text = source(file);
    assert.match(text, /taskFromGetDocCommand/, `${file} does not route /agents:get-doc`);
    assert.match(text, /\/api\/get-doc\/runs/, `${file} does not start a run`);
  }
  assert.match(
    source("src/app/components/hermes/agent-runtime-panel.tsx"),
    /InlineGetDocRun/,
  );
  assert.match(
    source("src/app/gardens/[clusterSlug]/workspace-client.tsx"),
    /InlineGetDocRun/,
  );
});

test("the Agents palette explains Get Doc in user-facing terms", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  assert.match(hub, /Finds academic papers from a title or a description/);
});

test("no shadow library is ever consulted", () => {
  for (const file of fs.readdirSync(path.join(dashboardRoot, "src/lib/get-doc"))) {
    const text = source(path.join("src/lib/get-doc", file));
    assert.doesNotMatch(text.toLowerCase().replace(/shadow libraries/g, ""), /sci-?hub|libgen|z-?library/);
  }
});
