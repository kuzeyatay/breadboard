"""Report prompt-cache evidence from a preserved Super agent QA run.

Usage: python -I super-agent-cache-report.py <preserved QA run directory>

Reads the disposable profile read-only: the per-turn dispatch records and
message usage in brain.db, and ChatMock's per-call usage ledger. The first
model call of a turn is the one that shows whether the previous turns were
served from the provider's cache; later calls in the same turn re-read what
that first call just wrote.
"""
import json
import os
import sqlite3
import sys

MARKER = "<!-- breadboard:turn-context -->"
root = sys.argv[1]


def find(name):
    hits = []
    for folder, _dirs, files in os.walk(root):
        if name in files:
            hits.append(os.path.join(folder, name))
    return sorted(hits, key=os.path.getsize, reverse=True)


databases = find("brain.db")
if not databases:
    sys.exit("no brain.db under " + root)
db = sqlite3.connect("file:" + databases[0].replace("\\", "/") + "?mode=ro", uri=True)
db.row_factory = sqlite3.Row

runs = db.execute("select id, dispatch_json, started_at, finished_at, status from hermes_runs order by started_at").fetchall()
print(f"turn dispatches: {len(runs)}")
previous = None
windows = []
for index, run in enumerate(runs, 1):
    dispatch = json.loads(run["dispatch_json"] or "{}")
    system = dispatch.get("system") or ""
    head, _, tail = system.partition(MARKER)
    same = "-" if previous is None else ("identical" if head == previous else f"differs at char {len(os.path.commonprefix([head, previous]))}")
    previous = head
    windows.append((run["started_at"], run["finished_at"]))
    print(f"  turn {index}: {run['status']:10} super={'# super_agent_mode' in system!s:5} "
          f"stable head {len(head) // 4:>6,} tok, per-turn context {len(tail) // 4:>6,} tok, head vs previous turn: {same}")

print("\nper message (all model calls of the turn summed):")
for row in db.execute("select token_usage from conversation_messages where role='assistant' and token_usage is not null order by id"):
    usage = json.loads(row["token_usage"])
    i, c = usage.get("inputTokens") or 0, usage.get("cachedInputTokens") or 0
    print(f"  input {i:>9,}  cached {c:>9,} ({100 * c / i if i else 0:5.1f}%)  output {usage.get('outputTokens') or 0:>6,}")

ledgers = find("usage_ledger.jsonl")
if not ledgers:
    sys.exit("\nno usage_ledger.jsonl found; per-call figures unavailable")
calls = []
with open(ledgers[0], encoding="utf-8") as handle:
    for line in handle:
        try:
            calls.append(json.loads(line))
        except ValueError:
            pass
print(f"\nper model call ({len(calls)} ledger rows; keys: {sorted(calls[0].keys()) if calls else []}):")
first_calls = []
turn = 0
for call in calls:
    tokens = call.get("tokens") or {}
    i, c = tokens.get("input") or 0, tokens.get("cached") or 0
    if i < 6000:  # routers, titlers and other small side calls
        continue
    stamp = str(call.get("ts") or call.get("at") or call.get("time") or "")
    position = sum(1 for start, _ in windows if start and stamp and stamp >= start[:19])
    first = position != turn
    turn = position
    if first:
        first_calls.append((i, c))
    print(f"  {stamp[:19]:19} turn {position} {'FIRST' if first else '     '} {str(call.get('model') or '')[:22]:22} "
          f"input {i:>8,}  cached {c:>8,} ({100 * c / i if i else 0:5.1f}%)")
later = first_calls[1:]
if later:
    i, c = sum(x for x, _ in later), sum(y for _, y in later)
    print(f"\nfirst call of turns 2+: {len(later)} calls, input {i:,}, cached {c:,} -> uncached {100 * (1 - c / i):.1f}% of input")
