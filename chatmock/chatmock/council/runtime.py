from __future__ import annotations

import json
import random
import string
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

from ..model_registry import normalize_model_name
from ..providers.router import ProviderRouter
from ..providers.types import ModelCall, ProviderError
from . import ledger as ledger_events
from .ledger import CouncilLedger, JsonlCouncilLedger
from .policy import CouncilConfig, choose_council_mode
from .prompts import (
    BREADBOARD_COUNCIL_SYSTEM,
    CANDIDATE_INSTRUCTIONS,
    CANDIDATE_ROLE_VARIANTS,
    CHAIR_SYNTHESIZER_PROMPT,
    COMPACT_CHECKLIST,
    CRITIC_ROLES,
    EVOLUTION_EVALUATE_PROMPT,
    EVOLUTION_MUTATE_PROMPT,
    LITE_CRITIC_PROMPT,
    LITE_CRITIC_ROLE,
    build_chair_user_prompt,
    build_review_user_prompt,
)
from .types import (
    EVOLUTION_ARTIFACT_TYPES,
    AggregateRanking,
    CouncilCandidate,
    CouncilInput,
    CouncilReview,
    CouncilRun,
    EvolutionNode,
    messages_text,
    new_id,
    now_iso,
)

_MAX_TASK_TEXT_CHARS = 60000


class CouncilError(RuntimeError):
    """A council run could not produce any answer."""


def _clip(text: str, limit: int = _MAX_TASK_TEXT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n\n[...truncated for council deliberation...]"


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """Tolerant JSON extraction: models sometimes wrap JSON in prose/fences."""
    if not isinstance(text, str) or not text.strip():
        return None
    candidates = [text.strip()]
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])
    for chunk in candidates:
        try:
            parsed = json.loads(chunk)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    return None


class CouncilRuntime:
    """Karpathy-style LLM Council: candidates -> anonymous review -> aggregate
    ranking -> chairman synthesis, compressed into cheaper modes when safe."""

    def __init__(
        self,
        config: Optional[CouncilConfig] = None,
        router: Optional[ProviderRouter] = None,
        ledger: Optional[CouncilLedger] = None,
    ) -> None:
        self.config = config or CouncilConfig.from_env()
        self.router = router or ProviderRouter(self.config)
        self.ledger = ledger or JsonlCouncilLedger(self.config.ledger_dir)

    def _model_for_call(self, model: str, council_input: CouncilInput) -> str:
        call_model = model or self.config.upstream_fallback_model
        if "/" not in call_model:
            return call_model
        requested = (council_input.requested_model or "").strip()
        if requested and "/" not in requested:
            return normalize_model_name(requested)
        return self.config.upstream_fallback_model

    # ------------------------------------------------------------------ run

    def run(self, council_input: CouncilInput) -> CouncilRun:
        mode = choose_council_mode(council_input, self.config)
        run = CouncilRun(
            id=new_id("crun"),
            user_prompt=_clip(council_input.user_prompt, 8000),
            messages=council_input.messages,
            council_mode=mode,
            garden_id=council_input.garden_id,
            page_id=council_input.page_id,
            task_type=council_input.task_type,
            source_context=council_input.source_context,
        )
        self.ledger.record_event(
            run.id,
            ledger_events.EVENT_RUN_CREATED,
            {"councilMode": mode, "taskType": council_input.task_type},
        )
        try:
            if mode == "direct_council":
                self._run_direct(council_input, run)
            elif mode == "lite_council":
                self._run_lite(council_input, run)
            elif mode == "full_council":
                self._run_full(council_input, run)
            elif mode == "evolution_council":
                self._run_evolution(council_input, run)
            else:  # pragma: no cover - choose_council_mode only returns known modes
                raise CouncilError(f"unknown council mode: {mode}")
        except Exception as exc:
            run.diagnostics["error"] = str(exc)
            self.ledger.record_event(run.id, ledger_events.EVENT_RUN_FAILED, {"error": str(exc)})
        finally:
            run.updated_at = now_iso()
            self.ledger.save_run(run)
        return run

    # ------------------------------------------------------------ model call

    def _call(
        self,
        model: str,
        system: str,
        messages: List[Dict[str, Any]],
        council_input: CouncilInput,
    ) -> str:
        text, _ = self._call_with_reasoning(model, system, messages, council_input)
        return text

    def _call_with_reasoning(
        self,
        model: str,
        system: str,
        messages: List[Dict[str, Any]],
        council_input: CouncilInput,
    ) -> Tuple[str, Optional[str]]:
        """Like _call, but also returns the model's reasoning ("thinking") trace
        when the provider streamed one."""
        call_model = self._model_for_call(model, council_input)
        call = ModelCall(
            model=call_model,
            messages=messages,
            system=system,
            temperature=council_input.temperature,
            max_tokens=council_input.max_tokens,
        )
        text = self.router.call_model(call)
        if not isinstance(text, str) or not text.strip():
            raise ProviderError(f"model {call_model} returned an empty answer")
        reasoning = call.reasoning_out if isinstance(call.reasoning_out, str) and call.reasoning_out.strip() else None
        return text, reasoning

    def _task_text(self, council_input: CouncilInput) -> str:
        return _clip(messages_text(council_input.messages))

    def _candidate_models(self) -> List[Tuple[str, Optional[str]]]:
        """(model, role) seats for full council. When only one distinct model is
        reachable, differentiate seats with candidate role variants instead."""
        models = [m for m in self.config.council_models if m][: self.config.max_candidates]
        if not models:
            models = [self.config.upstream_fallback_model]
        effective = {self.router.effective_model(m) for m in models}
        if len(effective) > 1:
            return [(m, None) for m in models]
        model = models[0]
        return [
            (model, variant["role"])
            for variant in CANDIDATE_ROLE_VARIANTS[: max(2, min(self.config.max_candidates, len(CANDIDATE_ROLE_VARIANTS)))]
        ]

    # ----------------------------------------------------------- candidates

    def _generate_candidates(
        self,
        council_input: CouncilInput,
        run: CouncilRun,
        seats: List[Tuple[str, Optional[str]]],
    ) -> List[CouncilCandidate]:
        role_instructions = {v["role"]: v["instructions"] for v in CANDIDATE_ROLE_VARIANTS}

        def _one(seat: Tuple[str, Optional[str]]) -> Tuple[CouncilCandidate | None, str | None]:
            model, role = seat
            system = BREADBOARD_COUNCIL_SYSTEM + "\n\n" + CANDIDATE_INSTRUCTIONS
            if role and role in role_instructions:
                system += "\n\n" + role_instructions[role]
            try:
                content, reasoning = self._call_with_reasoning(
                    model, system, council_input.messages, council_input
                )
                return (
                    CouncilCandidate(
                        id=new_id("cand"),
                        model=model,
                        role=role,
                        content=content,
                        metadata={"reasoning": reasoning} if reasoning else None,
                    ),
                    None,
                )
            except Exception as exc:
                return None, f"{model}: {exc}"

        failures: List[str] = []
        candidates: List[CouncilCandidate] = []
        with ThreadPoolExecutor(max_workers=max(1, len(seats))) as pool:
            for candidate, failure in pool.map(_one, seats):
                if candidate is not None:
                    candidates.append(candidate)
                    run.candidates.append(candidate)
                    self.ledger.record_event(
                        run.id,
                        ledger_events.EVENT_CANDIDATE_GENERATED,
                        {"candidateId": candidate.id, "model": candidate.model, "role": candidate.role},
                    )
                elif failure:
                    failures.append(failure)
        if failures:
            run.diagnostics.setdefault("candidateFailures", []).extend(failures)
        if not candidates:
            raise CouncilError("all council candidate models failed")
        return candidates

    @staticmethod
    def _anonymize(candidates: List[CouncilCandidate]) -> None:
        order = list(range(len(candidates)))
        random.shuffle(order)
        for label_index, candidate_index in enumerate(order):
            letter = string.ascii_uppercase[label_index % 26]
            candidates[candidate_index].anonymized_id = f"Response {letter}"

    # -------------------------------------------------------------- reviews

    def _parse_review(
        self,
        raw: str,
        reviewer_model: str,
        reviewer_role: str,
        candidates: List[CouncilCandidate],
    ) -> CouncilReview:
        label_to_id = {c.anonymized_id: c.id for c in candidates if c.anonymized_id}
        review = CouncilReview(
            id=new_id("crev"),
            reviewer_model=reviewer_model,
            reviewer_role=reviewer_role,
            anonymized_candidate_ids=[c.anonymized_id or c.id for c in candidates],
            critique=raw,
        )
        parsed = _extract_json_object(raw)
        if not parsed:
            return review
        rankings = parsed.get("rankings")
        if isinstance(rankings, list):
            review.rankings = [str(r) for r in rankings if str(r) in label_to_id]
        scores = parsed.get("scores")
        if isinstance(scores, dict):
            clean: Dict[str, float] = {}
            for key, value in scores.items():
                if str(key) in label_to_id:
                    try:
                        clean[str(key)] = float(value)
                    except Exception:
                        continue
            if clean:
                review.scores = clean
        critique = parsed.get("critique")
        if isinstance(critique, str) and critique.strip():
            review.critique = critique
        winner = parsed.get("recommended_winner")
        if isinstance(winner, str) and winner in label_to_id:
            review.recommended_winner_id = label_to_id[winner]
        return review

    def _review_candidates(
        self,
        council_input: CouncilInput,
        run: CouncilRun,
        candidates: List[CouncilCandidate],
        critic_roles: List[Tuple[str, str]],
        model_offset: int = 0,
    ) -> List[CouncilReview]:
        task_text = self._task_text(council_input)
        review_user_prompt = build_review_user_prompt(task_text, candidates)
        models = self.config.council_models or [self.config.upstream_fallback_model]

        def _one(indexed_role: Tuple[int, Tuple[str, str]]) -> Tuple[CouncilReview | None, str | None]:
            index, (role_name, role_prompt) = indexed_role
            reviewer_model = models[(index + model_offset) % len(models)]
            system = role_prompt + "\n\nYou are reviewing anonymous candidate answers. Be specific and unsparing."
            try:
                raw = self._call(
                    reviewer_model,
                    system,
                    [{"role": "user", "content": review_user_prompt}],
                    council_input,
                )
                return self._parse_review(raw, reviewer_model, role_name, candidates), None
            except Exception as exc:
                return None, f"{role_name}/{reviewer_model}: {exc}"

        reviews: List[CouncilReview] = []
        failures: List[str] = []
        with ThreadPoolExecutor(max_workers=max(1, len(critic_roles))) as pool:
            for review, failure in pool.map(_one, list(enumerate(critic_roles))):
                if review is not None:
                    reviews.append(review)
                    run.reviews.append(review)
                    self.ledger.record_event(
                        run.id,
                        ledger_events.EVENT_REVIEW_COMPLETED,
                        {"reviewId": review.id, "reviewerRole": review.reviewer_role, "reviewerModel": review.reviewer_model},
                    )
                elif failure:
                    failures.append(failure)
        if failures:
            run.diagnostics.setdefault("reviewFailures", []).extend(failures)
        return reviews

    # ------------------------------------------------------------ aggregate

    @staticmethod
    def _aggregate_reviews(
        candidates: List[CouncilCandidate],
        reviews: List[CouncilReview],
    ) -> Optional[AggregateRanking]:
        if not reviews:
            return None
        label_to_id = {c.anonymized_id: c.id for c in candidates if c.anonymized_id}
        totals: Dict[str, float] = {c.id: 0.0 for c in candidates}
        ranked_reviews = 0
        scored_reviews = 0
        for review in reviews:
            if review.rankings:
                ranked_reviews += 1
                n = len(review.rankings)
                for position, label in enumerate(review.rankings):
                    cand_id = label_to_id.get(label)
                    if cand_id:
                        totals[cand_id] += float(n - position)  # Borda points
            if review.scores:
                scored_reviews += 1
                for label, score in review.scores.items():
                    cand_id = label_to_id.get(label)
                    if cand_id:
                        totals[cand_id] += max(0.0, min(10.0, score)) / 10.0
        ordered = sorted(totals.keys(), key=lambda cid: totals[cid], reverse=True)
        explanation = (
            f"Aggregated {len(reviews)} peer reviews ({ranked_reviews} with rankings, "
            f"{scored_reviews} with scores) using Borda counts plus normalized scores."
        )
        return AggregateRanking(
            ordered_candidate_ids=ordered,
            score_by_candidate_id={cid: round(score, 3) for cid, score in totals.items()},
            explanation=explanation,
        )

    # ------------------------------------------------------------ synthesis

    def _synthesize(
        self,
        council_input: CouncilInput,
        run: CouncilRun,
        candidates: List[CouncilCandidate],
        reviews: List[CouncilReview],
        ranking: Optional[AggregateRanking],
    ) -> str:
        chair_prompt = build_chair_user_prompt(
            self._task_text(council_input),
            candidates,
            reviews,
            ranking.explanation if ranking else None,
        )
        try:
            final = self._call(
                self.config.chairman_model,
                BREADBOARD_COUNCIL_SYSTEM + "\n\n" + CHAIR_SYNTHESIZER_PROMPT,
                [{"role": "user", "content": chair_prompt}],
                council_input,
            )
            self.ledger.record_event(
                run.id,
                ledger_events.EVENT_FINAL_SYNTHESIZED,
                {"chairmanModel": self.config.chairman_model},
            )
            return final
        except Exception as exc:
            # Synthesis failed: fall back to the highest-ranked candidate.
            run.diagnostics["synthesisFailure"] = str(exc)
            best = self._best_candidate(candidates, ranking)
            self.ledger.record_event(
                run.id,
                ledger_events.EVENT_FINAL_SYNTHESIZED,
                {"fallback": "highest_ranked_candidate", "candidateId": best.id},
            )
            return best.content

    @staticmethod
    def _best_candidate(
        candidates: List[CouncilCandidate],
        ranking: Optional[AggregateRanking],
    ) -> CouncilCandidate:
        if ranking and ranking.ordered_candidate_ids:
            by_id = {c.id: c for c in candidates}
            for cand_id in ranking.ordered_candidate_ids:
                if cand_id in by_id:
                    return by_id[cand_id]
        return candidates[0]

    # ---------------------------------------------------------------- modes

    def _run_direct(self, council_input: CouncilInput, run: CouncilRun) -> None:
        model = council_input.requested_model or self.config.upstream_fallback_model
        system = BREADBOARD_COUNCIL_SYSTEM + "\n\n" + COMPACT_CHECKLIST
        final, reasoning = self._call_with_reasoning(model, system, council_input.messages, council_input)
        candidate = CouncilCandidate(
            id=new_id("cand"),
            model=model,
            role="direct",
            content=final,
            metadata={"synthetic": True, "reasoning": reasoning} if reasoning else {"synthetic": True},
        )
        run.candidates.append(candidate)
        self.ledger.record_event(
            run.id,
            ledger_events.EVENT_CANDIDATE_GENERATED,
            {"candidateId": candidate.id, "model": model, "role": "direct"},
        )
        run.final_answer = final
        self.ledger.record_event(
            run.id,
            ledger_events.EVENT_FINAL_SYNTHESIZED,
            {"mode": "direct_council", "model": model},
        )

    def _run_lite(self, council_input: CouncilInput, run: CouncilRun) -> None:
        models = self.config.council_models or [self.config.upstream_fallback_model]
        seats: List[Tuple[str, Optional[str]]] = [(models[0], None)]
        candidates = self._generate_candidates(council_input, run, seats)
        self._anonymize(candidates)
        # Review with a different council model than the candidate when possible.
        reviews = self._review_candidates(
            council_input,
            run,
            candidates,
            [(LITE_CRITIC_ROLE, LITE_CRITIC_PROMPT)],
            model_offset=1 if len(models) > 1 else 0,
        )
        ranking = self._aggregate_reviews(candidates, reviews)
        run.aggregate_ranking = ranking
        run.final_answer = self._synthesize(council_input, run, candidates, reviews, ranking)

    def _run_full(self, council_input: CouncilInput, run: CouncilRun) -> None:
        seats = self._candidate_models()
        candidates = self._generate_candidates(council_input, run, seats)
        self._anonymize(candidates)
        critic_roles = list(CRITIC_ROLES.items())[: self.config.max_critics]
        reviews = self._review_candidates(council_input, run, candidates, critic_roles)
        ranking = self._aggregate_reviews(candidates, reviews)
        run.aggregate_ranking = ranking
        run.final_answer = self._synthesize(council_input, run, candidates, reviews, ranking)

    # ------------------------------------------------------------ evolution

    def _run_evolution(self, council_input: CouncilInput, run: CouncilRun) -> None:
        """Structure-only DGM-style loop: mutate an artifact, score candidates
        against the baseline, and persist versioned EvolutionNode records.
        This never modifies production code; it only writes ledger artifacts."""
        context = council_input.source_context if isinstance(council_input.source_context, dict) else {}
        artifact = context.get("artifact")
        if artifact is None:
            artifact = council_input.user_prompt
        artifact_type = context.get("artifactType")
        if artifact_type not in EVOLUTION_ARTIFACT_TYPES:
            artifact_type = "prompt"
        parent_id = context.get("parentNodeId") if isinstance(context.get("parentNodeId"), str) else None
        goal = context.get("goal") if isinstance(context.get("goal"), str) else "Improve this artifact."
        artifact_text = artifact if isinstance(artifact, str) else json.dumps(artifact, ensure_ascii=False, default=str)

        models = self.config.council_models or [self.config.upstream_fallback_model]
        mutate_prompt = (
            f"Improvement goal: {goal}\n\nArtifact type: {artifact_type}\n\n"
            f"Current artifact (baseline):\n\n{_clip(artifact_text, 20000)}"
        )
        seats = [
            (models[i % len(models)], f"mutation_{i + 1}")
            for i in range(max(1, self.config.evolution_candidates))
        ]

        def _mutate(seat: Tuple[str, str]) -> Tuple[CouncilCandidate | None, str | None]:
            model, role = seat
            try:
                content = self._call(
                    model,
                    BREADBOARD_COUNCIL_SYSTEM + "\n\n" + EVOLUTION_MUTATE_PROMPT,
                    [{"role": "user", "content": mutate_prompt}],
                    council_input,
                )
                return CouncilCandidate(id=new_id("cand"), model=model, role=role, content=content), None
            except Exception as exc:
                return None, f"{model}: {exc}"

        candidates: List[CouncilCandidate] = []
        failures: List[str] = []
        with ThreadPoolExecutor(max_workers=max(1, len(seats))) as pool:
            for candidate, failure in pool.map(_mutate, seats):
                if candidate is not None:
                    candidates.append(candidate)
                    run.candidates.append(candidate)
                    self.ledger.record_event(
                        run.id,
                        ledger_events.EVENT_CANDIDATE_GENERATED,
                        {"candidateId": candidate.id, "model": candidate.model, "role": candidate.role},
                    )
                elif failure:
                    failures.append(failure)
        if failures:
            run.diagnostics.setdefault("candidateFailures", []).extend(failures)
        if not candidates:
            raise CouncilError("all evolution candidate models failed")

        # Score candidates and the baseline together, anonymously.
        baseline = CouncilCandidate(
            id=new_id("cand"),
            model="baseline",
            role="baseline",
            content=artifact_text,
            metadata={"baseline": True},
        )
        scored = candidates + [baseline]
        self._anonymize(scored)
        reviews = self._review_candidates(
            council_input,
            run,
            scored,
            [("evolution_evaluator", EVOLUTION_EVALUATE_PROMPT)],
        )
        ranking = self._aggregate_reviews(scored, reviews)
        run.aggregate_ranking = ranking

        totals = ranking.score_by_candidate_id if ranking else {}
        baseline_score = totals.get(baseline.id, 0.0)
        best_id: Optional[str] = None
        best_score = float("-inf")
        for candidate in candidates:
            score = totals.get(candidate.id, 0.0)
            if score > best_score:
                best_score = score
                best_id = candidate.id

        nodes: List[EvolutionNode] = []
        for candidate in candidates:
            score = totals.get(candidate.id, 0.0)
            promoted = candidate.id == best_id and score > baseline_score
            node = EvolutionNode(
                id=new_id("evo"),
                parent_id=parent_id,
                garden_id=council_input.garden_id,
                page_id=council_input.page_id,
                artifact_type=artifact_type,
                artifact_snapshot=candidate.content,
                mutation_description=f"{candidate.role or 'mutation'} by {candidate.model} toward goal: {goal}",
                council_run_id=run.id,
                evaluation_scores={"aggregate": score, "baseline": baseline_score},
                status="promoted" if promoted else "rejected",
            )
            nodes.append(node)
            self.ledger.save_evolution_node(node)

        summary = {
            "artifactType": artifact_type,
            "baselineScore": baseline_score,
            "promotedNodeId": next((n.id for n in nodes if n.status == "promoted"), None),
            "nodes": [
                {"id": n.id, "status": n.status, "score": n.evaluation_scores.get("aggregate", 0.0)}
                for n in nodes
            ],
        }
        run.diagnostics["evolution"] = summary
        run.final_answer = json.dumps(summary, ensure_ascii=False, indent=2)
        self.ledger.record_event(
            run.id,
            ledger_events.EVENT_FINAL_SYNTHESIZED,
            {"mode": "evolution_council", "promotedNodeId": summary["promotedNodeId"]},
        )
