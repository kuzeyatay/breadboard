import importlib.util
import unittest

from breadboard_detect_ai.detectors.text import (
    binoculars_ratio,
    sampling_discrepancy_analytic,
)


@unittest.skipUnless(importlib.util.find_spec("torch"), "torch is not installed")
class AlgorithmFixtureTests(unittest.TestCase):
    def test_fast_detect_matches_literal_reference_equations(self):
        import torch

        torch.manual_seed(7)
        score_logits = torch.randn(1, 5, 11)
        reference_logits = torch.randn(1, 5, 11)
        labels = torch.tensor([[3, 5, 2, 7]])
        actual = sampling_discrepancy_analytic(score_logits, reference_logits, labels)

        score = torch.log_softmax(score_logits[:, :-1], dim=-1)
        reference = torch.softmax(reference_logits[:, :-1], dim=-1)
        observed = score.gather(-1, labels.unsqueeze(-1)).squeeze(-1)
        mean = (reference * score).sum(-1)
        variance = (reference * score.square()).sum(-1) - mean.square()
        expected = ((observed.sum(-1) - mean.sum(-1)) / variance.sum(-1).sqrt()).item()
        self.assertAlmostEqual(actual, expected, places=6)

    def test_binoculars_matches_literal_reference_equations(self):
        import torch

        torch.manual_seed(9)
        observer = torch.randn(1, 6, 13)
        performer = torch.randn(1, 6, 13)
        ids = torch.tensor([[2, 3, 4, 5, 6, 0]])
        mask = torch.tensor([[1, 1, 1, 1, 1, 0]])
        actual = binoculars_ratio(observer, performer, ids, mask, 0)

        ce = torch.nn.CrossEntropyLoss(reduction="none")
        ppl = (ce(performer[..., :-1, :].transpose(1, 2), ids[..., 1:]) * mask[..., 1:]).sum(1) / mask[..., 1:].sum(1)
        observer_probs = torch.softmax(observer, dim=-1).view(-1, 13)
        cross = ce(performer.view(-1, 13), observer_probs).view(1, -1)
        padding = (ids != 0).to(torch.uint8)
        x_ppl = (cross * padding).sum(1) / padding.sum(1)
        self.assertAlmostEqual(actual, float((ppl / x_ppl).item()), places=6)


if __name__ == "__main__":
    unittest.main()
