import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

from .validation import verify_contract_bundle


FILES = (
    "src/umiem_mcp/__init__.py",
    "src/umiem_mcp/validation.py",
    "src/umiem_mcp/learning-overview.schema.json",
    "src/umiem_mcp/contract-manifest.json",
    "skills/umiem-learning/SKILL.md",
)


def make_consumer_release(output_dir: Path, *, source_root: Path | None = None, allow_dirty: bool = False) -> Path:
    root = (source_root or Path(__file__).parents[2]).resolve()
    if not verify_contract_bundle(root):
        raise ValueError("The consumer contract or skill does not match its manifest")

    repository = Path(subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--show-toplevel"],
        check=True, capture_output=True, text=True,
    ).stdout.strip())
    relative_inputs = [str((root / name).relative_to(repository)).replace("\\", "/") for name in FILES]
    dirty = subprocess.run(
        ["git", "-C", str(repository), "status", "--porcelain", "--", *relative_inputs],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    if dirty and not allow_dirty:
        raise ValueError("Consumer release inputs must be committed and clean")

    source_commit = subprocess.run(
        ["git", "-C", str(repository), "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    contract_manifest = json.loads((root / FILES[3]).read_text(encoding="utf-8"))
    hashes = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in FILES}
    release_manifest = {
        "package": "umiem-consumer",
        "version": "0.2.0",
        "sourceCommit": source_commit,
        "contractCommit": contract_manifest["contractCommit"],
        "schemaVersion": 1,
        "files": hashes,
    }

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / f"umiem-consumer-{source_commit[:12]}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as release:
        for name in FILES:
            source = root / name
            if source.is_symlink():
                raise ValueError("Consumer release inputs may not contain symlinks")
            release.write(source, arcname=f"umiem-consumer/{name}")
        release.writestr("umiem-consumer/RELEASE-MANIFEST.json", json.dumps(release_manifest, indent=2) + "\n")
    return archive


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a private Umiem! contract and skill consumer bundle")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    print(make_consumer_release(args.output_dir))


if __name__ == "__main__":
    main()
