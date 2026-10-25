"""Validate the frozen dataset against the pinned official evaluator, without running tests."""
import importlib.metadata
import json
import sys

from swebench.harness.utils import make_test_spec

version = importlib.metadata.version("swebench")
if version != sys.argv[2]:
    raise RuntimeError(f"Expected swebench=={sys.argv[2]}, found {version}")
with open(sys.argv[1], encoding="utf-8") as source:
    cases = json.load(source)["cases"]
for case in cases:
    make_test_spec(case)
print(f"swebench {version}; {len(cases)} frozen cases have valid evaluator specifications")
