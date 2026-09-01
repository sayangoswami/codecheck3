#!/usr/bin/env python3
"""
Delete CodeCheck problems.

Two modes:

  delete_problems.py IDS_FILE --admin-password SECRET
      IDS_FILE has one problem id per line (blank lines and lines starting
      with '#' are ignored). All ids are deleted in a single request,
      authorised by the server-wide admin password
      (com.horstmann.codecheck.admin.password on the server; also read from
      the CODECHECK_ADMIN_PASSWORD environment variable).

  delete_problems.py PAIRS_FILE
      PAIRS_FILE has one "<id> <editKey>" pair per line. Each problem is
      deleted with its own edit key -- no admin password needed. Use this
      when you kept the edit URLs printed by upload_problems.py.

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


def batch_delete(host, ids, admin_password):
    resp = requests.post(
        f"{host}/deleteProblems",
        data="\n".join(ids).encode("utf-8"),
        headers={
            "Content-Type": "text/plain; charset=utf-8",
            "X-Admin-Password": admin_password,
        },
    )
    print(resp.text.strip())
    # 200 = all deleted, 207 = some failed, others = auth/server error
    return 0 if resp.status_code == 200 else 1


def pairwise_delete(host, lines):
    failures = 0
    for line in lines:
        parts = line.split()
        if len(parts) != 2:
            print(f"SKIP (not '<id> <editKey>'): {line}", file=sys.stderr)
            failures += 1
            continue
        problem_id, edit_key = parts
        resp = requests.delete(f"{host}/private/problem/{problem_id}/{edit_key}")
        if resp.ok:
            print(f"deleted {problem_id}")
        else:
            print(f"FAILED {problem_id}: {resp.status_code} {resp.text.strip()}", file=sys.stderr)
            failures += 1
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("file", help="ids file (admin mode) or '<id> <editKey>' pairs file")
    parser.add_argument(
        "--host",
        default=os.environ.get("CODECHECK_HOST"),
        help="CodeCheck server base URL (or set CODECHECK_HOST)",
    )
    parser.add_argument(
        "--admin-password",
        default=os.environ.get("CODECHECK_ADMIN_PASSWORD"),
        help="server admin password; enables single-request batch delete by id "
        "(or set CODECHECK_ADMIN_PASSWORD)",
    )
    args = parser.parse_args()

    if not args.host:
        parser.error("Provide --host or set the CODECHECK_HOST environment variable")
    host = args.host.rstrip("/")

    lines = read_lines(args.file)
    if not lines:
        parser.error(f"No problem ids found in {args.file}")

    if args.admin_password:
        sys.exit(batch_delete(host, lines, args.admin_password))
    else:
        sys.exit(pairwise_delete(host, lines))


if __name__ == "__main__":
    main()
