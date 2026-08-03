#!/usr/bin/env python3
"""
Batch-upload CodeCheck problems, optionally creating an assignment from them.

Usage:
  upload_problems.py DIR
      DIR contains one subdirectory per problem (each with an index.md and its
      source files directly inside it -- no nested solution/student/use dirs).
      If DIR/roster.md exists, an assignment is also created from the uploaded
      problems, restricted to the IDs listed in roster.md (one per line). If
      it doesn't exist, only the problems are uploaded.

  upload_problems.py PROBLEM_DIR [PROBLEM_DIR ...]
      Each argument is itself a single problem directory. No assignment is
      created in this mode (there's no single container directory to look
      for a roster.md in).

Each problem's index.md is converted to index.html with the `markdown`
library; every other file directly inside the problem directory is uploaded
as-is.

Server: pass --host, or set the CODECHECK_HOST environment variable.

Dependencies: pip install -r requirements.txt (requests, markdown)
"""

import argparse
import io
import os
import re
import sys
import zipfile
from pathlib import Path

import markdown
import requests


def raise_for_status_verbose(resp: requests.Response):
    try:
        resp.raise_for_status()
    except requests.HTTPError as e:
        raise requests.HTTPError(f"{e}\nResponse body: {resp.text}") from None


def find_title(markdown_text: str, fallback: str) -> str:
    for line in markdown_text.splitlines():
        m = re.match(r"\s*#+\s+(.*\S)\s*$", line)
        if m:
            return m.group(1)
    return fallback


def build_problem_zip(problem_dir: Path) -> tuple[bytes, str]:
    index_md = problem_dir / "index.md"
    md_text = index_md.read_text(encoding="utf-8")
    html = markdown.markdown(md_text)
    title = find_title(md_text, problem_dir.name)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.html", html)
        for path in sorted(problem_dir.iterdir()):
            if path.name in ("index.md", "roster.md") or not path.is_file():
                continue
            zf.write(path, arcname=path.name)
    return buf.getvalue(), title


def upload_problem(host: str, zip_bytes: bytes) -> tuple[str, str]:
    resp = requests.post(
        f"{host}/uploadProblem",
        files={"file": ("problem.zip", zip_bytes, "application/zip")},
    )
    raise_for_status_verbose(resp)
    html = resp.text
    public_match = re.search(r'Public URL \(for your students\):\s*<a href="([^"]+)"', html)
    edit_match = re.search(r'Edit URL \(for you only\):\s*<a href="([^"]+)"', html)
    if not public_match or not edit_match:
        raise RuntimeError(f"Could not find URLs in upload response:\n{html}")
    return public_match.group(1), edit_match.group(1)


def create_assignment(host: str, problems: list[tuple[str, str]], roster_text: str) -> tuple[str, str]:
    lines = [f"!{url} {title}" for title, url in problems]
    payload = {"problems": "\n".join(lines), "roster": roster_text}
    resp = requests.post(f"{host}/saveAssignment", json=payload)
    raise_for_status_verbose(resp)
    data = resp.json()
    assignment_id = data["assignmentID"]
    public_url = f"{host}/assignment/{assignment_id}"
    private_url = data["viewAssignmentURL"]
    return public_url, private_url


def find_problem_dirs(args_paths: list[str]) -> tuple[list[Path], Path | None]:
    if len(args_paths) == 1 and not (Path(args_paths[0]) / "index.md").exists():
        container = Path(args_paths[0])
        if not container.is_dir():
            raise SystemExit(f"{container} is not a directory")
        problem_dirs = sorted(
            p for p in container.iterdir() if p.is_dir() and (p / "index.md").exists()
        )
        if not problem_dirs:
            raise SystemExit(f"No problem subdirectories (with index.md) found in {container}")
        roster_file = container / "roster.md"
        return problem_dirs, (roster_file if roster_file.exists() else None)
    else:
        problem_dirs = [Path(p) for p in args_paths]
        for p in problem_dirs:
            if not (p / "index.md").exists():
                raise SystemExit(f"{p} has no index.md")
        return problem_dirs, None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", help="a container directory, or one or more problem directories")
    parser.add_argument(
        "--host",
        default=os.environ.get("CODECHECK_HOST"),
        help="CodeCheck server base URL, e.g. https://codecheck.example.com (or set CODECHECK_HOST)",
    )
    args = parser.parse_args()

    if not args.host:
        parser.error("Provide --host or set the CODECHECK_HOST environment variable")
    host = args.host.rstrip("/")

    problem_dirs, roster_file = find_problem_dirs(args.paths)

    results = []
    for problem_dir in problem_dirs:
        print(f"Uploading {problem_dir}...", file=sys.stderr)
        zip_bytes, title = build_problem_zip(problem_dir)
        public_url, edit_url = upload_problem(host, zip_bytes)
        results.append((title, public_url, edit_url))

    print()
    print("| Problem | Public URL | Private URL (for editing) |")
    print("|---|---|---|")
    for title, public_url, edit_url in results:
        print(f"| {title} | {public_url} | {edit_url} |")

    if roster_file:
        print(f"\nCreating assignment from roster {roster_file}...", file=sys.stderr)
        roster_text = roster_file.read_text(encoding="utf-8")
        assignment_public, assignment_private = create_assignment(
            host, [(title, url) for title, url, _ in results], roster_text
        )
        print()
        print(f"Assignment public URL (for students): {assignment_public}")
        print(f"Assignment private URL (for editing/viewing submissions): {assignment_private}")


if __name__ == "__main__":
    main()
