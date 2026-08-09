# CodeCheck code-tracing problem authoring reference

This documents how to author a **tracer problem** — an interactive exercise
where a student steps through a program's execution, selecting the next line
to run and predicting/filling in variable values, array/pointer changes, or
console output — in this repo (`codecheck3`). Tracer problems are a
completely different mechanism from the pseudo-comment-based problems
described in `CODE_AUTHORING.md` and `PARSONS_PUZZLES.md`: there is no
compiling or running of student code, no `//CALL`/`//IN` grading, and no
"submission" in the usual sense. Everything happens client-side, in the
browser, via a small scripting API.

Cross-checked against the public reference at
https://horstmann.com/codecheck/tracer.html, the real example in
`samples/java/tracer1/`, and this repo's server-side handling in
`src/main/java/com/horstmann/codecheck/checker/Problem.java`,
`src/main/java/com/horstmann/codecheck/services/{Files,Upload,LTIProblem}.java`,
and the client widget at
`src/main/resources/META-INF/resources/assets/tracer/script/codecheck_tracer.js`.

## The core idea

A tracer problem is **not graded by running code**. Instead, the author
writes a JavaScript *generator function* that plays the role of a scripted
walkthrough: it draws the source code and some visual state (variable
frames, objects, arrays, a terminal, ...), then repeatedly `yield`s a "step"
that pauses and waits for the student to do something — click the next line
to execute, type in a variable's new value, draw a pointer, predict console
output, etc. Each `yield` is a scored interaction point; everything between
two `yield`s runs instantly and is *not* shown as a step to the student (use
it to update the visual state programmatically, the way a debugger would
after you click "step over").

This is fundamentally an author-scripted simulation of program execution,
not a static answer key — you are directing a movie of the trace, and the
student has to correctly predict/perform each frame transition.

## File shape

A tracer problem directory contains:

- **`tracer.js`** — the exercise script (required; its mere presence is what
  marks the directory as a tracer problem — see "How detection works"
  below).
- **`index.md`** — the problem description/instructions shown above the
  tracer widget, written in Markdown. When uploading via
  `tools/upload_problems.py`, the script converts `index.md` to `index.html`
  automatically. **Do not put `index.html` directly in the directory** — the
  upload script detects problem directories by looking for `index.md`, and a
  directory with only `index.html` is silently skipped. If you're deploying
  a problem zip manually (not via the upload script), you can include
  `index.html` directly instead.
- **A placeholder source file** (e.g. `Placeholder.java`) — an otherwise
  empty file whose only job is to have the right extension so CodeCheck's
  language detection succeeds. It is never compiled or run. Copy this
  pattern verbatim for any language:
  ```java
  public class Placeholder {
  }
  ```
- No `check.properties` or `param.js` needed — tracer problems have their
  own self-contained randomization (see "Randomization" below) and aren't
  fed through the normal annotation/compile pipeline at all.

## How detection and rendering work in this repo (context, not authoring syntax)

- A problem directory is treated as a tracer problem purely because it
  contains a file literally named `tracer.js`
  (`Problem.java`: `problemFiles.containsKey(Path.of("tracer.js"))`, checked
  in `services/Files.java`, `services/Upload.java`,
  `services/LTIProblem.java`). There is no separate "type" field to set.
- `tracer.js`, `index.html`, `param.js`, and `check.properties` are all
  excluded from the normal solution/support-file scanning in
  `Problem.java` — `tracer.js` is never treated as source code to compile.
- Normally a problem with zero `//SOLUTION`-marked files throws "No solution
  files found" — this check is explicitly bypassed when `tracer.js` is
  present.
- Language is still detected the ordinary way (by file extension present in
  the directory), which is why the placeholder file is required.
- On save/publish, if `tracer.js` is present the upload path skips the
  normal compile-and-test pass (`checkAndSave`) entirely and just stores the
  files, and the public URL is served at `/tracer/{problem}` instead of
  `/files/{problem}`.
- At request time, the server reads `index.html` for the description, and
  inlines the **raw text of `tracer.js` verbatim** into a generated HTML
  page inside a `<script type="module">` tag that imports the tracer
  runtime (`/assets/tracer/script/codecheck_tracer.js`). The server never
  parses or executes the script — it's purely passed through for the
  browser to run.
- Scoring happens entirely client-side as the student completes steps; the
  score/state is reported out via the LMS's SPLICE/LTI state API
  (`window.SPLICE.reportScoreAndState`), not via CodeCheck's own
  submit/grade backend used by ordinary problems.

## Public HTML template (for a standalone page outside this repo's own hosting)

The public docs show a full standalone template; in this repo, `index.html`
+ `tracer.js` are combined automatically into the equivalent of this at
render time, so as an author you only ever write the two files. For
reference, the shape being generated is:

```html
<html>
  <head>
    <title>A CodeCheck Tracer Exercise</title>
    <link href='.../codecheck_tracer.css' rel='stylesheet' type='text/css'/>
    <script type="module">
import { addExercise, Code, Frame } from '.../codecheck_tracer.js'
addExercise(function* (sim) {
  ...
})
    </script>
  </head>
  <body>
     <!-- index.html content goes here -->
  </body>
</html>
```

`addExercise(generatorFn)` can be called more than once per file to bundle
multiple exercises together.

## Core scripting concepts

### The generator function and `yield`

```js
addExercise(function* (sim) {
  ...
  yield code.ask(5, "Select the next line to execute.")
  ...
})
```

`sim` is the simulation/runtime object, passed as the first argument. Code
between `yield`s executes immediately and invisibly (like single-stepping a
debugger under the hood); a `yield` suspends execution until the student
performs the required interaction correctly, then resumes.

### Paths

A "path" is a reference to a specific displayed value's storage location —
e.g. `vars.i`, `arr[3]`, `obj.field` (these are Proxy-backed property
accesses on `Frame`/`Obj`/`Arr` nodes, not plain JS values). A path plays
three roles: assigning to it updates both the stored value and its visual
rendering; reading it returns the stored value; passing it as `lhs` to
`sim.set(...)` tells the runtime exactly which on-screen slot the student
must edit.

**Important gotcha:** never compare paths with `==`/`===`/`!=`/`!==` —
they're wrapped objects, not raw scalars. Use `sim.eq(x, y)`, or force
conversion with `x + 0 === y + 0`.

## Visual elements (what you can add with `sim.add(gridX, gridY, node)`)

`sim.add` places a node onto a grid arena (roughly 4em/unit horizontally,
2.75em/unit vertically) and returns it (as a Proxy, so plain property
assignment works to populate/update it).

- **`new Code(sourceString, { pseudo: true }?)`** — a source-code panel with
  selectable lines. Blank leading/trailing lines are trimmed automatically.
  `{ pseudo: true }` renders it in a pseudocode font/style.
  - `code.go(lineNumber)` — silently move the "current line" highlight, no
    student interaction (like `//HIDE`-executed code — it just happens).
    Called with no argument, advances to the next selectable line.
  - `yield code.ask(lineNumber, prompt?)` — the student must click that
    line to advance (accepts multiple candidate line numbers too). Blank
    lines, lone `{`/`}`, `else`, and `do` are automatically non-selectable.

- **`new Frame(label)`** — a labeled variable frame (e.g. a stack frame /
  local-scope box). Set variables with plain assignment:
  ```js
  const vars = sim.add(5, 0, new Frame("main variables"))
  vars.i = 0
  vars.greeting = "Hello"
  delete vars.i   // remove a variable from display
  ```

- **`new Obj(className)`** — a heap object with named fields, same
  assignment style as `Frame`:
  ```js
  const fred = sim.add(0, 5, new Obj("Person"))
  fred.name = "Fred"
  fred.age = 42
  ```

- **`new Arr(typeLabel)`** — an array:
  ```js
  const numbers = sim.add(5, 5, new Arr("int[]"))
  numbers[0] = 42
  numbers[1] = numbers[0] + 1
  numbers.length = 5
  ```

- **`new Seq([...])`** — a compact sequence/list representation with named
  index pointers:
  ```js
  const seq = sim.add(0, 0, new Seq([3, 1, 4, 1, 5]))
  seq.index.i = 0
  seq.index.j = seq.length - 1
  seq.index.i++
  ```

- **`new Mat([[...], [...]])`** — a 2D matrix, with row/column index
  pointers (`mat.rowIndex.i`, `mat.columnIndex.j`).

- **`new Graph(...)` / `new Digraph(...)` / `GraphVertex` / `GraphEdge`,
  `new BinaryTreeNode(...)`** — additional structured-data visualizations
  for tracing graph and tree algorithms.

- **Pointers/references between nodes** — assigning one node to another
  node's field draws an arrow:
  ```js
  const node1 = sim.add(0, 0, new Obj("Node"))
  const node2 = sim.add(3, 0, new Obj("Node"))
  node1.next = node2      // drawn as an arrow
  node2.next = "null"
  ```
  For C-style pointers/addresses: `sim.language = 'cpp'; vars.p = new Addr(vars.a[0])`.
  `Ref`, `Addr`, and `Null` are wrapper types used so `sim.set(path, refOrAddr)`
  produces a "draw an arrow" (`connect`-type) step instead of a text-input
  step.

- **`new Terminal()`** — simulated console I/O:
  ```js
  const term = sim.add(0, 0, new Terminal())
  term.println("Hello Sailor!")
  term.print("How old are you? ")
  term.input(42)
  yield term.ask(43)   // student predicts/types the output
  ```

- **`new Buttons()`** (via `sim.addButtons(...labels)`) — a custom
  clickable button panel, for exercises structured around "pick the next
  operation" rather than "pick the next line":
  ```js
  sim.addButtons("a[j] = a[i]", "i++", "j++")
  yield sim.click("i++")
  vars.i++
  ```

## The `sim` interaction API

| Call | Effect |
|---|---|
| `sim.add(gridX, gridY, node)` | Place a top-level visual node on the arena; returns it |
| `sim.remove(node)` | Remove a node (and any arrows to/from it) — e.g. a stack frame popping on return |
| `sim.eq(x, y)` | Safe equality check between path/wrapped values (don't use `==`/`===`) |
| `sim.addButtons(...labels)` | Add one or more clickable action buttons |
| `yield sim.start(state?, prompt?, secondary?)` | Gate everything before it behind a "Start" button; `state` seeds randomization/resume (see below) |
| `yield sim.pause(prompt?, secondary?)` | An informational beat — student just clicks "Next"; not scored |
| `yield sim.next(prompt?, secondary?)` | Same as pause — a plain continue click; not scored |
| `yield sim.ask(value, prompt?, secondary?)` | Ask the student to identify/select/type a value (polymorphic: scalar → typed input, node/`Addr`/`Ref` → click target, `Null` → click null slot) |
| `yield sim.askIf(predicate, sampleValue, prompt?, secondary?)` | Like `ask`, but accepts any value satisfying a custom predicate function, not just an exact match |
| `yield sim.askAny(values, prompt?, secondary?)` | Accept any of several acceptable values/regexes (first is shown as the sample) |
| `yield sim.askAll(values, prompt?, secondary?)` | Require the student to click/select *every* item in a set (e.g. all matching array elements) |
| `yield sim.set(lhs, rhs, prompt?, secondary?)` | Update a variable: `lhs` must be a path; scalar `rhs` → typed-input step, `Addr`/`Ref`/node `rhs` → draw-an-arrow step |
| `yield sim.click(label, prompt?, secondary?)` | Wait for a specific `Buttons` panel button to be clicked |

Every `yield`ed step is scored (counts toward `maxscore`) **except**
`start`, `next`, and `pause`, which are just pacing/informational beats.

## Worked example (`samples/java/tracer1/tracer.js`, full file)

```js
import {
  addExercise,
  Code,
  Frame,
} from "/assets/tracer/script/codecheck_tracer.js";

addExercise(function* (sim) {
  // 1. Add the code with main and add methods
  const code = sim.add(
    0,
    0,
    new Code(`
      public class Adder {
        public static void main(String[] args) {
          int x = 7;
          int y = 5;
          int sum = add(x, y);
        }

        public static int add(int a, int b) {
          int result = a + b;
          return result;
        }
      }`)
  );

  // 2. Add a frame for the main method's variables
  const vars_main = sim.add(10, 0, new Frame("main variables"));
  vars_main.x = "";
  vars_main.y = "";
  vars_main.sum = "";

  // 3. Wait for the user to click Start
  code.go(3);
  yield sim.start();

  // --- TRACE MAIN METHOD ---
  vars_main.x = 7;
  yield sim.pause("Initialize x");
  code.go(4);
  vars_main.y = 5;
  yield sim.pause("Initialize y");

  // Ask student to select the method call line
  yield code.ask(5, "Select the next line to execute.");

  // --- TRACE METHOD CALL ---
  // Ask student to jump into the add method
  yield code.ask(8, "Execution moves to the start of the add method. Select that line.");

  // Create a new frame for the add method's scope
  const vars_add = sim.add(6, 5, new Frame("add variables"));
  vars_add.a = vars_main.x;
  vars_add.b = vars_main.y;
  vars_add.result = "";
  yield sim.pause("Parameters a and b are initialized.");

  // Ask student to select the calculation line
  yield code.ask(9, "Select the next line inside the add method.");

  // Ask student to set the result
  yield sim.set(
    vars_add.result,
    vars_add.a + vars_add.b,
    "Calculate a + b and update the result"
  );

  // Ask student to select the return line
  yield code.ask(10, "Select the return statement.");

  // --- TRACE RETURN ---
  // Ask student to select the line execution returns to in main
  yield code.ask(5, "Execution returns to the calling line. Select it.");

  // Update the 'sum' variable in main with the return value
  vars_main.sum = vars_add.result;
  // The add method's variables go out of scope
  sim.remove(vars_add);
  yield sim.pause("The return value is assigned to sum, and the 'add' method's variables are removed.");
});
```

with `index.html`:

```html
<h2>Function Tracer: Method Calls</h2>
<p>
  Trace the execution of a program that calls a method. Click Start, then
  follow the instructions to select the next line to be executed and update
  the variables.
</p>
```

Walkthrough:
- `Code` is built from a template literal holding the whole method-call
  program; `Frame`s are separate boxes for `main`'s locals and (once the
  call happens) `add`'s locals — mirroring an actual call stack visually.
- `code.go(3)` silently pre-positions the highlight at line 3 before the
  student even starts (so `sim.start()` opens with the right line already
  indicated).
- Variable initialization (`vars_main.x = 7`) happens instantly in script,
  then `sim.pause(...)` just narrates it to the student with a "Next"
  click — the student isn't quizzed on assigning `x`, only told about it.
- `code.ask(5, ...)`/`code.ask(8, ...)` are the actual scored steps: the
  student must click the correct next line, including across the call
  boundary into `add`'s first line.
- A new `Frame` (`vars_add`) is created only once the student has correctly
  navigated into the callee, modeling the call stack growing.
- `sim.set(vars_add.result, vars_add.a + vars_add.b, ...)` is a scored
  "compute and type the value" step — the *expected* value is simply
  whatever expression the author writes on the right (`vars_add.a +
  vars_add.b`), evaluated at script time; there's no separate "expected
  answer" annotation syntax the way `//CALL` implicitly uses the solution's
  output — here the author's own script computes the correct answer inline
  and the runtime checks the student's input against it.
- On return, `vars_main.sum` is updated from `vars_add.result`, then
  `sim.remove(vars_add)` visually pops the callee's frame — modeling scope
  exit — before a final `pause` narrates it.

## Randomization

Tracer exercises can pick random data per attempt (and thread that same
random data through save/resume via `state`):

```js
addExercise(function* (sim, state) {
  if (state === undefined) {
    state = {
      n: sim.randInt(1000, 9999),
      seed: sim.randSeed(),
    }
  }
  vars.n = state.n
  yield sim.start(state)
  ...
})
```

Available generators on `sim`: `randInt(a, b)`, `randFloat(a, b)`,
`randBoolean()`, `randCodePoint(a, b)`, `randSelect(a, b, c, ...)`,
`randWord()` (from a ~3000-word list), `randString(len, a, b)`,
`randIntArray(len, a, b)`, `randDistinctInts(len, a, b)`,
`randFloatArray(len, a, b)`, `randWordArray(len)`, `randSeed(seed?)`. These
use a seedable PRNG so a resumed/reloaded exercise reproduces the same
random values by round-tripping `state` through `sim.start(state)`.

## Grading and integration model (know this before authoring)

- There is **no compile/run/diff pass** for tracer problems at all — unlike
  every other problem type in this repo, submitting `tracer.js` does not
  invoke a language compiler or `comrun`. The `Placeholder.<ext>` file
  exists purely to satisfy language detection and is otherwise inert.
  Because of that, tracer problems bypass the normal problem-save
  compile/test check entirely on upload.
- Every scored `yield` (`ask`/`askIf`/`askAny`/`askAll`/`set`/`click`/a
  line-select via `code.ask`) contributes one point to `maxscore`; `start`,
  `next`, and `pause` don't count. The runtime pre-runs the generator once
  silently to compute `maxscore` before the student begins.
- Scoring, partial-credit tracking, and resume-state are all handled
  client-side by the tracer runtime and reported to the surrounding
  LMS/CodeCheck page via a `score_change_listener`/`retrieve_state` hook
  (SPLICE/LTI state API), not by CodeCheck's own submission/grading
  backend used for ordinary and Parsons problems.
- Because "correctness" is whatever the author's script computes inline
  (e.g. `vars_add.a + vars_add.b`) and checks the student's answer against,
  there is no separate literal "expected value" syntax to write — the
  script *is* the answer key, evaluated live as it walks the trace forward.

## Checklist when authoring a new tracer problem

1. Write `index.md` with a short instructional blurb (what the student is
   tracing and what to do — click lines, type values, etc.). Use `index.md`
   (Markdown), not `index.html` — the `tools/upload_problems.py` script
   requires `index.md` to detect the directory as a problem and converts it
   to `index.html` on upload.
2. Add a `Placeholder.<ext>` file matching the traced language so language
   detection succeeds; leave it empty/inert.
3. In `tracer.js`, build the `Code` panel from the real program text, then
   add `Frame`/`Obj`/`Arr`/`Terminal`/etc. nodes for whatever state you
   want visualized, positioned with `sim.add(gridX, gridY, ...)` so frames
   don't visually overlap.
4. Script the walkthrough top to bottom as a generator: use `code.go(...)`
   and direct assignment for "obvious"/narrated state changes, and
   `yield code.ask(...)` / `yield sim.set(...)` / `yield sim.ask(...)` /
   `yield term.ask(...)` for anything you actually want the student to
   figure out and be scored on.
5. Model call/return and scope changes explicitly: create a new `Frame` on
   entry to a function, `sim.remove(frame)` when it returns/exits scope.
6. If you want the exercise to vary per attempt, seed a `state` object with
   `sim.rand*` helpers on first run and thread it through `sim.start(state)`
   so resumption reproduces the same values.
7. Test by actually stepping through the exercise in a browser — since
   there's no compile/run pass to catch mistakes, a typo in an expected
   expression (e.g. `vars_add.a + vars_add.b`) will silently mark a
   correct student answer wrong (or a wrong one right) with nothing else to
   catch it.
