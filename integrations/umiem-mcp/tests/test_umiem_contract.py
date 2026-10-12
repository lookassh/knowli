import json
import tempfile
import unittest
from pathlib import Path

from umiem_mcp.validation import ContractError, validate_overview, verify_contract_bundle

ROOT = Path(__file__).parent
class ContractTests(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads((ROOT / "fixtures/learning-overview.example.json").read_text(encoding="utf-8"))

    def test_accepts_versioned_fixture_and_preserves_estimated_seconds(self):
        result = validate_overview(self.payload)
        self.assertEqual(result["children"][0]["learningTime"], {"seconds": 1980, "estimated": True})
        self.assertEqual(result["children"][0]["dailyActivity"][2]["learningTime"]["seconds"], 1380)

    def test_accepts_distinct_versions_of_one_deck_in_the_same_day(self):
        candidate = json.loads(json.dumps(self.payload))
        decks = candidate["children"][0]["dailyActivity"][0]["decks"]
        deck = {"deckId": "22222222-2222-4222-8222-222222222222",
                "deckVersionId": "33333333-3333-4333-8333-333333333333",
                "deckTitle": "Dni tygodnia v2", "deckVersionNumber": 2,
                "assessmentCounts": [{"skill": "recall", "independentCorrect": 1,
                                      "correctNotIndependent": 0, "incorrect": 0, "unassessed": 0}]}
        prior = {**deck, "deckVersionId": "44444444-4444-4444-8444-444444444444",
                 "deckTitle": "Dni tygodnia v1", "deckVersionNumber": 1}
        decks.extend((prior, deck))
        self.assertEqual(validate_overview(candidate), candidate)

    def test_mock_test_skips_and_unassessed_are_subsets_of_not_tested(self):
        candidate = json.loads(json.dumps(self.payload))
        candidate["children"][0]["dailyActivity"][0]["mockTests"].append({
            "sessionId": "55555555-5555-4555-8555-555555555555",
            "deckId": "22222222-2222-4222-8222-222222222222",
            "deckVersionId": "33333333-3333-4333-8333-333333333333",
            "deckTitle": "Dni tygodnia", "deckVersionNumber": 2,
            "endedAt": "2026-10-09T17:00:00.000Z", "complete": True, "taskBudget": 4,
            "skills": [{"skill": "recall", "totalItems": 7, "independentCorrect": 2,
                        "practiceNeeded": 1, "correctNotIndependent": 0, "notTested": 4,
                        "skipped": 1, "unassessed": 1}],
        })
        skill = candidate["children"][0]["dailyActivity"][0]["mockTests"][0]["skills"][0]
        skill.update(totalItems=7, independentCorrect=2, practiceNeeded=1,
                     correctNotIndependent=0, notTested=4, skipped=1, unassessed=1)
        self.assertEqual(validate_overview(candidate), candidate)
        skill["skipped"] = 3
        skill["unassessed"] = 2
        with self.assertRaises(ContractError):
            validate_overview(candidate)

    def test_rejects_incompatible_or_semantically_inconsistent_data(self):
        mutations = []
        version = json.loads(json.dumps(self.payload)); version["schemaVersion"] = 2; mutations.append(version)
        missing_day = json.loads(json.dumps(self.payload)); missing_day["children"][0]["dailyActivity"].pop(1); mutations.append(missing_day)
        total = json.loads(json.dumps(self.payload)); total["children"][0]["learningTime"]["seconds"] = 1381; mutations.append(total)
        null_total = json.loads(json.dumps(self.payload)); null_total["children"][0]["dailyActivity"][1]["learningTime"]["seconds"] = None; mutations.append(null_total)
        duplicate = json.loads(json.dumps(self.payload)); duplicate["children"].append(duplicate["children"][0]); mutations.append(duplicate)
        fractional = json.loads(json.dumps(self.payload)); fractional["children"][0]["learningTime"]["seconds"] = 1.5; mutations.append(fractional)
        denominator = json.loads(json.dumps(self.payload)); denominator["children"][0]["currentProgress"][0]["skills"][2]["practicing"] = 3; mutations.append(denominator)
        days_until = json.loads(json.dumps(self.payload)); days_until["children"][0]["plannedTests"][0]["daysUntil"] = 5; mutations.append(days_until)
        mock_test = json.loads(json.dumps(self.payload))
        mock_test["children"][0]["dailyActivity"][0]["mockTests"].append({
            "sessionId": "55555555-5555-4555-8555-555555555555", "deckId": "22222222-2222-4222-8222-222222222222",
            "deckVersionId": "33333333-3333-4333-8333-333333333333", "deckTitle": "Dni tygodnia", "deckVersionNumber": 2,
            "endedAt": "2026-10-09T17:00:00.000Z", "complete": True, "taskBudget": 4,
            "skills": [{"skill": "recall", "totalItems": 7, "independentCorrect": 2, "practiceNeeded": 1,
                        "correctNotIndependent": 0, "notTested": 4, "skipped": 0, "unassessed": 0}],
        })
        mock_test["children"][0]["dailyActivity"][0]["mockTests"][0]["skills"][0]["notTested"] = 3
        mutations.append(mock_test)
        for candidate in mutations:
            with self.subTest(candidate=candidate), self.assertRaises(ContractError):
                validate_overview(candidate)

    def test_rejects_oversized_response(self):
        with self.assertRaises(ContractError) as caught:
            validate_overview(self.payload, raw_size=2 * 1024 * 1024 + 1)
        self.assertEqual(caught.exception.code, "learning_summary_too_large")

    def test_refuses_a_missing_or_changed_contract_artifact(self):
        self.assertTrue(verify_contract_bundle(ROOT.parent))
        api_schema = ROOT.parents[2] / "docs/integrations/learning-overview.schema.json"
        if api_schema.is_file():
            self.assertEqual((ROOT.parent / "src/umiem_mcp/learning-overview.schema.json").read_bytes(), api_schema.read_bytes())
        with tempfile.TemporaryDirectory() as temp:
            copied = Path(temp)
            (copied / "src/umiem_mcp").mkdir(parents=True)
            (copied / "skills/umiem-learning").mkdir(parents=True)
            for rel in ("src/umiem_mcp/learning-overview.schema.json", "src/umiem_mcp/contract-manifest.json", "skills/umiem-learning/SKILL.md"):
                source = ROOT.parent / rel
                if source.exists():
                    (copied / rel).write_bytes(source.read_bytes())
            (copied / "src/umiem_mcp/learning-overview.schema.json").write_text("{}", encoding="utf-8")
            self.assertFalse(verify_contract_bundle(copied))




