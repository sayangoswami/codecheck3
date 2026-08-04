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
| `COM_HORSTMANN_CODECHECK_JWT_SECRET_KEY` (or the dotted form, see Part C) | `changeme` | Must be overridden for any real deployment. |

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
