# Our Railway Deployment

This document is about the deployment that already exists — what's live, and what to do when you
change the code and want that change to show up for students. If you're setting up a *new*
deployment from scratch (Railway or otherwise), see [DEPLOYMENT.md](DEPLOYMENT.md) instead; this
document assumes that's already done.

## What's live right now

Two separate Railway projects, both under the same Railway account (whoever set this up — check
`railway whoami` if you need to know which account currently owns it):

- **`comrun-java`** project → one service (`comrun-java`) → live at
  `https://comrun-java-production.up.railway.app`
- **`codecheck-webapp`** project → two services: `codecheck-webapp` (the app itself, live at
  `https://codecheck-webapp-production.up.railway.app`) and `Postgres` (the database, not
  reachable from outside Railway — only `codecheck-webapp` can talk to it).

`codecheck-webapp`'s database and JWT secret were configured as environment variables directly in
Railway (never committed to git — see "Changing secrets or config" below if you ever need to see
or change them). Everything else about how these are wired together is exactly what
[DEPLOYMENT.md](DEPLOYMENT.md) describes in general terms.

## One-time setup (already done, documented here for reference)

You don't need to redo this — it's just a record of what exists, in case you ever need to
recreate it (e.g. if a project were accidentally deleted).

- Railway CLI installed via `brew install railway`, logged in via `railway login` (opens a
  browser).
- `comrun-java` project created with `railway init`, deployed with `railway up` from inside the
  `comrun-java/` folder.
- `codecheck-webapp` project created with `railway init` from the repository root; a Postgres
  addon added with `railway add --database postgres`; the schema from DEPLOYMENT.md applied via
  `railway connect postgres --tunnel-only` (opens a private tunnel to the database so a normal
  `psql` client on your laptop can reach it) plus `psql`.
- Environment variables set on the `codecheck-webapp` service with `railway variables --set`,
  including the datasource settings, which reference the Postgres service's own variables using
  Railway's `${{Postgres.PGHOST}}`-style syntax rather than hardcoded values — so if Railway ever
  rotates the database password, this deployment picks up the change automatically.

## Making a change and pushing it live

CodeCheck on Railway does **not** auto-deploy on every git push — it deploys whatever's in your
local folder at the moment you run `railway up`, from whichever machine you run it on. This means:
after you `git commit` and `git push` your changes (so they're saved in the shared repository),
you *also* need to separately tell Railway to deploy them.

1. **Make sure the CLI is logged in.** Run `railway whoami` in a terminal. If it says you're not
   logged in, run `railway login` (opens a browser) first.

2. **If you changed anything under `comrun-java/`:**
   ```bash
   cd comrun-java
   railway up --service comrun-java --ci
   ```
3. **If you changed anything else** (the webapp itself — `src/`, `pom.xml`, etc.):
   ```bash
   cd /path/to/codecheck3   # repository root
   railway up --service codecheck-webapp --ci
   ```

   The `--ci` flag just makes it print build logs and exit when done, instead of leaving your
   terminal attached — either works, `--ci` is just less confusing to watch.

4. **Watch for `"status":"success"` near the end of the output.** If it instead says `"status":
   "failed"`, see [Troubleshooting](#troubleshooting-a-failed-deploy) below.

5. **Double check it's actually running**, not just built:
   ```bash
   railway status --json
   ```
   Look for `"status": "SUCCESS"` and `"instances": [{"status": "RUNNING"}]` under the service you
   just deployed. A build can succeed but the app can still crash immediately on startup (this
   happened to us once — a file was missing from what got copied into the image) — this step is
   what catches that.

6. **Smoke-test it in a browser** — visit the live URL and click around, or repeat the checks in
   [DEPLOYMENT.md Part D](DEPLOYMENT.md#part-d--verify-everything-actually-works). Don't skip this
   for anything that touches how submissions are checked or scored.

### If you change the database schema

If a future code change needs a new column or table (not something we anticipate needing soon,
but just in case): the schema is **not** applied automatically on deploy. You'd need to connect to
Postgres again and run the change by hand, the same way the schema was first set up:

```bash
railway connect postgres --tunnel-only
```

This prints a `Host`/`Port`/`User`/`Password` you can point any Postgres client at (or the exact
`psql` command to run, if you have `psql` installed — on a Mac, `brew install libpq` gets you
`psql` at `/opt/homebrew/opt/libpq/bin/psql` without it fighting with a full Postgres server
install). Do this *before* deploying code that depends on the new column/table existing, not
after.

## Checking logs and debugging

```bash
railway logs --service codecheck-webapp          # follow live (runtime) logs
railway logs --service codecheck-webapp -n 200    # last 200 lines, no following
railway logs --build --lines 300 <deployment-id>  # build logs for a specific deployment
```

Note the last form takes the deployment ID directly as a plain argument, not as `--deployment
<id>` — combining `--build` with `--deployment` isn't accepted by the CLI. Get a deployment ID (if
you need one) from:
```bash
railway deployment list --service codecheck-webapp --json
```

## Changing secrets or config

```bash
railway variables --service codecheck-webapp                          # list current values
railway variables --service codecheck-webapp --set "KEY=new-value"    # change one
```

Changing a variable does **not** automatically restart/redeploy the service — run `railway up`
again (or `railway service restart`) afterward for it to take effect.

A couple worth knowing about specifically:

- **Rotating the JWT secret** (`com.horstmann.codecheck.jwt.secret.key`) invalidates any
  outstanding signed tokens. For our current usage (no LTI/LMS integration) this has essentially
  no user-visible effect, so it's safe to rotate if you ever suspect it leaked.
- **The database password** is managed by Railway's Postgres plugin, not by us directly — we never
  typed it in ourselves, and since we referenced it via `${{Postgres.PGPASSWORD}}` rather than a
  hardcoded copy, there's nothing to update on our side even if Railway rotates it.

## Troubleshooting a failed deploy

- **Build log is essentially empty** (just one or two "scheduling build" lines, no real progress).
  This is what a broken `.dockerignore` looks like — see the first item in
  [DEPLOYMENT.md's Troubleshooting section](DEPLOYMENT.md#troubleshooting). It's also worth just
  retrying once (`railway up ...` again) — we saw this exact symptom from what looked like a
  one-off builder assignment issue before finding the actual `.dockerignore` cause, so a flaky
  infrastructure hiccup isn't impossible either.
- **Build succeeds, but `railway status` shows `CRASHED` instead of `RUNNING`.** Check
  `railway logs --deployment <id>` for the actual crash — this is a *runtime* error (the container
  started but the app itself failed), different from a build failure. We hit this once because a
  file referenced by `require()` wasn't included in what the `Dockerfile` copied into the image.
- **Can't tell what's wrong from the logs at all.** `railway logs --build <deployment-id>` (build
  logs) and plain `railway logs --deployment <id>` (runtime logs) are different things — make sure
  you're looking at the right one for the stage that's actually failing.

## A harmless warning you'll see in the logs

Every startup currently logs this:

```
WARN [io.quarkus.runtime.configuration.ConfigRecorder] (main) Build time property cannot be
changed at runtime: - quarkus.datasource.db-kind is set to 'postgresql' but it is build time
fixed to 'null'.
```

This looks alarming but isn't currently causing problems — everything works (we verified this
directly: uploads, assignments, and scoring all function correctly). What's happening: Quarkus
(the framework `codecheck-webapp` is built on) wants to know which database driver to use at
*build* time, but we're supplying it as a *runtime* environment variable
(`QUARKUS_DATASOURCE_DB_KIND`) instead. It currently works anyway because there's only one
database driver in the project (Postgres), so it has nothing else to guess between. If a second
database driver were ever added to the project, this ambiguity could start actually mattering. The
proper fix is to add `quarkus.datasource.db-kind=postgresql` directly to
`src/main/resources/application.properties` so it's baked in at build time instead of supplied at
runtime — we haven't made that change since it wasn't necessary to get things working, but it'd be
a good small cleanup.

## Costs

Both services are billed by Railway based on usage (compute time, not per-request), plus the
Postgres database's storage. We haven't set a spending cap — check Railway's dashboard billing
page if you want to set one, especially before advertising the deployment widely to a class.
