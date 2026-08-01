#!/usr/bin/env python3
"""Validate and update Specship protocol 0.2 plan folders using only stdlib."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

PROTOCOL_VERSION = "0.2.0"
CONTRACT_FILES = ("CONTEXT.md", "SPEC.md", "PLAN.md")
READY_STATES = {
    "Ready",
    "InProgress",
    "Blocked",
    "Failed",
    "Implemented",
    "ChangesRequired",
    "ReadyForConfirmation",
    "Finalized",
}
TASK_STATES = {"Pending", "InProgress", "Done", "Blocked", "Failed", "Superseded"}
TASK_FIELDS = (
    "Requirements",
    "Objective",
    "Rationale",
    "Dependencies",
    "Files and symbols",
    "Implementation instructions",
    "Preserve",
    "Validation",
    "Acceptance criteria",
    "Evidence required",
    "Out of scope",
)
ATTEMPT_FIELDS = (
    "Contract revision",
    "Contract digest",
    "Outcome",
    "Files changed",
    "Implementation",
    "Validation",
    "Deviations",
    "Remaining risks",
    "Review notes",
)
SUMMARY_FIELDS = (
    "Contract revision",
    "Contract digest",
    "Outcome",
    "Tasks",
    "Files changed",
    "Plan-wide validation",
    "Deviations",
    "Remaining risks",
)
REVIEW_FIELDS = (
    "Contract revision",
    "Contract digest",
    "Implementation baseline",
    "Status",
    "Reviewed scope",
    "Findings",
    "Acceptance criteria",
    "Validation",
    "Remaining risks",
)
TRANSITIONS = {
    "spec": {
        ("Draft", "AwaitingClarification"),
        ("AwaitingClarification", "Ready"),
        ("Draft", "Ready"),
        ("Blocked", "AwaitingClarification"),
        ("Failed", "AwaitingClarification"),
        ("Implemented", "ChangesRequired"),
        ("Implemented", "Blocked"),
        ("Implemented", "ReadyForConfirmation"),
        ("ReadyForConfirmation", "Finalized"),
    },
    "ship": {
        ("Ready", "InProgress"),
        ("InProgress", "Blocked"),
        ("InProgress", "Failed"),
        ("InProgress", "Implemented"),
    },
}

JSON_BLOCK_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL)
REQ_RE = re.compile(r"^###\s+(REQ-\d{3,}):", re.MULTILINE)
TASK_RE = re.compile(r"^##\s+(TASK-\d{3,}):", re.MULTILINE)


class ProtocolError(Exception):
    pass


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ProtocolError(f"missing required artifact: {path.name}") from exc


def read_metadata(path: Path) -> dict:
    match = JSON_BLOCK_RE.search(read_text(path))
    if not match:
        raise ProtocolError(f"{path.name}: missing fenced JSON metadata block")
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise ProtocolError(f"{path.name}: invalid JSON metadata: {exc}") from exc
    if not isinstance(value, dict):
        raise ProtocolError(f"{path.name}: metadata must be an object")
    return value


def write_metadata(path: Path, metadata: dict) -> None:
    text = read_text(path)
    replacement = "```json\n" + json.dumps(metadata, indent=2) + "\n```"
    updated, count = JSON_BLOCK_RE.subn(lambda _: replacement, text, count=1)
    if count != 1:
        raise ProtocolError(f"{path.name}: could not replace metadata")
    path.write_text(updated, encoding="utf-8")


def contract_digest(plan_dir: Path) -> str:
    digest = hashlib.sha256()
    for name in CONTRACT_FILES:
        digest.update(name.encode())
        digest.update(b"\0")
        digest.update(read_text(plan_dir / name).encode())
        digest.update(b"\0")
    return "sha256:" + digest.hexdigest()


def git_snapshot(plan_dir: Path) -> dict:
    def run(*args: str) -> str:
        result = subprocess.run(
            ["git", "-C", str(plan_dir), *args],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    try:
        root = Path(run("rev-parse", "--show-toplevel")).resolve()
        sha = run("rev-parse", "HEAD")
        branch = run("branch", "--show-current") or "DETACHED"
        porcelain = run("status", "--porcelain", "--untracked-files=all")
    except (subprocess.CalledProcessError, FileNotFoundError):
        return {"sha": "UNAVAILABLE", "branch": "UNAVAILABLE", "dirty_files": [], "dirty_digest": "UNAVAILABLE"}
    try:
        plan_prefix = plan_dir.resolve().relative_to(root).as_posix() + "/"
    except ValueError:
        plan_prefix = ""
    dirty = []
    fingerprint_entries = []
    for line in porcelain.splitlines():
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if plan_prefix and path.startswith(plan_prefix):
            continue
        dirty.append(path)
        absolute = root / path
        try:
            content = absolute.read_bytes() if absolute.is_file() else b"<missing-or-nonfile>"
        except OSError:
            content = b"<unreadable>"
        fingerprint_entries.append((line[:2], path, content))
    fingerprint = hashlib.sha256()
    for status, path, content in sorted(fingerprint_entries, key=lambda item: (item[1], item[0])):
        fingerprint.update(status.encode())
        fingerprint.update(b"\0")
        fingerprint.update(path.encode())
        fingerprint.update(b"\0")
        fingerprint.update(content)
        fingerprint.update(b"\0")
    return {
        "sha": sha,
        "branch": branch,
        "dirty_files": sorted(set(dirty)),
        "dirty_digest": "sha256:" + fingerprint.hexdigest(),
    }


def section(text: str, start: re.Match, next_match: re.Match | None) -> str:
    return text[start.start() : next_match.start() if next_match else len(text)]


def field_value(body: str, label: str) -> str | None:
    match = re.search(rf"^-\s+\*\*{re.escape(label)}\*\*:\s*(.*)$", body, re.MULTILINE | re.IGNORECASE)
    if not match:
        return None
    value = match.group(1).strip()
    if not value or value.lower() in {"...", "tbd", "pending"} or (value.startswith("<") and value.endswith(">")):
        return None
    return value


def has_fields(body: str, labels: tuple[str, ...]) -> bool:
    return all(field_value(body, label) is not None for label in labels)


def parse_requirements(plan_dir: Path) -> tuple[list[str], list[str]]:
    text = read_text(plan_dir / "SPEC.md")
    matches = list(REQ_RE.finditer(text))
    ids = [match.group(1) for match in matches]
    errors = []
    if len(ids) != len(set(ids)):
        errors.append("SPEC.md: duplicate requirement IDs")
    for index, match in enumerate(matches):
        body = section(text, match, matches[index + 1] if index + 1 < len(matches) else None)
        if field_value(body, "Acceptance criteria") is None:
            errors.append(f"SPEC.md: {match.group(1)} needs non-empty Acceptance criteria")
    if not ids:
        errors.append("SPEC.md: no REQ-NNN requirements found")
    return ids, errors


def parse_tasks(plan_dir: Path) -> tuple[dict[str, dict], list[str]]:
    text = read_text(plan_dir / "PLAN.md")
    matches = list(TASK_RE.finditer(text))
    tasks: dict[str, dict] = {}
    errors = []
    for index, match in enumerate(matches):
        task_id = match.group(1)
        if task_id in tasks:
            errors.append(f"PLAN.md: duplicate task ID {task_id}")
            continue
        body = section(text, match, matches[index + 1] if index + 1 < len(matches) else None)
        for label in TASK_FIELDS:
            if field_value(body, label) is None:
                errors.append(f"PLAN.md: {task_id} needs non-empty {label}")
        req_line = re.search(r"^-\s+\*\*Requirements\*\*:\s*(.+)$", body, re.MULTILINE)
        dep_line = re.search(r"^-\s+\*\*Dependencies\*\*:\s*(.+)$", body, re.MULTILINE)
        requirements = re.findall(r"REQ-\d{3,}", req_line.group(1)) if req_line else []
        dependencies = re.findall(r"TASK-\d{3,}", dep_line.group(1)) if dep_line else []
        tasks[task_id] = {"requirements": requirements, "dependencies": dependencies}
    if not tasks:
        errors.append("PLAN.md: no TASK-NNN tasks found")
    return tasks, errors


def parse_state_tasks(path: Path) -> dict[str, dict]:
    result = {}
    for task_id, status, attempts in re.findall(
        r"^\|\s*(TASK-\d{3,})\s*\|\s*([A-Za-z]+)\s*\|\s*(\d+)\s*\|$",
        read_text(path),
        re.MULTILINE,
    ):
        result[task_id] = {"status": status, "attempts": int(attempts)}
    return result


def write_state_tasks(path: Path, tasks: dict[str, dict]) -> None:
    text = read_text(path)
    rows = ["| Task | Status | Attempts |", "| --- | --- | ---: |"]
    rows.extend(f"| {task_id} | {value['status']} | {value['attempts']} |" for task_id, value in tasks.items())
    table = "\n".join(rows)
    pattern = re.compile(
        r"(?<=## Task state\n\n)\| Task \| Status \| Attempts \|\n\|.*?(?=\n\n## Transition history)",
        re.DOTALL,
    )
    updated, count = pattern.subn(lambda _: table, text, count=1)
    if count != 1:
        raise ProtocolError("STATE.md: malformed Task state table")
    path.write_text(updated, encoding="utf-8")


def append_transition(path: Path, old: str, new: str, actor: str, note: str) -> None:
    text = read_text(path)
    rows = re.findall(r"^\|\s*(\d+)\s*\|", text, re.MULTILINE)
    sequence = max((int(value) for value in rows), default=0) + 1
    safe_note = note.replace("|", "\\|").replace("\n", " ").strip() or "No note supplied"
    line = f"| {sequence} | {old} | {new} | {actor} | {safe_note} |"
    path.write_text(text.rstrip() + "\n" + line + "\n", encoding="utf-8")


def open_blocking_questions(plan_dir: Path) -> list[str]:
    text = read_text(plan_dir / "CONTEXT.md")
    matches = list(re.finditer(r"^###\s+(Q-\d{3,}):", text, re.MULTILINE))
    open_ids = []
    for index, match in enumerate(matches):
        body = section(text, match, matches[index + 1] if index + 1 < len(matches) else None)
        blocking = re.search(r"^-\s+\*\*Blocking\*\*:\s*Yes\s*$", body, re.MULTILINE | re.IGNORECASE)
        opened = re.search(r"^-\s+\*\*Status\*\*:\s*Open\s*$", body, re.MULTILINE | re.IGNORECASE)
        if blocking and opened:
            open_ids.append(match.group(1))
    return open_ids


def evidence_for_task(plan_dir: Path, task_id: str, revision: int, digest: str, attempt: int | None = None) -> bool:
    path = plan_dir / "RESULTS.md"
    if not path.exists():
        return False
    text = read_text(path)
    headings = list(re.finditer(r"^##\s+.+$", text, re.MULTILINE))
    for index, match in enumerate(headings):
        heading = re.match(rf"^##\s+{re.escape(task_id)}\s+—\s+Attempt\s+(\d+)\s*$", match.group(0))
        if not heading or (attempt is not None and int(heading.group(1)) != attempt):
            continue
        body = section(text, match, headings[index + 1] if index + 1 < len(headings) else None)
        if (
            has_fields(body, ATTEMPT_FIELDS)
            and field_value(body, "Outcome") == "Completed"
            and field_value(body, "Contract revision") == str(revision)
            and field_value(body, "Contract digest") == digest
        ):
            return True
    return False


def has_current_summary(plan_dir: Path, revision: int, digest: str) -> bool:
    path = plan_dir / "RESULTS.md"
    if not path.exists():
        return False
    text = read_text(path)
    headings = list(re.finditer(r"^##\s+.+$", text, re.MULTILINE))
    for index, match in enumerate(headings):
        if match.group(0) != "## Plan execution summary":
            continue
        body = section(text, match, headings[index + 1] if index + 1 < len(headings) else None)
        if (
            has_fields(body, SUMMARY_FIELDS)
            and field_value(body, "Contract revision") == str(revision)
            and field_value(body, "Contract digest") == digest
            and field_value(body, "Outcome") == "Implemented"
        ):
            return True
    return False


def current_review_status(plan_dir: Path, revision: int, digest: str) -> str | None:
    path = plan_dir / "REVIEW.md"
    if not path.exists():
        return None
    text = read_text(path)
    headings = list(re.finditer(r"^##\s+Review round\s+\d+\s*$", text, re.MULTILINE))
    status = None
    for index, match in enumerate(headings):
        body = section(text, match, headings[index + 1] if index + 1 < len(headings) else None)
        if (
            has_fields(body, REVIEW_FIELDS)
            and field_value(body, "Contract revision") == str(revision)
            and field_value(body, "Contract digest") == digest
        ):
            status = field_value(body, "Status")
    return status


def has_passing_review(plan_dir: Path, revision: int, digest: str) -> bool:
    return current_review_status(plan_dir, revision, digest) == "Ready for user confirmation"


def has_current_finalization(plan_dir: Path, revision: int, digest: str) -> bool:
    path = plan_dir / "REVIEW.md"
    if not path.exists():
        return False
    text = read_text(path)
    headings = list(re.finditer(r"^##\s+.+$", text, re.MULTILINE))
    for index, match in enumerate(headings):
        if match.group(0) != "## Finalization":
            continue
        body = section(text, match, headings[index + 1] if index + 1 < len(headings) else None)
        if (
            has_fields(
                body,
                (
                    "Contract revision",
                    "Contract digest",
                    "User confirmation",
                    "Canonical documentation updates",
                    "Validation freshness",
                ),
            )
            and field_value(body, "Contract revision") == str(revision)
            and field_value(body, "Contract digest") == digest
        ):
            return True
    return False


def validate(plan_dir: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    state_path = plan_dir / "STATE.md"
    try:
        state = read_metadata(state_path)
    except ProtocolError as exc:
        return [str(exc)], warnings
    lifecycle = state.get("lifecycle_state", "Draft")
    required = ("CONTEXT.md", "STATE.md") if lifecycle not in READY_STATES else (*CONTRACT_FILES, "STATE.md")
    for name in required:
        if not (plan_dir / name).is_file():
            errors.append(f"missing required artifact: {name}")
    if errors:
        return errors, warnings

    if state.get("artifact") != "state":
        errors.append("STATE.md: artifact must be state")
    if state.get("protocol_version") != PROTOCOL_VERSION:
        errors.append(f"STATE.md: protocol_version must be {PROTOCOL_VERSION}")
    if lifecycle not in {"Draft", "AwaitingClarification", *READY_STATES}:
        errors.append(f"STATE.md: unknown lifecycle_state {lifecycle!r}")
    for field in ("planning_dirty_files", "planning_dirty_digest", "implementation_dirty_files", "implementation_dirty_digest"):
        if field not in state:
            errors.append(f"STATE.md: missing {field}")

    if all((plan_dir / name).exists() for name in CONTRACT_FILES):
        contract_meta = {}
        for name, artifact in zip(CONTRACT_FILES, ("context", "spec", "plan")):
            try:
                meta = read_metadata(plan_dir / name)
            except ProtocolError as exc:
                errors.append(str(exc))
                continue
            contract_meta[name] = meta
            if meta.get("artifact") != artifact:
                errors.append(f"{name}: artifact must be {artifact}")
            if meta.get("protocol_version") != PROTOCOL_VERSION:
                errors.append(f"{name}: protocol_version must be {PROTOCOL_VERSION}")
            if meta.get("plan_id") != state.get("plan_id"):
                errors.append(f"{name}: plan_id differs from STATE.md")
            if meta.get("contract_revision") != state.get("contract_revision"):
                errors.append(f"{name}: contract_revision differs from STATE.md")
        expected_digest = state.get("contract_digest")
        if expected_digest != "UNSEALED":
            try:
                actual_digest = contract_digest(plan_dir)
                if actual_digest != expected_digest:
                    errors.append("contract digest mismatch; contract artifacts changed after sealing")
            except ProtocolError as exc:
                errors.append(str(exc))
        elif lifecycle in READY_STATES:
            errors.append("ready or later plan has an unsealed contract")

        requirements, req_errors = parse_requirements(plan_dir)
        tasks, task_errors = parse_tasks(plan_dir)
        errors.extend(req_errors)
        errors.extend(task_errors)
        requirement_set = set(requirements)
        mapped_requirements = set()
        for task_id, task in tasks.items():
            for requirement in task["requirements"]:
                mapped_requirements.add(requirement)
                if requirement not in requirement_set:
                    errors.append(f"PLAN.md: {task_id} maps unknown requirement {requirement}")
            for dependency in task["dependencies"]:
                if dependency not in tasks:
                    errors.append(f"PLAN.md: {task_id} has unknown dependency {dependency}")
                if dependency == task_id:
                    errors.append(f"PLAN.md: {task_id} depends on itself")
        for requirement in sorted(requirement_set - mapped_requirements):
            errors.append(f"SPEC.md: {requirement} is not mapped to a task")

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(task_id: str) -> None:
            if task_id in visiting:
                errors.append(f"PLAN.md: dependency cycle includes {task_id}")
                return
            if task_id in visited:
                return
            visiting.add(task_id)
            for dependency in tasks[task_id]["dependencies"]:
                if dependency in tasks:
                    visit(dependency)
            visiting.remove(task_id)
            visited.add(task_id)

        for task_id in tasks:
            visit(task_id)

        state_tasks = parse_state_tasks(state_path)
        if set(state_tasks) != set(tasks):
            errors.append("STATE.md: task table must exactly match PLAN.md task IDs")
        for task_id, value in state_tasks.items():
            if value["status"] not in TASK_STATES:
                errors.append(f"STATE.md: {task_id} has unknown status {value['status']}")
            if value["status"] == "Done" and expected_digest != "UNSEALED":
                if not evidence_for_task(plan_dir, task_id, state["contract_revision"], expected_digest, value["attempts"]):
                    errors.append(f"RESULTS.md: {task_id} is Done without current completed evidence")

        if lifecycle in READY_STATES:
            blockers = open_blocking_questions(plan_dir)
            if blockers:
                errors.append("CONTEXT.md: open blocking questions: " + ", ".join(blockers))
        if lifecycle in {"Implemented", "ChangesRequired", "ReadyForConfirmation", "Finalized"}:
            if not has_current_summary(plan_dir, state["contract_revision"], expected_digest):
                errors.append("RESULTS.md: missing current plan execution summary")
        if lifecycle in {"ReadyForConfirmation", "Finalized"}:
            if not has_passing_review(plan_dir, state["contract_revision"], expected_digest):
                errors.append("REVIEW.md: missing current passing review")
        if lifecycle == "Finalized":
            if not has_current_finalization(plan_dir, state["contract_revision"], expected_digest):
                errors.append("REVIEW.md: missing current explicit finalization record")

    if state.get("planning_base_sha") == "UNAVAILABLE":
        warnings.append("Git planning baseline is unavailable")
    elif state.get("planning_dirty_files"):
        warnings.append("Plan baseline contains pre-existing dirty files; preserve and review them carefully")
    return list(dict.fromkeys(errors)), warnings


def assert_valid_state(plan_dir: Path, allowed_states: set[str]) -> dict:
    errors, _ = validate(plan_dir)
    if errors:
        raise ProtocolError("cannot mutate invalid plan:\n- " + "\n- ".join(errors))
    state = read_metadata(plan_dir / "STATE.md")
    if state.get("lifecycle_state") not in allowed_states:
        expected = ", ".join(sorted(allowed_states))
        raise ProtocolError(f"lifecycle must be one of: {expected}")
    return state


def transition(plan_dir: Path, new: str, actor: str, note: str, force: bool = False) -> None:
    path = plan_dir / "STATE.md"
    state = read_metadata(path)
    old = state["lifecycle_state"]
    if not force and (old, new) not in TRANSITIONS.get(actor, set()):
        raise ProtocolError(f"transition {old} -> {new} is not allowed for {actor}")
    if not force and old in READY_STATES:
        state = assert_valid_state(plan_dir, {old})
    if actor == "spec" and old == "Implemented":
        expected_status = {
            "ChangesRequired": "Changes required",
            "Blocked": "Blocked",
            "ReadyForConfirmation": "Ready for user confirmation",
        }.get(new)
        actual_status = current_review_status(plan_dir, state["contract_revision"], state["contract_digest"])
        if expected_status and actual_status != expected_status:
            raise ProtocolError(f"transition to {new} requires a current review with status {expected_status}")
    if actor == "spec" and new == "Finalized":
        if not has_current_finalization(plan_dir, state["contract_revision"], state["contract_digest"]):
            raise ProtocolError("finalization requires a current explicit finalization record")
    state["lifecycle_state"] = new
    write_metadata(path, state)
    append_transition(path, old, new, actor, note)


def command_revise(plan_dir: Path, note: str) -> None:
    state_path = plan_dir / "STATE.md"
    state = assert_valid_state(plan_dir, {"Ready", "Blocked", "Failed", "ChangesRequired"})
    old = state.get("lifecycle_state", "Draft")
    revision = int(state.get("contract_revision", 0)) + 1
    for name in CONTRACT_FILES:
        path = plan_dir / name
        if path.exists():
            metadata = read_metadata(path)
            metadata["contract_revision"] = revision
            write_metadata(path, metadata)
    state["contract_revision"] = revision
    state["contract_digest"] = "UNSEALED"
    state["lifecycle_state"] = "Draft"
    state["implementation_start_sha"] = "UNSET"
    state["implementation_end_sha"] = "UNSET"
    state["implementation_dirty_files"] = []
    state["implementation_dirty_digest"] = "UNSET"
    write_metadata(state_path, state)
    existing = parse_state_tasks(state_path)
    for value in existing.values():
        value["status"] = "Pending"
        value["attempts"] = 0
    write_state_tasks(state_path, existing)
    append_transition(state_path, old, "Draft", "spec", f"Revision {revision}: {note}")


def command_seal(plan_dir: Path, note: str) -> None:
    state_path = plan_dir / "STATE.md"
    state = read_metadata(state_path)
    if state.get("lifecycle_state") not in {"Draft", "AwaitingClarification"}:
        raise ProtocolError("seal requires Draft or AwaitingClarification state")
    tasks, task_errors = parse_tasks(plan_dir)
    if task_errors:
        raise ProtocolError("; ".join(task_errors))
    blockers = open_blocking_questions(plan_dir)
    if blockers:
        raise ProtocolError("cannot seal with open blocking questions: " + ", ".join(blockers))
    existing = parse_state_tasks(state_path)
    synced = {task_id: existing.get(task_id, {"status": "Pending", "attempts": 0}) for task_id in tasks}
    write_state_tasks(state_path, synced)
    snapshot = git_snapshot(plan_dir)
    state = read_metadata(state_path)
    state["contract_digest"] = contract_digest(plan_dir)
    state["planning_base_sha"] = snapshot["sha"]
    state["planning_branch"] = snapshot["branch"]
    state["planning_dirty_files"] = snapshot["dirty_files"]
    state["planning_dirty_digest"] = snapshot["dirty_digest"]
    write_metadata(state_path, state)
    errors, _ = validate(plan_dir)
    errors = [error for error in errors if "ready or later" not in error]
    if errors:
        raise ProtocolError("cannot seal invalid plan:\n- " + "\n- ".join(errors))
    transition(plan_dir, "Ready", "spec", note)


def command_start(plan_dir: Path, note: str) -> None:
    errors, _ = validate(plan_dir)
    if errors:
        raise ProtocolError("cannot start invalid plan:\n- " + "\n- ".join(errors))
    path = plan_dir / "STATE.md"
    state = read_metadata(path)
    if state.get("lifecycle_state") != "Ready":
        raise ProtocolError("start requires Ready state")
    current = git_snapshot(plan_dir)
    if state.get("planning_base_sha") != "UNAVAILABLE":
        if current["sha"] != state.get("planning_base_sha"):
            raise ProtocolError("Git HEAD differs from the sealed planning baseline; return to $spec refine")
        if current["branch"] != state.get("planning_branch"):
            raise ProtocolError("Git branch differs from the sealed planning baseline; return to $spec refine")
        if current["dirty_files"] != state.get("planning_dirty_files"):
            raise ProtocolError("dirty-file set differs from the sealed planning baseline; return to $spec refine")
        if current["dirty_digest"] != state.get("planning_dirty_digest"):
            raise ProtocolError("dirty-file content differs from the sealed planning baseline; return to $spec refine")
    state["implementation_start_sha"] = current["sha"]
    write_metadata(path, state)
    transition(plan_dir, "InProgress", "ship", note)


def command_task(plan_dir: Path, task_id: str, status: str) -> None:
    state_path = plan_dir / "STATE.md"
    state = assert_valid_state(plan_dir, {"InProgress"})
    tasks = parse_state_tasks(state_path)
    if task_id not in tasks:
        raise ProtocolError(f"unknown task: {task_id}")
    if status not in TASK_STATES:
        raise ProtocolError(f"unknown task status: {status}")
    old = tasks[task_id]["status"]
    allowed = {
        "Pending": {"InProgress", "Superseded"},
        "InProgress": {"Done", "Blocked", "Failed"},
        "Blocked": {"InProgress", "Superseded"},
        "Failed": {"InProgress", "Superseded"},
        "Done": set(),
        "Superseded": set(),
    }
    if status not in allowed[old]:
        raise ProtocolError(f"task transition {old} -> {status} is not allowed")
    if status == "InProgress":
        plan_tasks, plan_errors = parse_tasks(plan_dir)
        if plan_errors:
            raise ProtocolError("; ".join(plan_errors))
        incomplete = [
            dependency
            for dependency in plan_tasks[task_id]["dependencies"]
            if tasks[dependency]["status"] not in {"Done", "Superseded"}
        ]
        if incomplete:
            raise ProtocolError(f"{task_id} has incomplete dependencies: " + ", ".join(incomplete))
    if status == "Done":
        if not evidence_for_task(
            plan_dir,
            task_id,
            state["contract_revision"],
            state["contract_digest"],
            tasks[task_id]["attempts"],
        ):
            raise ProtocolError(f"{task_id} cannot be Done without current completed RESULTS evidence")
    tasks[task_id]["status"] = status
    if status == "InProgress":
        tasks[task_id]["attempts"] += 1
    write_state_tasks(state_path, tasks)


def command_finish(plan_dir: Path, note: str) -> None:
    state_path = plan_dir / "STATE.md"
    state = assert_valid_state(plan_dir, {"InProgress"})
    tasks = parse_state_tasks(state_path)
    unfinished = [task_id for task_id, value in tasks.items() if value["status"] not in {"Done", "Superseded"}]
    if unfinished:
        raise ProtocolError("unfinished tasks: " + ", ".join(unfinished))
    digest = state["contract_digest"]
    revision = state["contract_revision"]
    missing = [
        task_id
        for task_id, value in tasks.items()
        if value["status"] == "Done"
        and not evidence_for_task(plan_dir, task_id, revision, digest, value["attempts"])
    ]
    if missing:
        raise ProtocolError("tasks lack current completed RESULTS evidence: " + ", ".join(missing))
    if not has_current_summary(plan_dir, revision, digest):
        raise ProtocolError("RESULTS.md lacks a current plan execution summary")
    snapshot = git_snapshot(plan_dir)
    state["implementation_end_sha"] = snapshot["sha"]
    state["implementation_dirty_files"] = snapshot["dirty_files"]
    state["implementation_dirty_digest"] = snapshot["dirty_digest"]
    write_metadata(state_path, state)
    transition(plan_dir, "Implemented", "ship", note)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "seal", "start", "finish", "revise"):
        sub = subparsers.add_parser(command)
        sub.add_argument("plan_dir", type=Path)
        if command != "validate":
            sub.add_argument("--note", default=command)
    sub = subparsers.add_parser("transition")
    sub.add_argument("plan_dir", type=Path)
    sub.add_argument("new_state")
    sub.add_argument("--actor", required=True, choices=("spec", "ship"))
    sub.add_argument("--note", default="transition")
    sub = subparsers.add_parser("task")
    sub.add_argument("plan_dir", type=Path)
    sub.add_argument("task_id")
    sub.add_argument("status", choices=sorted(TASK_STATES))
    args = parser.parse_args()
    plan_dir = args.plan_dir.resolve()
    try:
        if args.command == "validate":
            errors, warnings = validate(plan_dir)
            for warning in warnings:
                print(f"WARNING: {warning}")
            if errors:
                for error in errors:
                    print(f"ERROR: {error}")
                return 1
            print(f"VALID: {plan_dir}")
        elif args.command == "revise":
            command_revise(plan_dir, args.note)
        elif args.command == "seal":
            command_seal(plan_dir, args.note)
        elif args.command == "start":
            command_start(plan_dir, args.note)
        elif args.command == "task":
            command_task(plan_dir, args.task_id, args.status)
        elif args.command == "finish":
            command_finish(plan_dir, args.note)
        elif args.command == "transition":
            transition(plan_dir, args.new_state, args.actor, args.note)
        return 0
    except (ProtocolError, KeyError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
