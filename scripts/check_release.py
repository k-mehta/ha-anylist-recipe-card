"""Validate a release tag and stage the card file as the release asset.

Usage: python scripts/check_release.py <tag> <output_dir>

Checks, in order:
  - the tag looks like vX.Y.Z;
  - CHANGELOG.md has a heading for that version with non-empty notes
    (a tag with no changelog entry is refused);
  - hacs.json names this card file as its filename;
  - the card file exists and passes node --check.

On success the card file is copied to <output_dir> and its path is
printed. The release workflow uploads that file as the release asset.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAG_PATTERN = re.compile(r"v\d+\.\d+\.\d+")
CARD_FILE = "anylist-recipe-view-card.js"


def fail(message: str) -> None:
    raise SystemExit(f"check_release: {message}")


def changelog_notes(version: str) -> str:
    lines = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8").splitlines()
    heading = re.compile(rf"^## \[{re.escape(version)}\]")
    start = None
    for index, line in enumerate(lines):
        if heading.match(line):
            start = index + 1
            break
    if start is None:
        fail(f"CHANGELOG.md has no heading for {version}")
    end = len(lines)
    for index in range(start, len(lines)):
        if lines[index].startswith("## "):
            end = index
            break
    notes = "\n".join(lines[start:end]).strip()
    if not notes:
        fail(f"CHANGELOG.md has no notes for {version}")
    return notes


def main(argv: list[str]) -> str:
    if len(argv) != 3:
        fail("usage: check_release.py <tag> <output_dir>")
    tag, output_dir = argv[1], Path(argv[2])
    if TAG_PATTERN.fullmatch(tag) is None:
        fail(f"expected a vX.Y.Z tag, got {tag!r}")
    version = tag[1:]

    changelog_notes(version)

    hacs = json.loads((ROOT / "hacs.json").read_text(encoding="utf-8"))
    if hacs.get("filename") != CARD_FILE:
        fail(f"hacs.json filename must be {CARD_FILE!r}")

    card = ROOT / CARD_FILE
    if not card.is_file():
        fail(f"{CARD_FILE} is missing")
    subprocess.run(["node", "--check", str(card)], check=True)

    output_dir.mkdir(parents=True, exist_ok=True)
    staged = output_dir / CARD_FILE
    shutil.copyfile(card, staged)
    digest = hashlib.sha256(card.read_bytes()).hexdigest()
    if hashlib.sha256(staged.read_bytes()).hexdigest() != digest:
        fail("staged copy does not match the card file")
    return str(staged)


if __name__ == "__main__":
    print(main(sys.argv))
