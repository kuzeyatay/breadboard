"""Run one TradingAgents analysis and report its progress as NDJSON.

Breadboard drives the cloned TradingAgents framework the same way its own CLI
does: build the graph, stream the LangGraph chunks, and merge the per-node
deltas into a final state. The CLI paints that stream into a Rich terminal;
this bridge writes it to stdout as one JSON object per line so the dashboard can
turn it into a live card in chat.

Why a bridge and not the CLI: `cli/main.py` is interactive end to end
(questionary prompts, a Rich Live layout, a save-report prompt at the end), so
there is no headless mode to call. Everything below is the CLI's own sequence
minus the terminal — `graph.propagator.create_initial_state`,
`graph.graph.stream`, the same chunk merge, then upstream's own
`write_report_tree` and `process_signal`. Nothing about the analysis is
reimplemented here.

The model layer is ChatMock: `llm_provider=openai_compatible` with
`backend_url` pointed at ChatMock's OpenAI-compatible `/v1`. That provider is
upstream's own generic endpoint — it accepts any model id and binds structured
output without a forced `tool_choice`, which is exactly what a local relay
needs.

Protocol: the job is one JSON object on stdin; every event is one JSON object on
stdout. stderr stays free for tracebacks. Event types:

    started        {ticker, tradeDate, analysts, deepModel, quickModel}
    stage          {stage, status, label}      per agent/team transition
    report         {section, label, content}   a section as it lands
    tools          {calls, llmCalls, promptTokens, completionTokens}
    completed      {rating, decision, reportPath, sections, elapsedSec}
    failed         {error, detail}
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

# The clone is the package root; the bridge lives outside it so the clone stays
# an untouched checkout.
CLONE_ROOT = Path(os.environ.get("TRADINGAGENTS_CLONE_ROOT", "")).resolve()
if CLONE_ROOT and str(CLONE_ROOT) not in sys.path:
    sys.path.insert(0, str(CLONE_ROOT))


def emit(event_type: str, **payload) -> None:
    """Write one event. Flushed per line so the reader sees progress live."""
    line = json.dumps({"type": event_type, **payload}, ensure_ascii=False, default=str)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


# Which state key carries which section, and what to call it in the UI. Ordered
# the way the graph produces them so the card reads top to bottom.
REPORT_SECTIONS = [
    ("market_report", "Market analysis"),
    ("sentiment_report", "Sentiment analysis"),
    ("news_report", "News analysis"),
    ("fundamentals_report", "Fundamentals analysis"),
    ("investment_plan", "Research team decision"),
    ("trader_investment_plan", "Trader plan"),
    ("final_trade_decision", "Portfolio manager decision"),
]

ANALYST_STAGE_LABELS = {
    "market": "Market Analyst",
    "social": "Sentiment Analyst",
    "news": "News Analyst",
    "fundamentals": "Fundamentals Analyst",
}

TEAM_STAGES = [
    ("research", "Research team debate"),
    ("trader", "Trader"),
    ("risk", "Risk management debate"),
    ("portfolio", "Portfolio manager"),
]


class StageTracker:
    """Emit a `stage` event only when a stage actually moves forward.

    Two things make the naive version wrong. The graph yields many chunks per
    node, so an unguarded emit floods the stream with duplicates. And the merged
    state keeps carrying the research debate's history long after the debate is
    over, so a rule like "bull history exists, therefore research is running"
    stays true for the rest of the run — the risk debate's chunks would otherwise
    push the research and trader rows back to `running` on every chunk.

    So progress is monotonic: a stage that finished stays finished.
    """

    ORDER = {"pending": 0, "running": 1, "completed": 2}

    def __init__(self) -> None:
        self._states: dict[str, str] = {}

    def set(self, stage: str, status: str, label: str) -> None:
        current = self._states.get(stage, "pending")
        if self.ORDER.get(status, 0) <= self.ORDER.get(current, 0) and stage in self._states:
            return
        self._states[stage] = status
        emit("stage", stage=stage, status=status, label=label)

    def status(self, stage: str) -> str:
        return self._states.get(stage, "pending")


def read_job() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("no job was provided on stdin")
    job = json.loads(raw)
    if not isinstance(job, dict):
        raise ValueError("the job must be a JSON object")
    return job


def build_config(job: dict, default_config: dict) -> dict:
    config = default_config.copy()
    config["llm_provider"] = "openai_compatible"
    config["backend_url"] = job["backendUrl"]
    config["deep_think_llm"] = job["deepModel"]
    config["quick_think_llm"] = job["quickModel"]
    config["max_debate_rounds"] = int(job.get("researchDepth", 1))
    config["max_risk_discuss_rounds"] = int(job.get("riskRounds", 1))
    config["output_language"] = job.get("outputLanguage") or "English"
    # Reasoning effort is forwarded only when the caller asked for one; the
    # provider drops it for models that do not take it.
    if job.get("reasoningEffort"):
        config["openai_reasoning_effort"] = job["reasoningEffort"]
    # A run inside Breadboard is one shot: a half-written checkpoint from a
    # cancelled run would silently resume into the next one.
    config["checkpoint_enabled"] = False

    vendors = job.get("dataVendors")
    if isinstance(vendors, dict) and vendors:
        config["data_vendors"] = {**config.get("data_vendors", {}), **vendors}

    results_dir = job.get("resultsDir")
    if results_dir:
        config["results_dir"] = results_dir
    cache_dir = job.get("cacheDir")
    if cache_dir:
        config["data_cache_dir"] = cache_dir
    return config


def sections_from_state(state: dict) -> list[dict]:
    sections = []
    for key, label in REPORT_SECTIONS:
        content = state.get(key)
        if isinstance(content, str) and content.strip():
            sections.append({"section": key, "label": label, "content": content})
    return sections


def main() -> int:
    started_at = time.monotonic()
    try:
        job = read_job()
    except Exception as error:  # noqa: BLE001 — the reader gets the reason, not a crash
        emit("failed", error="The analysis request could not be read.", detail=str(error))
        return 1

    ticker = str(job.get("ticker", "")).strip()
    trade_date = str(job.get("tradeDate", "")).strip()
    analysts = [str(item) for item in job.get("analysts", []) if str(item).strip()]
    asset_type = str(job.get("assetType") or "stock")

    if not ticker or not trade_date or not analysts:
        emit(
            "failed",
            error="The analysis request was incomplete.",
            detail="ticker, tradeDate and at least one analyst are required.",
        )
        return 1

    try:
        from cli.stats_handler import StatsCallbackHandler
        from tradingagents.default_config import DEFAULT_CONFIG
        from tradingagents.graph.trading_graph import TradingAgentsGraph
        from tradingagents.reporting import write_report_tree
    except Exception as error:  # noqa: BLE001
        emit(
            "failed",
            error="The TradingAgents package could not be imported.",
            detail=f"{error}\n{traceback.format_exc(limit=3)}",
        )
        return 1

    try:
        config = build_config(job, DEFAULT_CONFIG)
        stats = StatsCallbackHandler()
        graph = TradingAgentsGraph(
            selected_analysts=analysts,
            debug=False,
            config=config,
            callbacks=[stats],
        )
    except Exception as error:  # noqa: BLE001
        emit(
            "failed",
            error="The trading graph could not be created.",
            detail=f"{error}\n{traceback.format_exc(limit=3)}",
        )
        return 1

    emit(
        "started",
        ticker=ticker,
        tradeDate=trade_date,
        analysts=analysts,
        assetType=asset_type,
        deepModel=config["deep_think_llm"],
        quickModel=config["quick_think_llm"],
    )

    tracker = StageTracker()
    for key in analysts:
        tracker.set(key, "pending", ANALYST_STAGE_LABELS.get(key, key.title()))
    for stage, label in TEAM_STAGES:
        tracker.set(stage, "pending", label)
    tracker.set(analysts[0], "running", ANALYST_STAGE_LABELS.get(analysts[0], analysts[0]))

    emitted_sections: set[str] = set()

    def publish(state: dict) -> None:
        """Emit any section that has landed since the last chunk."""
        for key, label in REPORT_SECTIONS:
            if key in emitted_sections:
                continue
            content = state.get(key)
            if isinstance(content, str) and content.strip():
                emitted_sections.add(key)
                emit("report", section=key, label=label, content=content)

    try:
        instrument_context = graph.resolve_instrument_context(ticker, asset_type)
        initial_state = graph.propagator.create_initial_state(
            ticker,
            trade_date,
            asset_type=asset_type,
            past_context=graph.memory_log.get_past_context(ticker),
            instrument_context=instrument_context,
        )
        args = graph.propagator.get_graph_args(callbacks=[stats])

        final_state: dict = {}
        last_stats_report = 0.0
        for chunk in graph.graph.stream(initial_state, **args):
            final_state.update(chunk)

            # Analysts: a written report means that analyst is done and the
            # next one in the selection has started.
            running_marked = False
            for key in analysts:
                report_key = {
                    "market": "market_report",
                    "social": "sentiment_report",
                    "news": "news_report",
                    "fundamentals": "fundamentals_report",
                }[key]
                label = ANALYST_STAGE_LABELS.get(key, key)
                if final_state.get(report_key):
                    tracker.set(key, "completed", label)
                elif not running_marked:
                    tracker.set(key, "running", label)
                    running_marked = True

            debate = final_state.get("investment_debate_state") or {}
            if debate.get("bull_history") or debate.get("bear_history"):
                tracker.set("research", "running", "Research team debate")
            if debate.get("judge_decision"):
                tracker.set("research", "completed", "Research team debate")
                tracker.set("trader", "running", "Trader")

            if final_state.get("trader_investment_plan"):
                tracker.set("trader", "completed", "Trader")
                tracker.set("risk", "running", "Risk management debate")

            risk = final_state.get("risk_debate_state") or {}
            if risk.get("aggressive_history") or risk.get("conservative_history") or risk.get(
                "neutral_history"
            ):
                tracker.set("risk", "running", "Risk management debate")
            if risk.get("judge_decision"):
                tracker.set("risk", "completed", "Risk management debate")
                tracker.set("portfolio", "completed", "Portfolio manager")

            publish(final_state)

            # Token and tool counters, rate-limited so a chatty graph does not
            # turn the event log into a counter feed.
            now = time.monotonic()
            if now - last_stats_report > 2:
                last_stats_report = now
                snapshot = stats.get_stats()
                emit(
                    "tools",
                    calls=snapshot.get("tool_calls", 0),
                    llmCalls=snapshot.get("llm_calls", 0),
                    promptTokens=snapshot.get("tokens_in", 0),
                    completionTokens=snapshot.get("tokens_out", 0),
                )
    except Exception as error:  # noqa: BLE001
        emit(
            "failed",
            error="The analysis stopped before it finished.",
            detail=f"{error}\n{traceback.format_exc(limit=4)}",
        )
        return 1

    for stage in [*analysts, *(name for name, _ in TEAM_STAGES)]:
        if tracker.status(stage) != "completed":
            label = ANALYST_STAGE_LABELS.get(stage, dict(TEAM_STAGES).get(stage, stage))
            tracker.set(stage, "completed", label)
    publish(final_state)

    decision = final_state.get("final_trade_decision") or ""
    try:
        rating = graph.process_signal(decision) if decision else ""
    except Exception:  # noqa: BLE001 — a missing rating must not lose the report
        rating = ""

    report_path = ""
    try:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        target = Path(config["results_dir"]) / "breadboard" / f"{ticker}_{trade_date}_{stamp}"
        report_path = str(write_report_tree(final_state, ticker, target))
    except Exception:  # noqa: BLE001 — the on-disk copy is a convenience
        report_path = ""

    # Upstream remembers each decision so the next run on the same ticker can
    # reflect on it. Keeping this means Breadboard runs accumulate the same
    # memory a CLI user's runs would.
    try:
        if decision:
            graph.memory_log.store_decision(
                ticker=ticker,
                trade_date=trade_date,
                final_trade_decision=decision,
            )
    except Exception:  # noqa: BLE001
        pass

    snapshot = stats.get_stats()
    emit(
        "completed",
        rating=rating,
        decision=decision,
        reportPath=report_path,
        sections=sections_from_state(final_state),
        llmCalls=snapshot.get("llm_calls", 0),
        toolCalls=snapshot.get("tool_calls", 0),
        promptTokens=snapshot.get("tokens_in", 0),
        completionTokens=snapshot.get("tokens_out", 0),
        elapsedSec=round(time.monotonic() - started_at, 2),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
