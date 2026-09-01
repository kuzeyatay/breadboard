---
name: world-monitor
description: Answer questions about what is happening in the world right now from Breadboard's own world monitor — live news across 173 sources classified by threat level and pinned to places, plus measured climate indicators, natural-hazard alerts, and local weather and time at strategic hubs. Use for "what's going on in X", "any news about Y", "how serious is Z", "what time/weather is it in Tokyo", "are there active cyclones", "how much sea ice is left".
license: MIT
allowed-tools:
  - worldmonitor_catalog
  - worldmonitor_snapshot
  - worldmonitor_search
  - worldmonitor_climate
  - weather_forecast
---

# World monitor

The `/worldmonitor` console, asked questions instead of read off a screen. It
gives you two different kinds of knowledge and they should never be blurred
together: a **reported** layer — what news sources are saying, classified and
corroborated — and a **measured** layer — what observational archives recorded.

breadboard:
  category: featured
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools:
    - worldmonitor_catalog
    - worldmonitor_snapshot
    - worldmonitor_search
    - worldmonitor_climate
    - weather_forecast
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## Which tool

`worldmonitor_snapshot` for a broad question — "what's happening", "anything I
should know". It returns an escalation index, the breakdown by level, category
and panel, the places with the most activity, and the top-ranked headlines.

`worldmonitor_search` for anything specific: a country, a topic, a story, a
source. Filters compose — words, region, threat level, category, source, source
tier, corroboration, recency — and results come back in the monitor's own
ranking, so the most significant match is already first.

`worldmonitor_climate` for the measured layer: global indicators, live hazard
alerts, and current conditions plus the wall clock at named places.

`weather_forecast` for ordinary current or dated weather at any named place.
Pass all requested dates together; the answer renderer turns each returned day
into a stacked native weather card.

`worldmonitor_catalog` when you need a valid id. It hits no network and costs
nothing, so call it rather than guessing a panel or hub id — a wrong id is
rejected with a message, not silently answered with the whole world.

Prefer `region` over `hubs` in a search unless you already hold a hub id.
`region` accepts a country, a region or a city name and resolves it to the hubs
behind it, which is what a headline actually carries.

## Reading a result honestly

Every headline arrives with four things you should actually use:

- **level** and **category** — the monitor's classification, not the source's.
  `classifiedBy: "keyword"` means a deterministic keyword cascade decided it;
  `"llm"` means a model re-read a case the cascade was unsure about. Neither is
  the publisher's own framing, so do not attribute the severity to the outlet.
- **corroboration** — how many independent sources in this window carry the same
  story. A `corroboration: 1` critical headline is one outlet's claim. Say so.
  When a user asks whether something is really happening, `minCorroboration: 2`
  is a better answer than a longer list.
- **tier** — 1 is wire services and official bodies, 4 is least authoritative.
  `maxTier: 2` when the question deserves care.
- **publishedApprox** — the feed carried no date and arrival time was stamped
  instead. Do not present such a timestamp as when the event happened.

The window is roughly the last day or two of the feeds, cached for ten minutes.
It is not a live wire and not a web search: a story breaking minutes ago, or one
carried only by sources outside the catalog, will simply not be there. Absence
from the monitor is not evidence that nothing happened, and should never be
reported as "there is no news about X" — say the monitor's sources do not carry
it.

Every answer also carries `sources`, with the feeds that failed this time. When
a meaningful share of them are down, say so before drawing a conclusion about
how quiet somewhere is.

## The measured layer

`worldmonitor_climate` is where numbers come from — sea ice, temperature
anomalies, CO₂, hazard alerts, live weather. Each indicator carries `asOf`, the
day of the observation itself rather than of the fetch, and the archive it came
from. Quote both; an archive's latest reading is often days or weeks old, and a
figure repeated without its date turns into a claim about today.

Hazards carry both `from` and `updated`. A drought's start is months before
anyone is looking at it, so `updated` — when the alert was last revised — is
what "recent" has to mean.

`notes` names any source that did not answer. An empty hazard list with a note
in it means the archive was unreachable, not that the world is calm. Read it
before saying there is nothing active.

Weather and local time need `hubs`. The clock is a real wall clock at that
place, so this is also the way to answer "is it a reasonable hour to call
someone in Seoul".

## Answering

Lead with the answer, not with the query you ran. A user asking about Taiwan
wants two or three sentences of what the monitor is carrying, with the sources
named and the corroboration made plain — not fifteen headlines pasted back.

Name outlets and rough times inline ("Reuters and AFP, both this morning").
Include a link only when the user would plausibly open it.

Keep the monitor's own vocabulary rather than inventing severity of your own.
If the monitor rates something `medium` and it reads dramatic to you, report
`medium` and explain the discrepancy — the classification is the artifact the
user also sees on screen, and an answer that disagrees with their console is
worse than one that is merely cautious.

Never fabricate a headline, a source or a figure to round out a picture. If the
window is thin, the honest answer is that the monitor has little on it.
