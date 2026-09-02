# Deploying CodeCheck

This is a from-scratch guide for putting CodeCheck on the internet so students can use it. It
assumes **no prior deployment experience** — every term is explained the first time it's used.

If you're specifically updating our existing Railway deployment (not setting up a new one), skip
to [RAILWAY.md](RAILWAY.md) instead — this document is for setting up a *new* deployment, on any
host.

## What you're actually deploying

CodeCheck isn't one program — it's three pieces that talk to each other over the internet:

1. **`codecheck-webapp`** — the main web application. This is what students and you (the
   instructor) actually visit in a browser: it shows problems, collects submissions, manages
   assignments. This is the code at the root of this repository.
2. **`comrun-java`** (in the `comrun-java/` folder) — a small, separate service whose only job is
   to compile and run the Java code students submit. `codecheck-webapp` sends it a submission and
   gets back a pass/fail result. It's kept separate deliberately, so that running (potentially
   buggy) student code happens in its own isolated place.
3. **A Postgres database** — where assignments, submissions, and scores are permanently stored.
   `codecheck-webapp` talks to this directly; `comrun-java` doesn't touch it at all.

They're deployed as three separate things, but only `codecheck-webapp` needs to be reachable by
students directly. `comrun-java` and Postgres just need to be reachable *by `codecheck-webapp`*.

## Before you start: two things every host needs to support

Any hosting provider works for this, as long as it can do two things:

- **Build and run a Docker container from a `Dockerfile`.** A `Dockerfile` is just a recipe: "start
  from this base system, install these things, run this command." Both `codecheck-webapp` and
  `comrun-java` already have one written (`src/main/docker/Dockerfile.jvm` and
  `comrun-java/Dockerfile`), so you won't be writing one yourself. The hosting platform's job is
  just to build it and keep the resulting container running.
- **Give you a Postgres database, and let you set environment variables.** An *environment
  variable* is just a named piece of configuration (like a password or a URL) that you hand to a
  running container from outside it, rather than writing it into the code. This is how you'll tell
  `codecheck-webapp` where its database is, without that password ever being stored in the
  repository.

Providers that offer both of these (as of writing): Railway, Render, Fly.io, DigitalOcean App
Platform, and plain virtual machines running Docker yourself (see the
[self-hosting appendix](#appendix-self-hosting-with-docker-compose) below). We used Railway for our
own deployment — see [RAILWAY.md](RAILWAY.md) — but nothing below is Railway-specific.

## Part A — Deploy `comrun-java` first

Deploy this one first because `codecheck-webapp` needs its address before it can start.

1. Point your hosting provider at the `comrun-java/` folder as the thing to build and deploy. Tell
   it to use the `Dockerfile` inside that folder (most providers auto-detect a `Dockerfile` if you
   give them the right folder as the "root directory" or "build context").
2. It needs no configuration/environment variables — the defaults work out of the box. If your
   host requires you to specify a port explicitly, it listens on the port given by the `PORT`
   environment variable, or `8080` if none is set.
3. Once it's deployed, your host will give it a public URL, e.g. `https://something.example.com`.
   **Write this down** — you'll need it in Part C.
4. Verify it's alive: visit `https://your-comrun-java-url/api/health` in a browser. You should see
   `{"status":"ok"}`.

## Part B — Set up Postgres and its schema

1. Provision a Postgres database from your hosting provider (most have a one-click "Add Database"
   or "Add Postgres" button; sometimes it's a separate provider like Neon or Supabase — that's
   fine too, as long as you get standard connection details out of it).
2. From it, collect four pieces of information: **host**, **port** (almost always `5432`),
   **database name**, **username**, and **password**. Every provider shows these somewhere in its
   dashboard, sometimes bundled together as one "connection string" that looks like
   `postgresql://user:password@host:port/database`.
3. Now you need to create the tables CodeCheck expects. Connect to the database with any Postgres
   client — `psql` (a command-line tool), or a GUI app like TablePlus, DBeaver, or pgAdmin all
   work identically for this — and run exactly this:

   ```sql
   CREATE TABLE Problems (repo VARCHAR, key VARCHAR, contents BYTEA, PRIMARY KEY (repo, key));
   CREATE TABLE CodeCheckAssignments (assignmentID VARCHAR PRIMARY KEY, json VARCHAR);
   CREATE TABLE CodeCheckLTICredentials (oauth_consumer_key VARCHAR PRIMARY KEY, shared_secret VARCHAR);
   CREATE TABLE CodeCheckComments (assignmentID VARCHAR, workID VARCHAR, comment VARCHAR, UNIQUE (assignmentID, workID));
   CREATE TABLE CodeCheckWork (assignmentID VARCHAR, workID VARCHAR, submittedAt VARCHAR, json VARCHAR, UNIQUE (assignmentID, workID));
   CREATE TABLE CodeCheckSubmissions (submissionID VARCHAR, submittedAt VARCHAR, json VARCHAR);
   ```

   (`CodeCheckLTICredentials` is only used if you connect CodeCheck to an LMS like Blackboard or
   Canvas via LTI — safe to create even if you're not using that.)

   If your host has a built-in query console in its dashboard (many do), you can paste this there
   instead of installing a separate client.

## Part C — Deploy `codecheck-webapp`

1. Point your hosting provider at the **repository root** as the build context, but tell it to use
   the Dockerfile at `src/main/docker/Dockerfile.jvm` specifically (not the repo-root
   `Dockerfile.jvm` — there isn't one at the root; it lives in that subfolder). Every host has a
   slightly different way to say "use this specific Dockerfile path" — on Railway it's a
   `railway.toml` file (see [RAILWAY.md](RAILWAY.md)); other hosts have an equivalent field in
   their dashboard or their own config file format. Look for something like "Dockerfile path" or
   "Dockerfile location" in your host's build settings.
2. Set these environment variables on the service:

   | Variable | Value | What it's for |
   |---|---|---|
   | `COM_HORSTMANN_CODECHECK_STORAGE_TYPE` | `sql` | Tells the app to use Postgres instead of the local filesystem. This is **required** — most hosting platforms wipe a container's local disk on every restart/redeploy, so without this, all assignments and student work would vanish the next time the app restarts. |
   | `QUARKUS_DATASOURCE_DB_KIND` | `postgresql` | Tells it what kind of database it's talking to. |
   | `QUARKUS_DATASOURCE_JDBC_URL` | `jdbc:postgresql://HOST:PORT/DATABASE` | Built from the host/port/database name you collected in Part B. Note the `jdbc:` prefix — this is a different format from the `postgresql://...` connection string your database provider probably showed you. |
   | `QUARKUS_DATASOURCE_USERNAME` | (from Part B) | Database username. |
   | `QUARKUS_DATASOURCE_PASSWORD` | (from Part B) | Database password. Keep this secret — never put it directly in a file you commit to git. |
   | `com.horstmann.codecheck.jwt.secret.key` | a long random string | Used to sign internal tokens. Generate one with `openssl rand -base64 48` in a terminal, or any password generator set to 40+ characters. It doesn't need to be memorable, just random and unique to your deployment. |
   | `COM_HORSTMANN_CODECHECK_COMRUN_REMOTE` | `https://your-comrun-java-url/api/upload` | The URL from Part A, with `/api/upload` appended. Only set this if you're deploying your *own* `comrun-java` — the repository's `application.properties` already defaults to our shared one, so you can skip this variable entirely if you're fine using that (see [RAILWAY.md](RAILWAY.md) for what's currently live there). |

   A note on the variable name style: most of these look like `QUARKUS_DATASOURCE_JDBC_URL`
   (uppercase with underscores) because that's the standard way environment variables work, but
   one — `com.horstmann.codecheck.jwt.secret.key` — is written with lowercase and dots. Both forms
   work; the underlying app framework (Quarkus) accepts either style, and we're just following
   whatever convention was already used for that particular setting. Type it exactly as shown.

3. Deploy. This one takes longer than `comrun-java` to build (it's compiling a full Java
   application), typically 30–90 seconds.
4. Your host will give you a public URL. That's the address students (and you) will use.

## Part D — Verify everything actually works

Don't skip this — it catches problems while you still remember what you just changed.

1. Visit `https://your-webapp-url/assets/uploadProblem.html`. You should see a simple upload form,
   not an error page.
2. Try uploading a tiny test problem. If you don't have one handy, create a file called
   `Numbers.java` with this content, zip it up (just that one file), and upload the zip:

   ```java
   public class Numbers
   {
      //CALL 3, 4
      public double average(int x, int y)
      {
         //HIDE
         return 0.5 * (x + y);
         //SHOW // Compute the average of x and y
      }
   }
   ```

   You should get back a page with a "Public URL" and "Edit URL", plus an embedded report showing
   the problem ran and passed. If this works, `codecheck-webapp` → `comrun-java` is wired up
   correctly.
3. Visit `https://your-webapp-url/newAssignment`, paste the Public URL from step 2 into the
   problems box, and save. This creates an assignment. Visit the assignment's public link, type any
   ID, and confirm you land on the actual problem page. If this works, `codecheck-webapp` →
   Postgres is wired up correctly (the assignment had to be *saved* somewhere for this to work).

If all three checks pass, you're done — this is a fully working deployment.

## Reference: all environment variables `codecheck-webapp` understands

Beyond what's needed for a basic deployment (Part C above), these exist if you need them later.
None are required to get started.

| Variable | Default | Purpose |
|---|---|---|
| `COM_HORSTMANN_CODECHECK_STORAGE_TYPE` | `local` | `sql` for Postgres (recommended for any real deployment), `aws` for S3 + DynamoDB (see `build-instructions.md` if you specifically want this — more setup, but it's what the original project documents most thoroughly), or leave unset for local-filesystem storage (only useful for testing on your own laptop). |
| `COM_HORSTMANN_CODECHECK_COMRUN_REMOTE` | our shared `comrun-java` | Where to send code to compile/run. |
| `COM_HORSTMANN_CODECHECK_QID_PATTERNS` | unset (bare ids rejected) | Comma-separated `printf` patterns (`%s` = problem id) for resolving assignment problems given by bare id instead of full URL. Must be the public origin, e.g. `https://codecheck.example.com/files/%s` — the resolved URL is loaded as an iframe `src` in the student's browser. |
| `COM_HORSTMANN_CODECHECK_JWT_SECRET_KEY` (or the dotted form, see Part C) | `changeme` | Must be overridden for any real deployment. |
| `COM_HORSTMANN_CODECHECK_ADMIN_PASSWORD` | unset (feature disabled) | Enables the `POST /deleteProblems` batch problem delete — see "Deleting problems and assignments" below. |

## Deleting problems and assignments

There is no delete button in the web UI. Deletion is done over HTTP, and in
every case you must present a secret you already hold — either the **edit key**
that was printed when the item was created, or (for the batch problem endpoint)
the server-wide **admin password**. Helper scripts live in `tools/`
(`pip install -r tools/requirements.txt`; set `CODECHECK_HOST` to your server's
base URL).

### One problem

```
DELETE /private/problem/{problemID}/{editKey}
```

Authorised by that problem's own edit key — the key in the edit URL
`.../private/problem/<id>/<editKey>` that `tools/upload_problems.py` records.
No admin password needed.

```bash
# pairs.txt: one "<problemID> <editKey>" per line
CODECHECK_HOST=https://codecheck.example.com tools/delete_problems.py pairs.txt
```

### Many problems at once (admin password)

```
POST /deleteProblems
X-Admin-Password: <secret>
body: one problem id per line   (blank lines and '#' comments ignored)
```

Requires `COM_HORSTMANN_CODECHECK_ADMIN_PASSWORD` to be set on the server;
unset = the endpoint is disabled. Use this when you don't have the individual
edit keys. Response is `200` if all ids were deleted, `207` if some failed
(each failure is listed), `403` on a bad/absent password.

```bash
# ids.txt: one problem id per line
CODECHECK_HOST=https://codecheck.example.com \
CODECHECK_ADMIN_PASSWORD=… \
  tools/delete_problems.py ids.txt
```

### One assignment

```
DELETE /private/assignment/{assignmentID}/{editKey}
```

Authorised by the assignment's (non-LTI) edit key — the key in the private
assignment URL `.../private/assignment/<assignmentID>/<editKey>` shown to the
instructor when the assignment is created. Returns `200` on success, `403` on
a bad key, `404` if no such assignment exists.

This removes only the assignment definition; any student work, submissions and
comments already stored for it are left in place (harmless, but if you want a
clean sweep, delete the matching `CodeCheckWork` / `CodeCheckSubmissions` /
`CodeCheckComments` rows too — for local storage those are directories under
the storage root).

There is no batch/admin variant for assignments.

```bash
# pairs.txt: one "<assignmentID> <editKey>" per line
CODECHECK_HOST=https://codecheck.example.com tools/delete_assignments.py pairs.txt
```

## Appendix: self-hosting with Docker Compose

If you're renting a plain Linux server (a "VPS" — e.g. a DigitalOcean Droplet or similar) rather
than using a PaaS like Railway, `docker compose` is the standard way to run multiple containers
(the webapp, `comrun-java`, and Postgres) together on one machine. Assuming Docker is already
installed on the server, create a file called `docker-compose.yml` in the repository root:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: choose-a-real-password-here
      POSTGRES_DB: codecheck
    volumes:
      - postgres-data:/var/lib/postgresql/data

  comrun-java:
    build: ./comrun-java

  codecheck-webapp:
    build:
      context: .
      dockerfile: src/main/docker/Dockerfile.jvm
    ports:
      - "8080:8080"
    environment:
      COM_HORSTMANN_CODECHECK_STORAGE_TYPE: sql
      QUARKUS_DATASOURCE_DB_KIND: postgresql
      QUARKUS_DATASOURCE_JDBC_URL: jdbc:postgresql://postgres:5432/codecheck
      QUARKUS_DATASOURCE_USERNAME: postgres
      QUARKUS_DATASOURCE_PASSWORD: choose-a-real-password-here
      COM_HORSTMANN_CODECHECK_COMRUN_REMOTE: http://comrun-java:8080/api/upload
      com.horstmann.codecheck.jwt.secret.key: some-long-random-string
    depends_on:
      - postgres
      - comrun-java

volumes:
  postgres-data:
```

(Inside Docker Compose, containers can reach each other by service name — `postgres` and
`comrun-java` above — instead of needing public URLs, which is why those look different from the
PaaS instructions.) Then apply the schema from Part B (`docker compose exec postgres psql -U
postgres -d codecheck` gets you a SQL prompt inside the running database container), and start
everything with `docker compose up -d`. You're responsible for HTTPS/domain setup yourself in this
scenario (typically via a reverse proxy like Caddy or nginx in front) — PaaS providers usually give
you that for free, which is the main convenience they add over this approach.

## Appendix: exposing the interactive Java runner for Quarto slides

`comrun-java` has a second job beyond the codecheck grading protocol: `server.js` also serves
`POST /run/java` and a WebSocket at `/run/java/ws` (code in `comrun-java/lib/interactive.js`).
These compile and run a single ad-hoc Java class with live stdin — the backend for a "Run this
snippet" button in lecture material. The `java-runner` Quarto extension (a Lua filter + CodeMirror editor, kept in the course
material repo under `_extensions/java-runner/`) talks to `/run/java/ws` with exactly this
protocol, so `{.java .runnable}` code blocks in Quarto/RevealJS slides become runnable with no
code changes on either side.

Nothing extra is needed for grading — only for these interactive routes, and only if you want
them reachable from a browser. The committed `docker-compose.yml` keeps `comrun-java` off every
published port by default; batch grading reaches it container-to-container over the
`codecheck-internal` network. To expose the interactive routes:

1. **Publish `comrun-java` on a loopback port.** In `docker-compose.yml`, give the `comrun-java`
   service a `ports:` entry and put it on a non-`internal` network (port publishing needs a
   route from the host):

   ```yaml
   comrun-java:
     ports:
       - "127.0.0.1:8081:8080"   # loopback only — the tunnel connects locally
     networks:
       - codecheck-internal
       - default
   ```

   Keep the bind on `127.0.0.1` so the port is never on the host's LAN or the internet — only
   whatever you point at it locally (a tunnel or reverse proxy) decides what's public.

2. **Route a hostname to it.** Our deployment fronts everything with a named Cloudflare Tunnel
   (`cloudflared`, running as a `systemctl --user` service — no root). Add an ingress rule in
   `~/.cloudflared/config.yml`, above the required `http_status:404` catch-all:

   ```yaml
   ingress:
     - hostname: java-runner.example.dev
       service: http://localhost:8081
     # ...existing rules...
     - service: http_status:404
   ```

   Then create the DNS record and restart the tunnel:

   ```bash
   cloudflared tunnel route dns <tunnel-name> java-runner.example.dev
   systemctl --user restart cloudflared
   podman compose up -d comrun-java   # recreate with the new port
   curl -sN https://java-runner.example.dev/api/health   # expect {"status":"ok"}
   ```

   Cloudflare Tunnel proxies WebSockets automatically, so `/run/java/ws` works through it with
   no extra config. A plain nginx/Caddy reverse proxy works too — it just needs the usual
   `Upgrade`/`Connection` headers for the WebSocket path.

3. **Point the slides at the hostname.** In the Quarto project's `_quarto.yml`:

   ```yaml
   filters:
     - java-runner
   java-runner:
     server-url: "https://java-runner.example.dev"
   ```

   The filter rewrites `https`→`wss` itself, so it connects to
   `wss://java-runner.example.dev/run/java/ws`.

**Things to know about the interactive routes:**

- They have **no OS-user or container sandbox** — the only guard is a static source scan
  (`comrun-java/lib/blacklist.js`) that rejects `Runtime`, `ProcessBuilder`, `Thread`,
  `java.net`, reflection, `System.exit`, etc. before `javac` runs, plus the container hardening
  in `docker-compose.yml` (`read_only`, `cap_drop: ALL`, `no-new-privileges`, `mem_limit`,
  `pids_limit`). This is aimed at intro courses, not adversarial input. Expose the hostname
  deliberately.
- Per-run limits (in `interactive.js`): 10 s to compile, 120 s wall-clock to run, 128 MB heap,
  headless (no Swing/AWT windows).
- Rate limit is **30 requests/minute per client IP**, shared with the `/api/upload` grading
  endpoint (`RATE_LIMIT` in `comrun-java/server.js`). Fine for an instructor clicking Run during
  a lecture; a whole class running snippets from behind one campus NAT will share that budget —
  raise it there if needed.

## Appendix: a GPU instance for numba-cuda / CuPy

For a course whose problems use `numba.cuda` or CuPy, run a **second, self-contained CodeCheck
instance** next to the main one. Nothing in the main stack changes; the GPU stack has its own
webapp, its own comrun, its own storage volume, its own loopback port, and its own hostname.
Keeping it separate means untrusted CUDA code only ever touches the GPU box, and the main
courses are unaffected if the GPU instance needs a restart.

The checker engine already treats Python as first-class (`PythonLanguage`); `numba`/`cupy` are
just imports, so no engine changes are needed. `comrun-java` can't help here (Java only), so the
GPU instance uses the original bash `comrun` engine (which already handles Python) in a
CUDA-enabled image, behind a small concurrency-gating gateway.

Files: `comrun-gpu/` (Dockerfile + `server.js` gateway) and `docker-compose.gpu.yml`.

### Step 1 — GPU passthrough to rootless podman

The container gets the GPU through the **NVIDIA Container Toolkit** using **CDI** (Container
Device Interface), which is the mechanism that works cleanly with *rootless* podman — no
`--privileged`, no root daemon. The host needs a working NVIDIA driver already (`nvidia-smi`
runs). Then, as admin:

```bash
# 1. Add the toolkit repo and install it
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit

# 2. Generate the CDI spec describing this host's GPUs.
#    nvidia-ctk 1.20 emits `cdiVersion: 0.7.0` (it adds device-level
#    `additionalGids` for /dev/dri). podman < 5.0 (Ubuntu 24.04 ships 4.9.3)
#    only loads specs up to 0.6.0 and rejects the whole file ("unresolvable
#    CDI devices" / "spec version must be at least v0.7.0"). The helper below
#    drops the /dev/dri GIDs (not needed for CUDA compute) and relabels the
#    spec 0.6.0. (Older nvidia-ctk had --cdi-version; 1.20 dropped it.)
sudo mkdir -p /etc/cdi
comrun-gpu/make-cdi-spec.sh | sudo tee /etc/cdi/nvidia.yaml > /dev/null
sudo rm -f /run/cdi/nvidia.yaml /var/run/cdi/nvidia.yaml   # drop any stale 0.7.0 copy

# 3. (rootless only) let the toolkit skip cgroup setup it can't do unprivileged
sudo nvidia-ctk config --in-place --set nvidia-container-cli.no-cgroups=true
```

(On a future podman ≥ 5.0, skip the helper — `sudo nvidia-ctk cdi generate
--output=/etc/cdi/nvidia.yaml` is enough.)

Then, as **your normal user** (no sudo), verify:

```bash
nvidia-ctk cdi list          # should list  nvidia.com/gpu=all  and per-index devices
podman run --rm --device nvidia.com/gpu=all \
  nvidia/cuda:13.0.1-base-ubuntu24.04 nvidia-smi   # should print the GPU table
```

Re-run `comrun-gpu/make-cdi-spec.sh | sudo tee /etc/cdi/nvidia.yaml` after any host driver
upgrade — the spec pins driver library paths (they contain the driver version).

### Step 2 — build and start the GPU stack

Use **`podman-compose`** (the standalone `/usr/bin/podman-compose`, not `podman compose`) for
this stack. `podman compose` shells out to `docker-compose`, which rewrites the CDI device name
`nvidia.com/gpu=all` into a `src:dst:rwm` triple that podman can't resolve; `podman-compose`
passes it straight through to `podman run --device`.

```bash
cd ~/Repos/codecheck3
podman-compose -f docker-compose.gpu.yml up -d --build

# sanity-check the GPU stack: kernel compiler + CuPy visible to the run user
podman-compose -f docker-compose.gpu.yml run --rm comrun-gpu \
  sudo -u comrunner python3 -c "import cupy, numba.cuda; print(numba.cuda.detect())"
```

(The main `docker-compose.yml` has no GPU device line, so it stays on `podman compose` as
before — only this GPU stack needs `podman-compose`.)

The CUDA version in `comrun-gpu/Dockerfile` (`nvidia/cuda:13.0.1-devel-…`, `cupy-cuda13x`) must
be **≤ the “CUDA Version” shown by `nvidia-smi`** on the host (13.2 here). Bump the tag and the
cupy wheel together (keep them on the same major) if your driver changes.

### Step 3 — give it a hostname

Same as any other service fronted by the tunnel (see the Quarto appendix for the mechanics).
Add to `~/.cloudflared/config.yml`, above the catch-all:

```yaml
  - hostname: gpu-codecheck.example.dev
    service: http://localhost:8082
```

```bash
cloudflared tunnel route dns <tunnel-name> gpu-codecheck.example.dev
systemctl --user restart cloudflared
curl -s https://gpu-codecheck.example.dev/health   # webapp health
```

### Step 4 — smoke-test the deployment

`samples/python/gpu-smoke/` is a problem that launches a `numba.cuda` kernel *and* does a CuPy
reduction. Upload it through the instructor UI (or the CLI against `http://localhost:8082`) and
check it grades green — that exercises kernel launch, host/device transfer, and CuPy in the real
`comrun-gpu` container.

### Concurrency cap

One in-flight job ≈ one Python process ≈ one CUDA context (~300–600 MB VRAM *before* any data).
A class submitting at once would otherwise spawn dozens at once and exhaust the card. The
`comrun-gpu/server.js` gateway limits this:

| env var (set in `docker-compose.gpu.yml`) | default | meaning |
|---|---|---|
| `COMRUN_MAX_CONCURRENCY` | `3` | jobs running at once; raise toward `VRAM / 0.6 GB` minus headroom |
| `COMRUN_MAX_QUEUE` | `30` | waiters allowed to queue before clients get `503` |
| `COMRUN_QUEUE_TIMEOUT_MS` | `45000` | how long a queued request waits before `503` |
| `COMRUN_JOB_TIMEOUT_MS` | `75000` | hard cap on a single `comrun` invocation |

The webapp's HTTP client to comrun (`checker.Util.fileUpload`) has a **hard 90-second timeout**,
so `COMRUN_QUEUE_TIMEOUT_MS + COMRUN_JOB_TIMEOUT_MS` must stay under that — keep problem run
timeouts modest. `GET /api/health` on `comrun-gpu` reports `active` and `queued` so you can watch
it during an exam. A `503` (or a client-side timeout) surfaces to the student as a checker error,
not a silent failure — they just click *Submit* again once the queue drains.

### Things to know

- **Weaker sandbox than `comrun-java`.** The bash `comrun` engine uses `sudo` to drop to the
  `comrunner` OS user, so this image *cannot* use `cap_drop: ALL` / `no-new-privileges`.
  Isolation is the unprivileged `comrunner` user + the container `mem_limit`/`pids_limit`/`cpus`
  + `preload.sh`'s `ulimit` on file size. There is **no** source blacklist. Treat it as "runs
  code from enrolled students during a proctored exam", not "internet-facing".
- **`preload.sh` ulimit patch.** The Dockerfile `sed`s the `ulimit -d/-v/-n` caps out of
  `preload.sh` (keeping only the file-size cap), because CUDA reserves tens of GB of *virtual*
  address space on context creation and the stock ~100 MB `-v` cap makes every GPU program fail
  instantly. Real memory is bounded by the container `mem_limit` instead.
- **GPU memory isn't limited by `mem_limit`** (that's host RAM). Capping VRAM per job needs CUDA
  MPS or MIG — out of scope; the concurrency cap is the practical control.
- **A hung/faulting kernel can wedge the GPU** until `podman-compose -f docker-compose.gpu.yml
  restart comrun-gpu` (or, rarely, a host GPU reset). Keep problem sizes small and timeouts
  tight.

## Troubleshooting

Problems we actually hit while setting up our own deployment, in case they recur:

- **Build fails instantly, before any real build output appears.** Check your `.dockerignore`
  file (at the repository root) isn't excluding files the Dockerfile needs. Ours originally
  excluded *everything* except a pre-built folder that only exists after running Maven locally —
  fine for local testing, broken for a host building fresh from the repository. If you see a build
  fail in well under a second with no useful log output, this is worth checking first.
- **App builds and starts, but every page 500s or scores never save.** Almost always means
  `COM_HORSTMANN_CODECHECK_STORAGE_TYPE=sql` wasn't set, or the datasource variables have a typo.
  Double check the JDBC URL starts with `jdbc:postgresql://`, not `postgresql://` or `postgres://`
  (the format your database provider shows you is usually the latter — you have to convert it).
- **`UnsupportedClassVersionError` or similar at startup.** The Docker image's Java version doesn't
  match what the project was compiled for. This repo targets Java 25 throughout — if you're
  customizing the Dockerfile, keep both the build stage and run stage on Java 25.
- **GPU instance: `numba.cuda` finds no device but `nvidia-smi` works in the container.** Almost
  always a `/dev/nvidia*` permission issue for the unprivileged `comrunner` user. The Dockerfile
  adds `comrunner` to the `video` group; if the CDI spec created the device nodes with a
  different owner, regenerate it (`sudo nvidia-ctk cdi generate`) or check the node modes.
- **GPU instance: `unresolvable CDI devices` / `nvidia-ctk cdi list` warns "spec version must be
  at least v0.7.0" and finds 0 devices.** podman 4.9 can't load nvidia-ctk 1.20's 0.7.0 spec.
  Install the spec via `comrun-gpu/make-cdi-spec.sh` (step 2), which strips the one 0.7.0-only
  field. If `nvidia-ctk cdi list` just says "Found 0 CDI devices" with no warning, no spec is
  installed at all — same fix. Remove stale copies under `/run/cdi/` too.
- **GPU instance: `nvidia-container-cli: ... cgroup` error on rootless podman.** Run
  `sudo nvidia-ctk config --in-place --set nvidia-container-cli.no-cgroups=true` and retry.
- **GPU instance: `nvidia-smi` fails inside the container.** If you used `podman compose` (the
  docker-compose provider) instead of `podman-compose`, it mangled the `nvidia.com/gpu=all`
  device name. Use `podman-compose -f docker-compose.gpu.yml up -d` for this stack.
- **GPU instance: image build fails at the `sed ... preload.sh` step.** That step strips
  `preload.sh`'s `ulimit -v`/`-n` caps (CUDA needs tens of GB of *virtual* address space) and
  then asserts none survived. If upstream changed the `ulimit` line format the assertion trips —
  update the `sed` pattern in `comrun-gpu/Dockerfile` to match the new lines.
