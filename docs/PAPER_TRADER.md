# Paper Trader

`/agents:paper-trader` (id `paper-trader`, display name "Paper Trader") runs a
paper-trading desk — crypto and company shares — that keeps going after the turn
that started it. Its process closes with Breadboard and resumes automatically
when Breadboard is reopened, until someone stops it. Every buy and sell is
argued out by Breadboard's other trading agents first.

No API key is needed for any of it. Coins are priced by the clone's own ccxt feed
against Hyperliquid; shares by Yahoo Finance through `yahoo-finance2`, which needs
no account and no key.

It is the only agent whose work happens *between* messages rather than during
one, and almost everything unusual about its design follows from that.

---

## What it is made of

| Piece | Where | What it is |
| --- | --- | --- |
| The market and the book | `open-alpha-arena/backend` -> `.runtime/paper-trader/backend` | The cloned [Open Alpha Arena](https://github.com/etrobot/open-alpha-arena) backend: ccxt prices from Hyperliquid, a leverage-aware matching engine, a margin monitor that liquidates, an AI decision loop on a timer, and its own SQLite store. Copied out, patched and built in Breadboard's own workspace — the checkout is only ever read. |
| Company shares | `scripts/paper-trader-overlay/` | Breadboard's own arena-side sources: a keyless Yahoo Finance feed and the symbol register that tells a coin from a company. Compiled into the arena by the patch set in `lib/paper-trader/overlay.ts`. |
| The decision | `tradingagents/` | The cloned TradingAgents graph, driven through `scripts/tradingagents-bridge.py` — the same runtime the Trading Agent agent uses. |
| The advisers | `lib/paper-trader/committee.ts` | Vibe Trading and the Stock Analyst, consulted through their own run managers. |
| The risk officer | `lib/paper-trader/risk.ts` | Arithmetic, not a model. Has the last word. |
| The desk's own state | `paper_trader_*` tables on `brain.db` | Whether the desk should be running, which account it owns, the prepared verdict, the advisers' noticeboard. |
| The portfolio | `.runtime/paper-trader/arena.db` | The arena's own database, deliberately outside the checkout. |

## The cycle

The arena asks its configured "model" for a decision every few minutes. That
model is Breadboard: the desk's arena account is pointed at
`POST /api/paper-trader/decide/chat/completions`, which answers in OpenAI's
chat-completions shape and is authenticated with a bearer token minted into
`.runtime/paper-trader/callback-token`. Speaking that protocol is what lets the
clone's own position sizing, leverage arithmetic, one-position-per-coin rule,
order matching and decision log do the work unchanged.

One cycle:

1. **Serve.** Take the verdict the *previous* cycle's TradingAgents run reached.
2. **Harmonise.** Weigh it against the advisers' standing notes, the desk's own
   realised track record, and the risk officer's constraints. Below the
   confidence threshold the desk holds.
3. **Map.** Turn the verdict into an order against the position as it stands
   *now* — a BUY reached fifteen minutes ago must not reopen a long that was
   liquidated since.
4. **Constrain.** The risk officer sees the order last and can only reduce it.
5. **Start the next analysis**, and refresh any adviser whose note has gone
   stale. Neither is awaited.

**Why serve-then-start rather than analyse-on-demand:** the arena's model call
has a 30-second timeout and a TradingAgents run takes minutes. A cycle therefore
acts on the last verdict and prepares the next. On a fifteen-minute cycle each
verdict is acted on one cycle after it was reached, which for a multi-round
debate about a position held for hours is the right trade — and it is the only
arrangement in which the real framework, rather than a single-shot prompt, is the
thing deciding.

## The committee

Four seats, all of them capabilities Breadboard already had:

- **Trading Agent** — the primary seat. One asset per cycle, rotating configured
  coins with automatically discovered U.S.-listed company shares while their
  exchange is open. Held assets are always in play, or a position could never
  be closed.
- **Vibe Trading** — asked what regime the desk's coins are in (trending or
  choppy, and whether volatility makes leverage dangerous), never about a trade.
  It asks ChatGPT first and falls back to Anthropic **only when ChatGPT has run
  out** — a 429, a usage limit, an exhausted quota. Any other failure fails the
  same way on any model, so it is reported rather than retried somewhere else.
  The Claude id is read from the relay's own catalogue rather than hard-coded,
  because the prefix depends on how the machine reaches Anthropic, and a note
  written by the fallback is labelled with the model that wrote it.
- **Stock Analyst** — asked about risk appetite in the *equity* markets. Never
  about a coin: its data sources are six equity exchanges, and asking it about
  Bitcoin would produce an answer with nothing behind it. Off by default.
- **Risk officer** — drawdown, open-position count, and per-coin losing streaks.
  One-directional by construction: it can refuse a position or insist the desk
  only closes, and can never open one, raise leverage, or turn a hold into a
  trade.

The advisers run on their own slow clock. Each is a whole cloned runtime with a
service behind it, and neither answers a question whose answer changes in fifteen
minutes, so their notes live on a noticeboard (`paper_trader_advice`, one row per
seat) refreshed every `adviceEveryCycles` cycles. A cycle reads the board rather
than waiting on it, and a seat that has never answered — or whose clone is not
installed — abstains.

## Staying up

`enabled` in `paper_trader_settings` is the durable intent. `autostartPaperTrader()`
runs from `instrumentation-node.ts` and, once a minute, brings the arena back if
the flag is set and the backend is not up. It never sets the flag: starting a desk
is always a decision someone made in chat.

The same sweep releases work orphaned by a process that ended — a TradingAgents
child that died with the app would otherwise leave a `pending` row blocking every
future cycle.

## Starting capital

`/agents/paper-trader/settings` → **Starting capital**. Every return figure is
measured against it, and the clone's account API has no field for it after
creation, so changing it retires the account and opens a new one — a fresh
portfolio from zero — the next time the desk is started. The settings page says
so, and the card warns while the two disagree.

## Shares

The arena is a crypto product — six hard-coded coins, every price call ending at
Hyperliquid — so trading companies in it needs real changes to its source. They
are a handful of anchored replacements across three files, listed in
`lib/paper-trader/overlay.ts`, applied to Breadboard's copy rather than to the
checkout. Each anchor must match exactly once; one that no longer does stops the
build by name instead of silently reverting whatever upstream changed.

The set is small because of one decision. The clone writes `market: 'CRYPTO'` on
every order, position and trade, hard-coded in five places across the two files
that also own fills, margin and liquidation. Threading a real market through them
would mean patching the trading core, and it would buy nothing: the engine uses
that column only as part of a position key, and hands it to a price lookup the
patch routes **by symbol** instead. So the column keeps its one value, the
register is the authority on what a symbol is, and the trading core is untouched.

Four rules apply to shares and not to coins:

- **Dollars only.** The arena keeps one cash balance and no FX, so a share quoted
  in euros or yen would be added to a dollar book at face value and every return
  figure would quietly be wrong. A non-USD quote is refused with a reason.
- **Fractional shares.** Six-decimal sizing lets the same play-money allocation
  reach high-priced companies instead of silently excluding them.
- **Bought outright, no leverage.** The arena's leverage path is a crypto
  perpetual desk — hourly interest on borrowed notional, a taker fee, a 50x
  ceiling — and none of that describes a margin account at an equity broker.
- **Only while the exchange is open.** Yahoo keeps quoting Friday's close all
  weekend; a desk filling against a market that cannot move is not simulating
  anything. Only the regular session counts — a paper fill at a thin pre-market
  print flatters a record and means nothing.

The universe is automatic: both Nasdaq Trader company directories are cached
and filtered to ordinary company shares/ADRs, with a keyless major-company
fallback if the directory is temporarily unavailable. No ticker entry or
allowlist is required. Closed-market candidates are skipped before analysis so
the desk keeps cycling through always-open crypto until regular hours return.

## Setup

**Build** in the agent's settings copies `backend/package.json`, `tsconfig.json`
and `src/` into `.runtime/paper-trader/backend`, adds the overlay sources, applies
the patch set, and then runs there:

```
npm install --no-audit --no-fund --no-save --no-package-lock --ignore-scripts
npm install --no-audit --no-fund --no-save --no-package-lock better-sqlite3@^12.9.0 yahoo-finance2@^4.0.2
node_modules/.bin/tsc
```

`--ignore-scripts` stops the clone's pinned `better-sqlite3@^11` from falling
through to node-gyp and hunting for Visual Studio on a machine that has none; the
second install brings in a version whose prebuilt binaries cover current Node,
plus the market-data library. Nothing is written into the checkout at all — not a
lockfile, not a `node_modules`. **Rebuild** restages from the clone, which is how
a `git pull` there is picked up; health reports the workspace as stale when the
clone's sources are newer than the build.

The backend runs under a real `node` from PATH, never `process.execPath`: it
loads two native addons built for the Node ABI, and Electron's binary cannot load
them.

**The framework speaks five ratings, not three.** `process_signal` returns one of
Buy / Overweight / Hold / Underweight / Sell. Reading that by looking for the
words "buy" and "sell" silently discards the two middle ratings — which are the
ones it mostly uses. Three consecutive live analyses came back **Underweight**,
each recommending a trim, and every one was recorded as HOLD; the desk therefore
bought nothing, sold nothing and held nothing, indefinitely, while every other
part of it worked. The rating is now kept as the framework wrote it and
interpreted at serve time, with a conviction attached: a mild bearish call closes
a position but will not open a fresh leveraged short, because "reduce to 70% of a
normal allocation" is not a call to go short. Bullishness is not symmetric —
"overweight" on something the desk owns none of is a plain instruction to own
some.

## Four failures worth knowing about

**The decision endpoint must never answer with an error.** The arena reads a
non-200 as "the model is broken", logs it and trades nothing — so a bug in that
route does not degrade the desk, it stops it, silently, for as long as nobody
reads a server log. A method added to a store cached on `globalThis` did exactly
that: the cached instance predated the method, every call became a 500, and the
desk sat idle looking healthy for half a day. The handler is now wrapped and a
failure becomes an explicit hold carrying its reason, which reaches the card.

**A cached singleton outlives the code that made it.** Same root cause, worth
stating separately because it bites any store on `globalThis`: in development the
module is re-evaluated on every edit while the global survives, so both the class
and the schema stay frozen at whatever they were when the instance was built —
the added column never appeared either, because the migration runs in a
constructor that had already been and gone. `instance.ts` now rebuilds the store
whenever its own module is re-evaluated.

## Two more failures worth knowing about

**An account write is not a database write.** `POST /api/account` and
`PUT /api/account/:id` both `await resetAutoTradingJob()` before answering, which
prefetches a live price for every registered symbol — one ccxt round trip each,
ten to thirty seconds apiece. A read-length client timeout aborts a request the
arena then completes anyway, and the desk ends up enabled with no account id,
answering every decision request with "the desk is not running" while it is. So
account writes get their own 180-second budget, a timeout on one is not an error,
and the account that gets recorded is always read back from the arena's own list
afterwards rather than taken from the response.

**A child outlives whatever forgot to clean it up.** The arena runs on a random
port that lives only in the memory of the process that started it, so a
dev-server restart or a crashed worker leaves an arena nobody can find, still
trading. It now records `{pid, port}` in `.runtime/paper-trader/arena.pid`, and a
start ends any recorded process that is both alive *and* still answering as an
arena on its recorded port — both checks, because pids are recycled and killing a
stranger is worse than leaving a stray backend running.

## Verification status (2026-08-10)

**Coins**, against the real arena with live Hyperliquid prices: the account was
retired and reopened on $25,000, the arena called the decision endpoint with its
bearer token, the shipped `decisionFor` output was accepted, sized (0.077099 BTC
at 2× from a 20% portion), filled at $64,859.50, written to `ai_decision_logs`
with `executed=true`, and read back as a position; the asset curve returned 20
points and the risk officer reconstructed the fill's realised −$7.00 from the
trades table.

**Shares**, against the patched arena built in the workspace: NVDA priced at
$223.96 and 275 daily candles from Yahoo Finance with no key, market status
correctly reported as `PRE`, and a 25% portion of $50,000 filled as **55 whole
shares at leverage 1** — logged, positioned, and executed through the clone's own
order path unchanged.

The decision *served* in that run came from a stub standing in for the route, so
the arena-facing half is proven and the TradingAgents-facing half is covered by
the existing Trading Agent integration rather than by this run. A full live cycle
still needs a ChatMock account with headroom.

Those runs caught four things worth keeping in mind: `POST /api/account` takes no
trailing slash; `/api/account/:id/overview` reports total assets at *notional*
value, so a 2× position on a flat market reads as a 30% gain (the card shows
capital + realised + unrealised instead); git checks the clone out with CRLF on
Windows, so the patch anchors normalise line endings before matching; and a
`.cmd` shim spawned through a shell needs its path quoted, or
`C:\Program Files\nodejs\npm.cmd` runs as `C:\Program`.
