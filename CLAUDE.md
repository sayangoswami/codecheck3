# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

CodeCheck is an automated grading system for programming exercises, used from LTI-integrated LMS assignments and standalone problem submissions. This repo (`codecheck3`) is the successor to `codecheck2`: the checking logic is a framework-independent service layer, and the web app is a thin Quarkus (Java 25) layer on top of it. It has three deployable parts:

- **`codecheck-webapp`** (`src/main/java`) — the Quarkus web app: displays problems, collects/stores submissions and assignments, manages instructor problem uploads, and implements the LTI protocol for LMS integration.
- **`comrun`** (`comrun/`) — a separate sandboxed service that actually compiles and runs submitted/solution code (in an isolated OS user) and returns results as a zip. See `comrun/bin/comrun` for the script-based protocol it implements (`prepare`, `compile`, `run`, `unittest`, `process`, `collect` directives).
- **`cli/codecheck`** — a command-line wrapper for running the checker locally (against a local or remote `comrun`) without the web app.

## Common commands

```bash
# Build everything (webapp jar), skipping tests
mvn package -Dmaven.test.skip

# Run the full test suite (Quarkus integration tests, requires comrun/local storage set up)
mvn test

# Run a single test class or method
mvn test -Dtest=StudentTest
mvn test -Dtest=StudentTest#testCheckNJS

# Run the webapp in dev mode (hot reload), needs COMRUN_USER set to your OS user
COMRUN_USER=$(whoami) mvn quarkus:dev
# then visit http://localhost:8080/assets/uploadProblem.html

# Run the CLI checker against a sample problem (text report)
cli/codecheck -t samples/java/example1

# Run the CLI checker against a submission + problem dir pair
cli/codecheck submissiondir problemdir
```

Full local environment setup (installing the `comrunner` OS user, `/opt/codecheck`, `comrun` dependencies, IntelliJ/VS Code debug configs, Docker/Podman builds, and AWS deployment steps for App Runner/S3/DynamoDB) is documented in `build-instructions.md` — consult it rather than re-deriving the setup.

## Architecture

### Checking engine (`com.horstmann.codecheck.checker`, `com.horstmann.codecheck.language`, `com.horstmann.codecheck.report`)

This is the framework-independent core, usable standalone via `cli/codecheck` or embedded in the webapp via `services.Check`.

- **`checker.Main`** is the entry point: given a submission directory and a problem directory, it builds a `Plan` of compile/run tasks, executes them (delegating actual compilation/execution to `comrun`), compares actual vs. expected output via `Comparison`, and accumulates a `Score`.
- **`checker.Problem`** models a problem definition (`.java`/etc. source with `//CALL`, `//HIDE`, `//SHOW`, `//EDIT`, `//SUB` pseudo-comments, unit testers, sample solutions).
- **`language.Language`** is the per-language plugin interface (one implementation per supported language, registered in the static `Language.languages` array in `Language.java`). Each `Language` knows its file extension, how to detect "main"/tester files, how to generate CALL-style testers, unit-test success/failure regexes, and compiler error-message patterns. Adding a new language means implementing this interface and adding it to the array — check `samples/<language>` for example problems in each supported language.
- **`report.Report`** (and `HTMLReport`/`JSONReport`/`NJSReport`/`TextReport`/`SetupReport`) render results in different formats depending on how the checker was invoked (browser, CLI text, JSON API, JS client).
- The actual compiling/running of untrusted code never happens in this JVM process — it's always delegated to the `comrun` shell script (locally or over HTTP via `com.horstmann.codecheck.comrun.remote`), which runs code as a separate restricted OS user (`COMRUN_USER`, default `comrunner`) for sandboxing.

### Web app (`controllers`, `services`)

- **`controllers/*`** are the Quarkus JAX-RS REST endpoints (`CheckController`, `AssignmentController`, `UploadController`, `FilesController`, `LTIAssignmentController`, `LTIProblemController`, `Health`). They are thin — they parse HTTP requests and delegate to `services/*`.
- **`services/*`** hold the actual business logic: `Check` (runs the checker engine and streams results), `CodeCheck` (problem retrieval/caching), `Assignment`/`LTIAssignment`/`LTIProblem` (assignment and LTI grade-passback logic), `Upload` (instructor problem upload), `JWT` (auth tokens), `Files`.
- **`services.StorageConnector`** is the persistence abstraction with three interchangeable backends selected by `com.horstmann.codecheck.storage.type` config (`local` (filesystem, default for dev), `aws` (S3 for problem zips + DynamoDB for assignments/work/submissions/comments/LTI credentials), `sql` (Postgres, simpler single-database alternative to AWS)). All three implement the same `StorageConnection` interface — read the big comment block at the top of `StorageConnector.java` before touching storage code, it documents the ID scheme (assignmentID/workID/ccid/editKey, LTI vs non-LTI identifiers) and every table's schema/semantics in detail.
- Configuration is read through `controllers.Config`, backed by `src/main/resources/application.properties` (and an untracked `application-prod.properties`/`application-prod.conf` for production secrets — never commit these).

### Samples

`samples/<language>/<problem>` directories are real example problems (one per supported language, plus `param`/`parsons` for parameterized/Parsons-style problems) used both as manual test fixtures for the CLI and as reference material for problem-authoring pseudo-comment syntax (`//CALL`, `//HIDE`, `//SHOW`, `//EDIT`, `//SUB`).

### Tests

`src/test/java/com/horstmann/codecheck/test/` contains `@QuarkusTest` integration tests (`StudentTest`, `InstructorTest`) that exercise the REST endpoints end-to-end (e.g. posting a submission to `/checkNJS` and asserting on the returned score), plus `TestUtil` with shared HTTP/JSON helpers. These need a working local storage/comrun setup to pass, same as `quarkus:dev`.
