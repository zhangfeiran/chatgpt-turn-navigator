#!/usr/bin/env python3
"""Deterministic, dependency-free userscript builder (Python 3.9+).
The five core factories encapsulate their own state. Compatibility/UI modules
share a single lexical facade; nothing is loaded remotely at runtime.
"""
from pathlib import Path
import json
import sys


def main() -> None:
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / "build-manifest.json").read_text(encoding="utf-8"))
    modules = manifest["modules"]
    chunks = [(root / manifest["prefix"]).read_text(encoding="utf-8")]
    for path in modules:
        full = (root / path).resolve()
        if root not in full.parents:
            raise ValueError("Module escapes source root")
        chunks.append("\n  // ===== " + path + " =====\n")
        chunks.append(full.read_text(encoding="utf-8"))
    chunks.append((root / manifest["suffix"]).read_text(encoding="utf-8"))
    text = "".join(chunks)
    version = manifest["version"]
    if "@version      " + version not in text:
        raise ValueError("Manifest and userscript version differ")
    path = root / "chatgpt-turn-navigator.user.js"
    path.write_text(text, encoding="utf-8")
    print(path.name + " (" + str(path.stat().st_size) + " bytes)")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print("Build failed: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
