"""Execute the real grounding ledger against scope exclusions and tool boundaries."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(os.environ.get("BREADBOARD_TEST_REPO", Path(__file__).resolve().parents[2]))
SOURCE = Path(os.environ.get("BREADBOARD_TEST_CANDIDATE", ROOT))
FILE = SOURCE / "vibe-trading/agent/src/agent/grounding.py"
spec = importlib.util.spec_from_file_location("owned_grounding_scope", FILE)
grounding = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = grounding
spec.loader.exec_module(grounding)
PROMPT = ("Use the strategy specialist to calculate the compounded total return of this fictional price series100,110,99. "
          "Explain why adding the daily percentages gives a different result. Use only these inline numbers; "
          "no real market lookup, recommendation, trade, accounts, files, installation or settings change.")


class ScopeGroundingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="owned-vibe-grounding-")
        self.addCleanup(self.temp.cleanup)

    def ledger(self, message):
        return grounding.GroundingLedger(run_dir=Path(self.temp.name), user_message=message)

    def test_exact_native_workflow_prompt_accepts_calculated_returns(self):
        ledger = self.ledger(PROMPT)
        for index, (expression, value) in enumerate([("(99/100-1)*100", -1), ("(110/100-1)*100", 10), ("(99/110-1)*100", -10)]):
            ledger.ingest_tool_result(tool_name="financial_rigor", arguments={"command":"calc", "expr":expression},
                                      result=json.dumps({"status":"ok", "result":value}), call_id=str(index), success=True)
        self.assertEqual(ledger.identity_status, "not_required")
        result = ledger.validate_final_answer("The derived compounded return is (99/100-1)*100 = -1%. The daily returns are 10% and -10%; adding them gives 0% because their bases differ.")
        self.assertTrue(result.valid, result.issues)

    def test_explicit_negative_noun_lists_do_not_require_market_identity(self):
        for message in ["Calculate the supplied returns; no trade.", "Use these numbers without market lookup or trade.",
                        "No external market research, recommendations, or trade. Calculate the total.",
                        "No accounts, trade, files or settings changes."]:
            with self.subTest(message=message):
                self.assertEqual(self.ledger(message).identity_status, "not_required")

    def test_positive_requests_still_require_identity(self):
        for message in ["Trade ACME.", "Buy ACME.", "Sell ACME.", "What is the current price of ACME?",
                        "No lookup, buy ACME.", "No trade. What is the target price of ACME?",
                        "Without trade, but sell ACME.", "No files or settings changes; trade ACME.",
                        "This is fictional. Buy ACME.", "Trade ACME; no external market lookup."]:
            with self.subTest(message=message):
                ledger = self.ledger(message)
                self.assertEqual(ledger.identity_status, "unresolved")
                self.assertFalse(ledger.validate_final_answer("Buy it.").valid)

    def test_symbol_consumer_reactivates_identity_requirement(self):
        ledger = self.ledger(PROMPT)
        authorization = ledger.authorize_tool_call(tool_name="get_market_data", arguments={"symbol":"ACME.US"},
                                                   call_id="owned-consumer", batch_authorized_symbols=set(), batch_identity_status="not_required")
        self.assertFalse(authorization.allowed)
        self.assertEqual(ledger.identity_status, "unresolved")
        self.assertFalse(ledger.validate_final_answer("The return is -1%.").valid)

    def test_resolver_reactivates_identity_requirement(self):
        ledger = self.ledger(PROMPT)
        authorization = ledger.authorize_tool_call(tool_name="search_symbol", arguments={"query":"ACME"},
                                                   call_id="owned-resolver", batch_authorized_symbols=set(), batch_identity_status="not_required")
        self.assertTrue(authorization.allowed)
        self.assertEqual(ledger.identity_status, "unresolved")
        self.assertFalse(ledger.validate_final_answer("Buy ACME.").valid)


if __name__ == "__main__":
    unittest.main()
