#!/usr/bin/env python3
"""Install Spec Codex custom-agent definitions safely."""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path


AGENT_FILES = ("specship-scout.toml", "specship-validator.toml")
SOURCE_DIR = Path(__file__).resolve().parents[1] / "assets" / "agents"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Install the custom agents required by $spec-codex."
    )
    parser.add_argument("--scope", choices=("project", "user"), required=True)
    parser.add_argument(
        "--project-root",
        default=".",
        help="Project root for --scope project (default: current directory).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace differing existing Spec Codex agent definitions.",
    )
    return parser.parse_args()


def destination(args: argparse.Namespace) -> Path:
    if args.scope == "project":
        return Path(args.project_root).expanduser().resolve() / ".codex" / "agents"
    codex_root = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    return codex_root.expanduser().resolve() / "agents"


def install_file(source: Path, target: Path, *, force: bool) -> str:
    payload = source.read_bytes()
    if target.exists():
        if target.read_bytes() == payload:
            return f"unchanged: {target}"
        if not force:
            raise RuntimeError(f"refusing to overwrite different file: {target}")

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
            handle.write(payload)
            temporary_name = handle.name
        Path(temporary_name).replace(target)
    finally:
        if temporary_name:
            temporary = Path(temporary_name)
            if temporary.exists():
                temporary.unlink()
    return f"installed: {target}"


def main() -> int:
    args = parse_args()
    target_dir = destination(args)
    try:
        messages = [
            install_file(SOURCE_DIR / name, target_dir / name, force=args.force)
            for name in AGENT_FILES
        ]
    except (OSError, RuntimeError) as error:
        print(f"spec-codex agent install failed: {error}", file=sys.stderr)
        return 1

    print("\n".join(messages))
    print("Start a new Codex task so the custom agents are loaded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
