import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);

test("garden sidebar renders a UI-only Videos accordion directly after Links", () => {
  const linksSection = source.indexOf('onClick={() => setLinksExpanded');
  const videosSection = source.indexOf('onClick={() => setVideosExpanded', linksSection);
  const videosMarkup = source.slice(videosSection, source.indexOf("\n    </>", videosSection));

  assert.ok(linksSection >= 0, "Links accordion should exist");
  assert.ok(videosSection > linksSection, "Videos should render after Links");
  assert.match(source, /const \[videosExpanded, setVideosExpanded\] = useState\(false\)/);
  assert.match(source, /aria-controls="garden-videos-panel"/);
  assert.match(source, /No videos yet\./);
  assert.doesNotMatch(videosMarkup, /fetch\(|\/api\//);
});
