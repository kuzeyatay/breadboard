import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);

const componentSource = fs.readFileSync(
  new URL("../src/app/components/garden-video-import.tsx", import.meta.url),
  "utf8",
);

test("garden sidebar renders the Videos accordion directly after Links", () => {
  const linksSection = source.indexOf('onClick={() => setLinksExpanded');
  const videosSection = source.indexOf('onClick={() => setVideosExpanded', linksSection);

  assert.ok(linksSection >= 0, "Links accordion should exist");
  assert.ok(videosSection > linksSection, "Videos should render after Links");
  assert.match(source, /const \[videosExpanded, setVideosExpanded\] = useState\(false\)/);
});

test("the Videos panel hosts the functional video import component", () => {
  const videosSection = source.indexOf("{videosExpanded && (");
  assert.ok(videosSection >= 0);
  assert.match(source, /<GardenVideoImport\s/);
  assert.match(source, /onSourceCreated=\{handleVideoSourceCreated\}/);
  // The panel keeps its stable anchor id for accessibility.
  assert.match(componentSource, /id="garden-videos-panel"/);
  // Empty state still communicates "no videos yet".
  assert.match(componentSource, /No videos yet\./);
});
