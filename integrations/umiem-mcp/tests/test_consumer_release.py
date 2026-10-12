import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from umiem_mcp.package_consumer import FILES, make_consumer_release

ROOT = Path(__file__).parents[1]
EXPECTED = {
    "src/umiem_mcp/__init__.py",
    "src/umiem_mcp/validation.py",
    "src/umiem_mcp/learning-overview.schema.json",
    "src/umiem_mcp/contract-manifest.json",
    "skills/umiem-learning/SKILL.md",
    "RELEASE-MANIFEST.json",
}


class ConsumerReleaseTests(unittest.TestCase):
    def test_archives_only_contract_validator_and_skill_with_hashes_and_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = make_consumer_release(Path(temp), source_root=ROOT, allow_dirty=True)
            with zipfile.ZipFile(archive) as release:
                expected_members = {f"umiem-consumer/{path}" for path in EXPECTED}
                self.assertEqual(set(release.namelist()), expected_members)
                manifest = json.loads(release.read("umiem-consumer/RELEASE-MANIFEST.json"))
                self.assertEqual(manifest["package"], "umiem-consumer")
                self.assertEqual(manifest["version"], "0.2.0")
                self.assertEqual(manifest["schemaVersion"], 1)
                self.assertRegex(manifest["sourceCommit"], r"^[0-9a-f]{40}$")
                self.assertEqual(set(manifest["files"]), EXPECTED - {"RELEASE-MANIFEST.json"})
                for path, digest in manifest["files"].items():
                    self.assertEqual(hashlib.sha256(release.read(f"umiem-consumer/{path}")).hexdigest(), digest)

                extracted = Path(temp) / "unpacked"
                release.extractall(extracted)
            consumer_root = extracted / "umiem-consumer"
            code = "from pathlib import Path; from umiem_mcp.validation import verify_contract_bundle; assert verify_contract_bundle(Path.cwd())"
            subprocess.run([sys.executable, "-c", code], cwd=consumer_root, env={"PYTHONPATH": str(consumer_root / "src")}, check=True)

    def test_refuses_contract_drift_and_dirty_release_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            dirty_repo = Path(temp) / "dirty-repo"
            for relative in FILES:
                source = ROOT / relative
                target = dirty_repo / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
            subprocess.run(["git", "init", str(dirty_repo)], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(dirty_repo), "config", "user.email", "test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(dirty_repo), "config", "user.name", "Test"], check=True)
            subprocess.run(["git", "-C", str(dirty_repo), "add", "."], check=True)
            subprocess.run(["git", "-C", str(dirty_repo), "commit", "-m", "test source"], check=True, capture_output=True)
            with (dirty_repo / "src/umiem_mcp/validation.py").open("ab") as handle:
                handle.write(b"\n# dirty input\n")
            with self.assertRaisesRegex(ValueError, "committed and clean"):
                make_consumer_release(Path(temp) / "dirty", source_root=dirty_repo)
            root = Path(temp) / "copy"
            for source, relative in ((ROOT / "src/umiem_mcp/learning-overview.schema.json", "src/umiem_mcp/learning-overview.schema.json"),
                                     (ROOT / "src/umiem_mcp/contract-manifest.json", "src/umiem_mcp/contract-manifest.json"),
                                     (ROOT / "skills/umiem-learning/SKILL.md", "skills/umiem-learning/SKILL.md")):
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
            (root / "src/umiem_mcp/learning-overview.schema.json").write_text("{}", encoding="utf-8")
            with self.assertRaises(ValueError):
                make_consumer_release(Path(temp) / "out", source_root=root, allow_dirty=True)


if __name__ == "__main__":
    unittest.main()
