import hashlib
import json
from datetime import date, datetime, timezone
from importlib.resources import files
from zoneinfo import ZoneInfo

from jsonschema import Draft202012Validator


MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class ContractError(ValueError):
    def __init__(self, message: str, code: str = "learning_summary_unavailable"):
        super().__init__(message)
        self.code = code


def verify_contract_bundle(root) -> bool:
    root = root if hasattr(root, "joinpath") else __import__("pathlib").Path(root)
    path = root / "src/umiem_mcp/learning-overview.schema.json"
    manifest_path = root / "src/umiem_mcp/contract-manifest.json"
    skill_path = root / "skills/umiem-learning/SKILL.md"
    try:
        schema_bytes = path.read_bytes()
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        skill_bytes = skill_path.read_bytes()
    except (OSError, json.JSONDecodeError):
        return False
    return manifest.get("schemaVersion") == 1 and \
        manifest.get("schemaSha256") == hashlib.sha256(schema_bytes).hexdigest() and \
        manifest.get("skillSha256") == hashlib.sha256(skill_bytes).hexdigest()


def _load_schema() -> dict:
    package_file = __import__("pathlib").Path(str(files("umiem_mcp")))
    root = package_file.parents[1]
    path = package_file / "learning-overview.schema.json"
    if not verify_contract_bundle(root):
        raise ContractError("The packaged learning contract does not match its manifest")
    try:
        schema_bytes = path.read_bytes()
    except OSError as error:
        raise ContractError("The packaged learning contract is unavailable") from error
    return json.loads(schema_bytes)


def _day_range(period: dict) -> list[str]:
    start = date.fromisoformat(period["from"])
    end = date.fromisoformat(period["to"])
    if (end - start).days + 1 != period["days"]:
        raise ValueError("Period dates do not match the declared number of days")
    return [date.fromordinal(start.toordinal() + offset).isoformat() for offset in range(period["days"])]


def validate_overview(data: object, *, raw_size: int | None = None) -> dict:
    if raw_size is not None and raw_size > MAX_RESPONSE_BYTES:
        raise ContractError("The learning summary exceeds the response size limit", "learning_summary_too_large")
    if not isinstance(data, dict):
        raise ContractError("The learning summary is not a JSON object")
    schema = _load_schema()
    errors = list(Draft202012Validator(schema).iter_errors(data))
    if errors:
        raise ContractError("The learning summary does not match the supported contract")
    try:
        if data["schemaVersion"] != 1:
            raise ValueError("Unsupported schema version")
        period_dates = _day_range(data["period"])
        planned_dates = _day_range(data["plannedTestsPeriod"])
        ZoneInfo(data["timezone"])
        if datetime.fromisoformat(data["generatedAt"].replace("Z", "+00:00")).astimezone(ZoneInfo(data["timezone"])).date().isoformat() != data["period"]["to"]:
            raise ValueError("Report end does not match the local snapshot date")
        child_ids = set()
        for child in data["children"]:
            if child["childId"] in child_ids:
                raise ValueError("Child identifiers are duplicated")
            child_ids.add(child["childId"])
            days = child["dailyActivity"]
            if [item["date"] for item in days] != period_dates:
                raise ValueError("A report day is missing or out of order")
            for index, item in enumerate(days):
                if item["isPartialDay"] != (index == len(days) - 1):
                    raise ValueError("Only today's activity may be partial")
                seconds = item["learningTime"]["seconds"]
                if not item["hasRecordedActivity"] and seconds != 0:
                    raise ValueError("No activity must be represented with zero seconds")
                decks = item["decks"]
                if len({deck["deckId"] for deck in decks}) != len(decks):
                    raise ValueError("Activity decks are duplicated")
                for deck in decks:
                    skills = deck["assessmentCounts"]
                    if len({entry["skill"] for entry in skills}) != len(skills):
                        raise ValueError("Activity skills are duplicated")
                for test in item["mockTests"]:
                    skills = test["skills"]
                    if len({entry["skill"] for entry in skills}) != len(skills):
                        raise ValueError("Mock test skills are duplicated")
                    for skill in skills:
                        count = sum(skill[key] for key in ("independentCorrect", "practiceNeeded", "correctNotIndependent", "notTested", "skipped", "unassessed"))
                        if count != skill["totalItems"]:
                            raise ValueError("Mock test totals do not match the skill denominator")
            values = [item["learningTime"]["seconds"] for item in days]
            total = None if any(value is None for value in values) else sum(values)
            if child["learningTime"]["seconds"] != total:
                raise ValueError("Period time does not match daily time")
            for deck in child["currentProgress"]:
                skills = deck["skills"]
                if len(skills) != 5 or len({entry["skill"] for entry in skills}) != len(skills) or any(sum(skill[key] for key in ("mastered", "needsConfirmation", "needsReconfirmation", "practicing", "notAssessed")) != deck["totalItems"] for skill in skills):
                    raise ValueError("Progress totals do not match the deck denominator")
            planned_ids = [planned["assignmentId"] for planned in child["plannedTests"]]
            if len(set(planned_ids)) != len(planned_ids):
                raise ValueError("Planned test assignments are duplicated")
            for planned in child["plannedTests"]:
                if planned["date"] not in planned_dates or planned["daysUntil"] != (date.fromisoformat(planned["date"]) - date.fromisoformat(data["plannedTestsPeriod"]["from"])).days:
                    raise ValueError("Planned test date is inconsistent with its period")
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        raise ContractError("The learning summary contains inconsistent dates or totals") from error
    return data
