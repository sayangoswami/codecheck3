#!/usr/bin/env python3
"""
Delete CodeCheck assignments.

  delete_assignments.py PAIRS_FILE
      PAIRS_FILE has one "<assignmentID> <editKey>" pair per line (blank
      lines and lines starting with '#' are ignored). Each assignment is
      deleted with its own edit key -- the same non-LTI edit key that
      appears in the private assignment URL
      (.../private/assignment/<assignmentID>/<editKey>).

Student work, submissions and comments for the assignment are left in
storage; only the assignment definition is removed.

Server: pass --host, or set the CODECHECK_HOST environment variable.

Dependencies: pip install -r requirements.txt (requests)
"""

import argparse
import os
import sys

import requests


def read_lines(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if line and not line.startswith("#"):
                out.append(line)
    return out


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("file", help="'<assignmentID> <editKey>' pairs file")
    parser.add_argument(
        "--host",
        default=os.environ.get("CODECHECK_HOST"),
        help="CodeCheck server base URL (or set CODECHECK_HOST)",
    )
    args = parser.parse_args()

    if not args.host:
        parser.error("Provide --host or set the CODECHECK_HOST environment variable")
    host = args.host.rstrip("/")

    lines = read_lines(args.file)
    if not lines:
        parser.error(f"No assignments found in {args.file}")

    failures = 0
    for line in lines:
        parts = line.split()
        if len(parts) != 2:
            print(f"SKIP (not '<assignmentID> <editKey>'): {line}", file=sys.stderr)
            failures += 1
            continue
        assignment_id, edit_key = parts
        resp = requests.delete(f"{host}/private/assignment/{assignment_id}/{edit_key}")
        if resp.ok:
            print(f"deleted {assignment_id}")
        else:
            print(f"FAILED {assignment_id}: {resp.status_code} {resp.text.strip()}", file=sys.stderr)
            failures += 1
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
