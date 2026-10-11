import argparse
import json
import subprocess
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EXCLUDED_PARTS = {".venv", "__pycache__", ".pytest_cache", "dist"}


def _is_private_file(path: Path) -> bool:
    name = path.name.lower()
    return name == ".env" or name.startswith(".env.") or name.endswith((".token", ".secret"))


def make_release(output_dir: Path) -> Path:
    metadata = {}
    for line in (ROOT / "pyproject.toml").read_text(encoding="utf-8").splitlines():
        if line.startswith("name = ") or line.startswith("version = "):
            key, value = line.split("=", 1)
            metadata[key.strip()] = value.strip().strip('"')
        if metadata.get("name") and metadata.get("version"):
            break
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / f"{metadata['name']}-{metadata['version']}.zip"
    manifest = {
        "package": metadata["name"],
        "version": metadata["version"],
        "sourceCommit": commit,
        "schemaVersion": 1,
        "contractCommit": json.loads((ROOT / "src/umiem_mcp/contract-manifest.json").read_text(encoding="utf-8-sig"))["contractCommit"],
    }
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(ROOT.rglob("*")):
            if not path.is_file() or _is_private_file(path) or any(part in EXCLUDED_PARTS for part in path.parts):
                continue
            relative = path.relative_to(ROOT)
            archive.write(path, Path("umiem-mcp") / relative)
        archive.writestr("umiem-mcp/RELEASE-MANIFEST.json", json.dumps(manifest, indent=2) + "\n")
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("dist"))
    arguments = parser.parse_args()
    print(make_release(arguments.output_dir.resolve()))
