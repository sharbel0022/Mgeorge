#!/usr/bin/env python3
"""Bounded, local Codex improvement loop for a disposable Mgeorge checkout.

Never runs against the live application and never pushes or deploys.
Requires Python 3.10+, Node 22.13+, npm, git, and authenticated Codex CLI.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / ".codex-work" / "autopilot"
PROMPT = ROOT / "docs" / "codex-autopilot" / "PROMPT.md"
SCHEMA = ROOT / "docs" / "codex-autopilot" / "result.schema.json"
REPO = re.compile(r"(?:^|github\.com[:/])sharbel0022/Mgeorge(?:\.git)?/?$", re.I)
PROTECTED = {
    "AGENTS.md", "scripts/codex_24h.py", "scripts/check.mjs",
    "package.json", "sites/package.json", ".gitignore", "sites/.gitignore",
    ".github/workflows/payment-control-ci.yml",
    "docs/codex-autopilot/PROMPT.md", "docs/codex-autopilot/result.schema.json",
}
SKIP_DIRS = {".git", "node_modules", ".codex-work", ".next", ".vinext", ".wrangler", "dist", "coverage"}
GATES = [
    ("git-diff-check", ROOT, ["git", "diff", "--check"]),
    ("node-check", ROOT, ["npm", "run", "check"]),
    ("node-tests", ROOT, ["npm", "test"]),
    ("node-audit", ROOT, ["npm", "audit", "--audit-level=high"]),
    ("sites-check", ROOT / "sites", ["npm", "run", "check"]),
    ("sites-tests", ROOT / "sites", ["npm", "test"]),
    ("sites-audit", ROOT / "sites", ["npm", "audit", "--audit-level=high"]),
    ("sites-build", ROOT / "sites", ["npm", "run", "build"]),
]


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def scrubbed_env(*, codex: bool = False) -> dict[str, str]:
    # Run in a disposable VM/container as well: the host still owns the processes.
    allowed = {"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "HOME",
               "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TMP", "TEMP", "TMPDIR",
               "LANG", "LC_ALL", "TERM", "SYSTEMDRIVE"}
    if codex:
        allowed |= {"OPENAI_API_KEY", "CODEX_HOME", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"}
    env = {k: v for k, v in os.environ.items() if k.upper() in allowed}
    env.update({"CI": "1", "NODE_ENV": "test", "NEXT_TELEMETRY_DISABLED": "1",
                "DO_NOT_TRACK": "1", "WRANGLER_SEND_METRICS": "false"})
    return env


def command(argv: list[str], *, cwd: Path = ROOT, timeout: float = 30) -> str:
    done = subprocess.run(argv, cwd=cwd, env=scrubbed_env(), text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    if done.returncode:
        raise RuntimeError(f"{' '.join(argv)}: {done.stderr.strip() or done.stdout.strip()}")
    return done.stdout.strip()


def stop_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def run_logged(argv: list[str], cwd: Path, name: Path, timeout: float,
               *, stdin: str | None = None, codex: bool = False) -> dict:
    name.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    kwargs = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt"
              else {"start_new_session": True})
    with (name.with_suffix(".stdout.txt")).open("w", encoding="utf-8") as out, \
         (name.with_suffix(".stderr.txt")).open("w", encoding="utf-8") as err:
        p = subprocess.Popen(argv, cwd=cwd, env=scrubbed_env(codex=codex), text=True,
                             stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                             stdout=out, stderr=err, **kwargs)
        try:
            if stdin is not None:
                p.stdin.write(stdin)
                p.stdin.close()
                p.stdin = None
            p.wait(timeout=max(1, timeout))
            expired = False
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            stop_tree(p)
            expired = True
            if isinstance(sys.exc_info()[1], KeyboardInterrupt):
                raise
    return {"exit_code": p.returncode, "timed_out": expired,
            "seconds": round(time.monotonic() - started, 2),
            "stdout": str(name.with_suffix(".stdout.txt").relative_to(ROOT)),
            "stderr": str(name.with_suffix(".stderr.txt").relative_to(ROOT))}


def sensitive_files() -> list[str]:
    matches = []
    for base, dirs, files in os.walk(ROOT, followlinks=False):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for d in dirs:
            if d.lower() in {"data", "private", "uploads", "secrets"}:
                matches.append(str((Path(base) / d).relative_to(ROOT)))
        for fname in files:
            lower = fname.lower()
            if lower == ".env.example":
                continue
            if (lower == ".env" or lower.startswith(".env.") or lower.startswith(".dev.vars")
                    or lower.endswith((".pem", ".key", ".p12", ".pfx", ".sqlite", ".db", ".db3"))):
                matches.append(str((Path(base) / fname).relative_to(ROOT)))
    return matches[:20]


def check_repository(*, must_be_clean: bool, branch: str | None = None) -> None:
    top = Path(command(["git", "rev-parse", "--show-toplevel"])).resolve()
    if top != ROOT:
        raise RuntimeError("Run this only from an independent clone of Mgeorge.")
    remote = command(["git", "remote", "get-url", "origin"])
    if not REPO.search(remote):
        raise RuntimeError(f"Unexpected origin: {remote}")
    current = command(["git", "branch", "--show-current"])
    if branch is not None and current != branch:
        raise RuntimeError(f"Branch changed unexpectedly: {current!r}; expected {branch!r}")
    if must_be_clean and command(["git", "status", "--porcelain", "--untracked-files=normal"]):
        raise RuntimeError("Working tree is not clean. Commit/stash in a separate clone first.")
    flagged = sensitive_files()
    if flagged:
        raise RuntimeError("Sensitive or production-looking files in checkout: " + ", ".join(flagged))


def check_protected() -> None:
    changed = set(command(["git", "diff", "--name-only", "HEAD"]).splitlines())
    changed.update(command(["git", "ls-files", "--others", "--exclude-standard"]).splitlines())
    # Do not allow deleting tests or changing the independent quality gates/runner.
    blocked = sorted(p for p in changed if p in PROTECTED or p.startswith(".github/")
                     or (p.startswith(("test/", "sites/tests/")) and not (ROOT / p).exists()))
    if blocked:
        raise RuntimeError("Protected files changed or tests deleted: " + ", ".join(blocked))


def test_counts(path: Path) -> dict[str, int] | None:
    raw = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    result = {}
    for key in ("tests", "pass", "fail", "skipped", "todo"):
        found = re.findall(rf"(?m)^#\s+{key}\s+(\d+)\s*$", raw)
        if found:
            result[key] = int(found[-1])
    return result if "tests" in result else None


def run_gates(out_dir: Path, deadline: float, baseline: dict | None) -> dict:
    results = {}
    for label, cwd, argv in GATES:
        available = deadline - time.monotonic()
        if available <= 0:
            results[label] = {"exit_code": None, "timed_out": True, "reason": "24-hour deadline reached"}
            break
        print(f"  Kontroll: {label}", flush=True)
        result = run_logged(argv, cwd, out_dir / label, min(360, available))
        if label.endswith("tests"):
            counts = test_counts(ROOT / result["stdout"])
            result["counts"] = counts
            reference = (baseline or {}).get(label, {}).get("counts")
            if counts is None or counts.get("fail", 1) != 0 or counts.get("skipped", 0) > 0:
                result["reason"] = "Missing TAP summary, failing or skipped tests"
            elif reference and counts["tests"] < reference["tests"]:
                result["reason"] = "Test count decreased compared with original baseline"
        results[label] = result
    return results


def green(gates: dict) -> bool:
    return len(gates) == len(GATES) and all(r.get("exit_code") == 0 and not r.get("timed_out")
             and not r.get("reason") for r in gates.values())


def save_state(state: dict) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    tmp = WORK / "state.tmp"
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(WORK / "state.json")
    lines = ["# Mgeorge Codex 24h – local verification report", "",
             f"Started: {state['started_at']}", f"Last update: {utc_now()}",
             f"Branch: `{state['branch']}`", f"Status: **{state['status']}**", "",
             "Passing automatic checks is NOT evidence of correct live bank/OCR or Sites deployment.",
             "Production validation, customer identity and bank evidence still require an authorized human.", "",
             "| Cycle | Codex | Gates | Summary |", "|---|---|---|---|"]
    for r in state.get("rounds", []):
        summary = str(r.get("summary", "")).replace("|", "\\|").replace("\n", " ")[:130]
        lines.append(f"| {r['round']} | {r['codex']['exit_code']} | "
                     f"{'PASS' if r['green'] else 'FAIL'} | {summary} |")
    lines += ["", "## Latest checks", ""]
    for name, result in state.get("last_gates", {}).items():
        lines.append(f"- {name}: exit={result.get('exit_code')}, timeout={result.get('timed_out')}, "
                     f"note={result.get('reason', 'none')}; log: `{result.get('stdout', '-')}`")
    lines += ["", "## Required manual release checks", "",
              "- Check anonymized real Swedbank/Bankgirot details and original payer evidence.",
              "- Verify OCR/reference provenance; missing bank OCR must remain missing.",
              "- Confirm Gmail invoice evidence, duplicates, partial payments and audit history.",
              "- Inspect monochrome Sites UI on desktop and phone; keyboard and screen-reader usability.",
              "- Review data migration/backup restoration in isolated staging before deployment.",
              "- Review PR and explicitly approve any production deployment, email or accounting write.", ""]
    (WORK / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")


def next_prompt(state: dict, round_number: int) -> str:
    last = state.get("last_gates", {})
    failures = []
    for label, info in last.items():
        if info.get("exit_code") != 0 or info.get("timed_out") or info.get("reason"):
            failures.append(f"{label}: {info.get('reason', '')} (log {info.get('stdout', '')})")
    return (PROMPT.read_text(encoding="utf-8") + "\n\n---\n"
            f"Iteration: {round_number}. Time left in this local run: "
            f"{max(0, round((state['deadline'] - time.time()) / 60))} minutes.\n"
            "Observed failing checks: " + ("; ".join(failures) or "none") + "\n"
            "Previous Codex findings: " + json.dumps(state.get("last_findings", {}), ensure_ascii=False)[:2500] + "\n"
            "Inspect the real implementation and implement one verifiable, prioritized improvement. "
            "Do not spend a cycle only writing an optimistic grade.\n")


def run(args: argparse.Namespace) -> int:
    if not (0 < args.hours <= 24) or not (1 <= args.max_rounds <= 100) or not (1 <= args.round_minutes <= 120):
        raise RuntimeError("Use 0<hours<=24, 1<=max-rounds<=100 and 1<=round-minutes<=120.")
    if args.dry_run:
        print("Dry run: isolated checkout, no credentials, no production data; branch codex/autopilot-<timestamp>.")
        print("Gates:", ", ".join(name for name, _, _ in GATES))
        print("Will NOT push, merge, deploy, send emails or initiate bank payments.")
        return 0
    for program in ("git", "npm", "node", "codex"):
        if not shutil.which(program):
            raise RuntimeError(f"Missing executable: {program}")
    if not (ROOT / "node_modules").is_dir() or not (ROOT / "sites" / "node_modules").is_dir():
        raise RuntimeError("Install dependencies in your isolated clone first: npm ci --ignore-scripts; "
                           "cd sites && npm run install:ci")
    if args.resume:
        state = json.loads((WORK / "state.json").read_text(encoding="utf-8"))
        check_repository(must_be_clean=False, branch=state["branch"])
        if command(["git", "rev-parse", "HEAD"]) != state["base_sha"]:
            raise RuntimeError("Codex changed git HEAD; stop and review before resuming.")
        check_protected()
        if state["deadline"] <= time.time():
            raise RuntimeError("The original 24-hour window has already expired.")
    else:
        if (WORK / "state.json").exists():
            raise RuntimeError("Previous run exists; use --resume or archive .codex-work/autopilot.")
        check_repository(must_be_clean=True)
        branch = "codex/autopilot-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
        command(["git", "switch", "-c", branch])
        state = {"branch": branch, "base_sha": command(["git", "rev-parse", "HEAD"]),
                 "started_at": utc_now(), "deadline": time.time() + args.hours * 3600,
                 "status": "running", "rounds": [], "last_gates": {}, "last_findings": {}}
        save_state(state)
        print("Baseline checks (synthetic data only):", flush=True)
        baseline = run_gates(WORK / "baseline", time.monotonic() + min(3600, args.hours * 3600), None)
        state["baseline"] = baseline
        state["last_gates"] = baseline
        save_state(state)
    deadline = time.monotonic() + max(0, state["deadline"] - time.time())
    baseline = state.get("baseline", {})
    clean_cycles = 0
    stalled = 0
    codex_errors = 0
    previous_diff = command(["git", "status", "--porcelain"])
    try:
        for i in range(len(state["rounds"]) + 1, args.max_rounds + 1):
            if time.monotonic() >= deadline:
                state["status"] = "time_limit"
                break
            check_repository(must_be_clean=False, branch=state["branch"])
            if command(["git", "rev-parse", "HEAD"]) != state["base_sha"]:
                raise RuntimeError("Git HEAD changed unexpectedly; never commit inside the loop.")
            check_protected()
            round_dir = WORK / f"round-{i:03d}"
            round_dir.mkdir(parents=True, exist_ok=True)
            out_json = round_dir / "codex-result.json"
            cmd = ["codex", "exec", "--sandbox", "workspace-write", "--ask-for-approval", "never",
                   "--output-schema", str(SCHEMA), "--output-last-message", str(out_json), "-"]
            if args.model:
                cmd[2:2] = ["--model", args.model]
            print(f"\nCodex iteration {i}, max {args.round_minutes} min", flush=True)
            execution = run_logged(cmd, ROOT, round_dir / "codex", min(args.round_minutes * 60,
                       deadline - time.monotonic()), stdin=next_prompt(state, i), codex=True)
            check_repository(must_be_clean=False, branch=state["branch"])
            if command(["git", "rev-parse", "HEAD"]) != state["base_sha"]:
                raise RuntimeError("Git HEAD changed unexpectedly; never commit inside the loop.")
            check_protected()
            report = {}
            if out_json.exists():
                try:
                    report = json.loads(out_json.read_text(encoding="utf-8"))
                except (ValueError, OSError):
                    pass
            codex_errors = (codex_errors + 1) if (execution["exit_code"] != 0 or execution["timed_out"]) else 0
            if codex_errors:
                gates = {}
                passed = False
            else:
                gates = run_gates(round_dir / "gates", deadline, baseline)
                passed = green(gates)
            current_diff = command(["git", "status", "--porcelain"])
            progress = current_diff != previous_diff or bool(report.get("changed_files"))
            previous_diff = current_diff
            stalled = 0 if progress else stalled + 1
            clean_cycles = clean_cycles + 1 if passed and bool(report.get("done")) and not progress else 0
            state["rounds"].append({"round": i, "codex": execution, "green": passed,
                                    "summary": report.get("summary", "No structured summary"),
                                    "timestamp": utc_now(), "progress": progress})
            state["last_findings"] = report
            if gates:
                state["last_gates"] = gates
            save_state(state)
            print(f"Iteration {i}: {'GREEN' if passed else 'NOT GREEN'}, progress={progress}", flush=True)
            if clean_cycles >= 2:
                state["status"] = "automatic_checks_green_needs_human_review"
                break
            if codex_errors >= 3:
                state["status"] = "repeated_codex_errors_or_timeouts"
                break
            if stalled >= 3:
                state["status"] = "stalled_manual_review_needed"
                break
        else:
            state["status"] = "round_limit"
        if state["status"] == "running":
            state["status"] = "time_limit"
    except KeyboardInterrupt:
        state["status"] = "interrupted_resume_available"
        save_state(state)
        return 130
    except Exception as exc:
        state["status"] = "blocked: " + str(exc)[:220]
        save_state(state)
        raise
    save_state(state)
    print(f"\nStatus: {state['status']}\nReport: {WORK / 'REPORT.md'}")
    print("Code remains only in local branch; review, commit and open a PR manually.")
    return 0 if state["status"] == "automatic_checks_green_needs_human_review" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=float, default=24, help="Maximum wall-clock runtime (<=24)")
    parser.add_argument("--max-rounds", type=int, default=48)
    parser.add_argument("--round-minutes", type=int, default=40)
    parser.add_argument("--model", default="", help="Optional Codex model override")
    parser.add_argument("--resume", action="store_true", help="Resume previous time-limited run")
    parser.add_argument("--dry-run", action="store_true", help="Preview without changing anything")
    try:
        return run(parser.parse_args())
    except (RuntimeError, OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        print(f"STOPPED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
