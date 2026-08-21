"""A model that answers like the real one without owning a card.

Every automated test in this suite runs against this. Loading 1.6 GB of weights
to prove that a paragraph boundary survives reassembly would test PyTorch, not
this service, and would make the suite unrunnable on any machine that has not
done the opt-in download. The real checkpoint is exercised by the smoke test in
docs/HUMANIZER_INTEGRATION.md, behind an explicit environment flag.

The word-count tokenizer is deliberately crude and deliberately *not* the BART
one: chunking must be correct for whatever counter it is handed, and a test that
depended on real BPE boundaries would be testing the tokenizer.
"""

from __future__ import annotations

from typing import Callable


def word_tokens(text: str) -> int:
    """A stand-in tokenizer. Roughly BPE-shaped: words plus punctuation."""
    return len(text.split()) + text.count(",") + text.count(".")


class FakeHumanizer:
    """Rewrites by rule, so every assertion is about the pipeline."""

    def __init__(
        self,
        transform: Callable[[str], str] | None = None,
        *,
        model_id: str = "cive202/humanize-ai-text-bart-large",
        model_revision: str = "main",
        device: str = "cpu",
        dtype: str = "float32",
        installed: bool = True,
        counter: Callable[[str], int] = word_tokens,
    ) -> None:
        self.model_id = model_id
        self.model_revision = model_revision
        self._device = device
        self._dtype = dtype
        self._installed = installed
        self._counter = counter
        self._loaded = False
        self._transform = transform or default_transform
        self.seen: list[str] = []
        self.cancel_checks = 0

    @property
    def loaded(self) -> bool:
        return self._loaded

    @property
    def device(self) -> str:
        return self._device

    @property
    def dtype(self) -> str:
        return self._dtype

    @property
    def load_error(self) -> str:
        return ""

    def installed(self) -> bool:
        return self._installed

    def probe(self) -> dict[str, str]:
        return {"torch": "2.6.0", "transformers": "4.44.2", "cuda": "12.4", "device": "cpu"}

    def count_tokens(self, text: str) -> int:
        self._loaded = True
        return self._counter(text)

    def rewrite(self, texts, should_cancel=None):
        self._loaded = True
        out = []
        for text in texts:
            if should_cancel is not None:
                self.cancel_checks += 1
                if should_cancel():
                    from breadboard_humanizer.model import ModelError

                    raise ModelError("cancelled")
            self.seen.append(text)
            out.append(self._transform(text))
        return out

    def unload(self) -> None:
        self._loaded = False


#: The house style of the fake: swap a few stock words so the output is
#: visibly different from the input while every literal and placeholder is
#: left exactly where it was.
_SWAPS = (
    ("groundbreaking and transformative", "useful"),
    ("rapidly evolving landscape", "world"),
    ("represents a", "is a"),
    ("Pivotal", "New"),
    ("delve into", "look at"),
    ("The measured improvement", "Things improved"),
    ("shipped on", "went out on"),
    ("before publishing", "first"),
    ("Read the", "See"),
)


def default_transform(text: str) -> str:
    out = text
    for before, after in _SWAPS:
        out = out.replace(before, after)
    return out
