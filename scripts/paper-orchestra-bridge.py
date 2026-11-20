"""Breadboard's driver for the vendored PaperOrchestra pipeline.

Reads one JSON job on stdin, runs `methods.paper_writer[_with_plotting]`, and
writes NDJSON events on stdout. Everything upstream prints goes to stderr.

Two seams are replaced before any upstream module that uses them is imported
(they are bound by name at import time):

* every model call (Gemini and OpenAI paths alike) goes to ChatMock's
  OpenAI-compatible `/v1/chat/completions` with the model chosen in chat;
* `compile_latex` runs Tectonic instead of pdflatex + bibtex.

Upstream's literature discovery used Gemini's Google Search grounding. Here it
searches real scholarly catalogs instead: the bridge sends a `search` event and
the run manager answers on stdin with Get Doc's merged OpenAlex / arXiv /
Europe PMC / Semantic Scholar / Crossref results. The model only writes the
queries and picks the relevant hits; the bibliography is built from the
catalog records, never from the model's memory.
"""

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback

# The real stdout carries events only; upstream's prints go to stderr.
EVENTS = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr


_EMIT_LOCK = threading.Lock()


def emit(event_type, **payload):
    with _EMIT_LOCK:  # the literature agent searches from several threads
        EVENTS.write(json.dumps({"type": event_type, **payload}) + "\n")
        EVENTS.flush()


JOB = json.loads(sys.stdin.readline())
sys.path.insert(0, JOB["root"])
os.chdir(JOB["root"])

from openai import OpenAI  # noqa: E402
from google.genai import types  # noqa: E402

CLIENT = OpenAI(base_url=JOB["baseUrl"], api_key=JOB["apiKey"] or "breadboard", timeout=600)
MODEL = JOB["model"]
IMAGE_MODEL = JOB.get("imageModel") or None


def _pdf_text(data):
    import pymupdf  # noqa: PLC0415

    with pymupdf.open(stream=data, filetype="pdf") as document:
        return "\n".join(page.get_text() for page in document)


def _parts(contents):
    """Gemini `contents` (str | Part | Content | list of those) -> OpenAI parts."""
    items = contents if isinstance(contents, (list, tuple)) else [contents]
    parts = []
    for item in items:
        if isinstance(item, str):
            parts.append({"type": "text", "text": item})
            continue
        nested = getattr(item, "parts", None)
        if nested and not getattr(item, "inline_data", None):
            parts.extend(_parts(list(nested)))
            continue
        if getattr(item, "text", None):
            parts.append({"type": "text", "text": item.text})
            continue
        blob = getattr(item, "inline_data", None)
        if blob is None or blob.data is None:
            continue
        mime = blob.mime_type or "application/octet-stream"
        if mime == "application/pdf":
            parts.append({"type": "text", "text": f"PDF content:\n{_pdf_text(blob.data)}"})
        elif mime.startswith("image/"):
            url = f"data:{mime};base64,{base64.b64encode(blob.data).decode()}"
            parts.append({"type": "image_url", "image_url": {"url": url}})
    return parts


def _chat(parts, system=None, temperature=None, attempts=4):
    messages = ([{"role": "system", "content": system}] if system else []) + [
        {"role": "user", "content": parts}
    ]
    extra = {} if temperature is None else {"temperature": temperature}
    for attempt in range(attempts):
        try:
            response = CLIENT.chat.completions.create(model=MODEL, messages=messages, **extra)
            text = response.choices[0].message.content
            if not text:
                raise ValueError("The model returned an empty answer.")
            return text
        except Exception as error:  # noqa: BLE001
            if attempt + 1 == attempts:
                raise
            print(f"Model call failed ({error}); retrying.")
            time.sleep(5 * 2**attempt)


def _answer(text, parser, check):
    parsed = parser(text) if parser else text
    if check and parsed is None:
        raise ValueError(f"Could not parse the model's answer:\n{text[:2000]}")
    return {"raw_response": text, "parsed_response": parsed}


def _call(parts, parser, check, system=None, temperature=None):
    # A parse failure is retried with a fresh answer, as upstream's loop does.
    for attempt in range(3):
        text = _chat(parts, system, temperature)
        try:
            return _answer(text, parser, check)
        except ValueError:
            if attempt == 2:
                raise


import utils.gemini_utils as gemini_utils  # noqa: E402
import utils.openai_utils as openai_utils  # noqa: E402
import utils.pdf_utils as pdf_utils  # noqa: E402


def call_gemini_with_contents(contents, model_name=None, max_retries=5, base_interval_sec=5,
                              result_parsing_func=gemini_utils.parse_gemini_json_results,
                              generation_configs=None, check_parsed_response_not_none=True):
    configs = dict(generation_configs or {})
    # `tools` (Google Search grounding) and Gemini-only knobs have no ChatMock meaning.
    return _call(_parts(contents), result_parsing_func, check_parsed_response_not_none,
                 system=configs.get("system_instruction"), temperature=configs.get("temperature"))


def call_gemini_with_text_prompt(prompt, model_name=None, result_parsing_func=gemini_utils.parse_gemini_json_results,
                                 generation_configs=None, check_parsed_response_not_none=True, **_):
    return call_gemini_with_contents([prompt], model_name, result_parsing_func=result_parsing_func,
                                     generation_configs=generation_configs,
                                     check_parsed_response_not_none=check_parsed_response_not_none)


def call_gemini_with_images(prompt, images, model_name=None, result_parsing_func=gemini_utils.parse_gemini_json_results,
                            generation_configs=None, check_parsed_response_not_none=True, **_):
    contents = [prompt]
    for path in images:
        with open(path, "rb") as handle:
            contents.append(types.Part.from_bytes(data=handle.read(), mime_type="image/png"))
    return call_gemini_with_contents(contents, model_name, result_parsing_func=result_parsing_func,
                                     generation_configs=generation_configs,
                                     check_parsed_response_not_none=check_parsed_response_not_none)


def call_openai_models_with_content(content, model_name=None, max_retries=5, base_interval_sec=5,
                                    result_parsing_func=openai_utils.parse_openai_json_results,
                                    generation_configs=None, check_parsed_response_not_none=True, system_prompt=None):
    return _call(content, result_parsing_func, check_parsed_response_not_none, system=system_prompt)


def call_openai_models_with_text_prompt(prompt, model_name=None, max_retries=5, base_interval_sec=5,
                                        result_parsing_func=openai_utils.parse_openai_json_results,
                                        generation_configs=None, check_parsed_response_not_none=True,
                                        system_prompt=None):
    return _call([{"type": "text", "text": prompt}], result_parsing_func,
                 check_parsed_response_not_none, system=system_prompt)


_DATA_URL = re.compile(r"data:image/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)", re.I)


def generate_image_with_gemini(model_name=None, prompt="", aspect_ratio="16:9", generation_configs=None,
                               max_retries=5, base_interval_sec=5, save_path=None):
    """Diagrams are drawn by an image model ChatMock advertises (as ViMax does)."""
    if not IMAGE_MODEL:
        print("No image-capable model is available; skipping this diagram.")
        return None
    system = (generation_configs or {}).get("system_instruction")
    text = f"{system}\n\n{prompt}\nAspect ratio: {aspect_ratio}." if system else f"{prompt}\nAspect ratio: {aspect_ratio}."
    try:
        response = CLIENT.chat.completions.create(
            model=IMAGE_MODEL, messages=[{"role": "user", "content": text}])
        match = _DATA_URL.search(response.model_dump_json())
    except Exception as error:  # noqa: BLE001
        print(f"Diagram drawing failed: {error}")
        return None
    if not match:
        print("The image model answered without an image.")
        return None
    encoded = match.group(1)
    if save_path:
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        with open(save_path, "wb") as handle:
            handle.write(base64.b64decode(encoded))
    return encoded


def compile_latex(cwd, pdf_file, texfile_name="template", timeout=30):
    source_pdf = os.path.join(cwd, f"{texfile_name}.pdf")
    if os.path.exists(source_pdf):
        os.remove(source_pdf)
    try:
        # Tectonic runs BibTeX and the reruns itself; the first use downloads packages.
        result = subprocess.run(
            [JOB["tectonic"], "-X", "compile", f"{texfile_name}.tex", "--keep-logs"],
            cwd=cwd, capture_output=True, text=True, timeout=max(timeout, 900),
            encoding="utf-8", errors="replace")
        if result.returncode != 0:
            print(f"Tectonic failed for {texfile_name}.tex:\n{result.stderr[-4000:]}")
    except subprocess.TimeoutExpired:
        print(f"Tectonic timed out compiling {texfile_name}.tex")
    if os.path.exists(source_pdf):
        shutil.move(source_pdf, pdf_file)


gemini_utils.call_gemini_with_contents = call_gemini_with_contents
gemini_utils.call_gemini_with_text_prompt = call_gemini_with_text_prompt
gemini_utils.call_gemini_with_images = call_gemini_with_images
gemini_utils.generate_image_with_gemini = generate_image_with_gemini
openai_utils.call_openai_models_with_content = call_openai_models_with_content
openai_utils.call_openai_models_with_text_prompt = call_openai_models_with_text_prompt
pdf_utils.compile_latex = compile_latex

# Only now may modules that import those names be loaded.
from methods.agents.content_refinement_agent import ContentRefinementAgent  # noqa: E402
from methods.agents.literature_review_agent import HybridLiteratureAgent  # noqa: E402
from methods.agents.outline_agent import OutlineAgent  # noqa: E402
from methods.agents.plotting_agent import PlottingAgent  # noqa: E402
from methods.agents.section_writing_agent import SectionWritingAgent  # noqa: E402

STAGES = [
    (OutlineAgent, "outline", "Outlining the paper"),
    (HybridLiteratureAgent, "literature", "Finding and verifying related work"),
    (PlottingAgent, "plotting", "Drawing figures"),
    (SectionWritingAgent, "writing", "Writing the sections"),
    (ContentRefinementAgent, "refinement", "Reviewing, revising and compiling"),
]


def _staged(cls, stage, label):
    original = cls.run

    def run(self, *args, **kwargs):
        emit("stage", stage=stage, label=label, status="started")
        started = time.time()
        try:
            result = original(self, *args, **kwargs)
        except Exception as error:
            emit("stage", stage=stage, label=label, status="failed", error=str(error)[:500],
                 seconds=round(time.time() - started))
            raise
        emit("stage", stage=stage, label=label, status="completed", seconds=round(time.time() - started))
        return result

    cls.run = run


for _cls, _stage, _label in STAGES:
    _staged(_cls, _stage, _label)


# --- Literature discovery through Breadboard's catalog search -----------------

_REPLIES = {}
_WAITING = {}
_NEXT_ID = iter(range(1, 1_000_000))


def _read_replies():
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except ValueError:
            continue
        waiter = _WAITING.get(message.get("id"))
        if waiter:
            _REPLIES[message["id"]] = message
            waiter.set()
    for waiter in list(_WAITING.values()):  # stdin closed: nobody will answer
        waiter.set()


def search_catalogs(queries, year_to, limit):
    with _EMIT_LOCK:
        request_id = next(_NEXT_ID)
    waiter = threading.Event()
    _WAITING[request_id] = waiter
    emit("search", id=request_id, queries=queries, yearTo=year_to, limit=limit)
    waiter.wait(300)
    _WAITING.pop(request_id, None)
    return (_REPLIES.pop(request_id, None) or {}).get("documents") or []


_HITS = {}  # normalized title -> catalog record, for _enrich_and_register_paper


def _json_answer(prompt):
    return _call([{"type": "text", "text": prompt}], gemini_utils.parse_gemini_json_results, True)["parsed_response"]


def _discover_candidates(self, task, outline, cutoff_date):
    targeted = task.get("search_type") == "targeted"
    problem = outline.get("intro_related_work_plan", {}).get("introduction_strategy", {}).get(
        "problem_gap_hypothesis", "N/A")
    if targeted:
        queries = [task["focus"]]
    else:
        planned = _json_answer(
            "Write 3 short scholarly-catalog search queries (keywords, not sentences) that find the "
            f"published papers for this literature-review task.\nTASK: {task['focus']}\nCONTEXT: {task['context']}\n"
            f"PROJECT PROBLEM: {problem}\nReturn JSON: {{\"queries\": [\"...\", \"...\", \"...\"]}}")
        queries = [q for q in (planned or {}).get("queries", []) if isinstance(q, str) and q.strip()][:4]
        queries = queries or [task["focus"]]
    cutoff_year = int(str(cutoff_date)[:4]) if cutoff_date else None
    found, seen = [], set()
    for doc in search_catalogs(queries, cutoff_year, 8 if targeted else 15):
        key = self._normalize_title(doc.get("title") or "")
        if key and key not in seen and doc.get("abstract") and doc.get("year"):
            seen.add(key)
            found.append(doc)
    if not found:
        return []
    listing = "\n".join(
        f"[{i}] {d['title']} ({d['year']}; {d.get('venue') or 'n/a'}; cited {d.get('citationCount') or 0})\n"
        f"    {(d.get('abstract') or '')[:400]}" for i, d in enumerate(found[:40]))
    rule = ("Pick the ONE paper that is exactly the work the hint describes (for a dataset, model or baseline: "
            "the paper that introduced it), or none if it is absent." if targeted else
            "Pick every paper that is strictly relevant (at most 15). Prefer influential, peer-reviewed or "
            "highly cited work. Do not pick papers that merely share words with the task.")
    picked = _json_answer(
        f"These are real search results for a literature review.\nTASK: {task['focus']}\nCONTEXT: {task['context']}\n"
        f"{rule}\n\n{listing}\n\nReturn JSON: {{\"selected\": [{{\"index\": 0, \"reason\": \"why it is relevant\"}}]}}")
    candidates = []
    for choice in (picked or {}).get("selected", [])[: 1 if targeted else 15]:
        index = choice.get("index") if isinstance(choice, dict) else None
        if isinstance(index, int) and 0 <= index < len(found):
            doc = found[index]
            _HITS[self._normalize_title(doc["title"])] = doc
            candidates.append({"title": doc["title"], "year": doc["year"], "reason": choice.get("reason") or ""})
    return candidates


_upstream_enrich = HybridLiteratureAgent._enrich_and_register_paper


def _enrich_and_register_paper(self, cand, task, registry, cutoff_date):
    title = cand.get("title") if isinstance(cand, dict) else getattr(cand, "title", None)
    doc = _HITS.get(self._normalize_title(title or ""))
    if doc is None:  # not from the catalogs: upstream's Semantic Scholar check decides
        return _upstream_enrich(self, cand, task, registry, cutoff_date)
    from methods.agents.literature_review_agent import PaperData  # noqa: PLC0415

    abstract = doc["abstract"] if len(doc["abstract"]) <= 1500 else doc["abstract"][:1500] + "... [Truncated]"
    paper = PaperData(
        citation_key=self._generate_key(doc.get("authors") or [], doc["year"], doc["title"]),
        title=doc["title"],
        authors=doc.get("authors") or [],
        venue=doc.get("venue") or "arXiv",
        year=int(doc["year"]),
        abstract=abstract,
        citation_count=doc.get("citationCount") or 0,
        found_in_section=task["section"],
        reason=(cand.get("reason") if isinstance(cand, dict) else getattr(cand, "reason", "")) or "",
    )
    key = self._normalize_title(paper.title)
    with self.registry_lock:
        if key not in registry:
            registry[key] = paper
            self._safe_print(f"      -> Added catalog paper: {paper.title}")


HybridLiteratureAgent._discover_candidates = _discover_candidates
HybridLiteratureAgent._enrich_and_register_paper = _enrich_and_register_paper


def main():
    base_dir = JOB["outputDir"]
    threading.Thread(target=_read_replies, daemon=True).start()
    emit("started", model=MODEL, imageModel=IMAGE_MODEL, plotting=JOB["plotting"])
    if JOB["plotting"]:
        from methods.paper_writer_with_plotting import write_single_paper  # noqa: PLC0415

        extra = {"plotting_model_name": MODEL, "image_model_name": IMAGE_MODEL or MODEL}
    else:
        from methods.paper_writer import write_single_paper  # noqa: PLC0415

        extra = {}
    ok = write_single_paper(
        base_dir=base_dir,
        latex_template_dir=JOB["templateDir"],
        idea_filename="idea.md",
        experimental_log_filename="experimental_log.md",
        writer_model_name=MODEL,
        reflection_model_name=MODEL,
        research_cutoff=JOB["cutoff"],
        **extra,
    )
    pdf = os.path.join(base_dir, "final_paper.pdf")
    if not ok or not os.path.exists(pdf):
        emit("failed", error="PaperOrchestra could not produce a compiled paper.")
        return 1
    emit("completed", pdf=pdf, latexDir=os.path.join(base_dir, "content_refinement_workdir"))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # noqa: BLE001
        emit("failed", error=str(error)[:1000], detail=traceback.format_exc()[-4000:])
        sys.exit(1)
