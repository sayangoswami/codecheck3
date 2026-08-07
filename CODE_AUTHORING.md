# CodeCheck problem authoring reference

This is a reference for writing CodeCheck exercise files (the pseudo-comment
markup that turns an ordinary source file into a CodeCheck problem). It
documents the actual behavior of this repo's checker engine
(`src/main/java/com/horstmann/codecheck/checker/`,
`src/main/java/com/horstmann/codecheck/language/`), cross-checked against the
public reference at https://horstmann.com/codecheck/authoring.html and the
real examples under `samples/java/`.

For Parsons (drag-and-drop tile) puzzles specifically, see
`PARSONS_PUZZLES.md` — that format (`//TILE`/`//OR`/`//FIXED`/`//PSEUDO`) is
covered there in depth and only summarized below.

## How it works, in one paragraph

A CodeCheck problem is one or more source files. Some files are the
**solution** (what the instructor's correct implementation looks like, and —
with hide/show/edit markup — what the student sees and edits). Other files
are **support files** copied in verbatim, or **hidden test drivers**
(JUnit-style `*Test.java`, or plain `*Tester.java` "print actual, print
expected" drivers). Special `//`-comments ("pseudo-comments", using each
language's own comment syntax — `##` for Python/Bash, `;;` for Racket, `--`
for Haskell, `(* *)` for SML, `//` for everything else) tell CodeCheck how to
turn this into an interactive exercise and how to grade it. Grading almost
always works by running the **submission** and the **solution** side by side
(same inputs / same generated test harness) and diffing their output — there
is rarely a literal "expected value" written in the annotation itself; the
instructor's own solution *is* the oracle.

A problem also typically has an `index.html` file with the problem
description (shown to the student above the code).

## File classification

- Any file containing `SOLUTION`, `SHOW`, `EDIT`, or `TILE` becomes a
  **solution file**: student-editable, submitted for grading.
- Everything else is a **support file**: copied into the run directory
  read-only, not shown as editable, but visible in a "provided files" list —
  unless it's filtered out entirely (index.html, param.js, tracer.js,
  check.properties, dotfiles, compiled artifacts, etc.).
- A file containing `HIDDEN` (or starting with `//HIDE`/`//HIDDEN` and having
  no `SHOW`/`EDIT` elsewhere) is completely invisible to the student — typical
  for JUnit test classes and `*Tester.java` drivers.
- Legacy layout: if any path's first component is literally `student/` or
  `solution/`, those become the use-files / solution-files directly (see
  `samples/java/example7`–`example14` for this older two-directory style).
  Prefer the flat single-directory style (`example1`–`example6`,
  `example9`–`example12`) for new problems.
- A file literally named `Input` at the problem root turns on **input mode**:
  every source file becomes fully student-editable (a "write a whole program"
  problem) instead of hide/show/edit-restricted.

## Core annotations

### `//SOLUTION`
Marks a file as the solution/student-editable file. With no other
hide/show/edit markup, the whole file is one editable region.

```java
//SOLUTION
public class Numbers {
   public int square(int n) { return n * n; }
}
```

### `//HIDE` / `//SHOW` — deleting code from what the student sees
A **toggle**, not a matched pair: `//HIDE` turns hiding on and it stays on
until the next `//SHOW` (or end of file). Hidden lines are deleted entirely
from the student's view (but still present in the code that's actually
compiled/run). `//SHOW` can carry replacement text shown in place of what was
hidden, e.g. `//SHOW . . .` inserts a literal `. . .` placeholder comment.

```java
//SOLUTION
import java.util.Scanner;
public class Numbers {
   public static void main(String[] args) {
      //HIDE
      Scanner in = new Scanner(System.in);
      boolean done = false;
      while (!done) {
         //SHOW . . .
         System.out.println("Enter a number, 0 to quit");
         //HIDE
         int n = in.nextInt();
         if (n == 0) done = true;
         else {
             int square = n * n;
             //SHOW . . .
             System.out.println("The square is " + square);
             //HIDE
         }
      }
      //SHOW
   }
}
```
The student sees only the two `println` lines plus the class/method skeleton
and `. . .` placeholders — the Scanner setup and loop logic never appear.

If a file's very first line is `//HIDE` (or `//HIDDEN`) and it has no
`SHOW`/`EDIT` anywhere else, the *whole file* is hidden — nothing shown, not
even a skeleton. Good for a fully-hidden `main`/driver.

### `//EDIT` — leaving an editable stub in place of hidden code
Once a file contains `//EDIT`, it switches to "hide/edit mode": instead of
deleting hidden code, the file is partitioned into alternating **fixed
(read-only)** and **editable** regions. `//EDIT` can carry inline
placeholder text (like `//SHOW` can) that becomes the *initial content* of
that editable region.

```java
public class Numbers {
   /**
      Counts the number of digits with value 7 in a given number.
   */
   //CALL 7777
   //CALL 1729
   //CALL 35
   public int countSevens(int n) {
      int count = 0;
      //HIDE
      while (n > 0)
      //EDIT while (...)
      {
         //HIDE
         if (n % 10 == 7) count++;
         n /= 10;
         //EDIT ...
      }
      return count;
   }
}
```
The student sees the skeleton with two editable boxes pre-filled with
`while (...)` and `...`; the real loop condition and body are hidden
entirely, not just grayed out.

Use `//HIDE`/`//SHOW` when you just want the student to see less code (with
no expectation they'll write anything in that spot). Use `//EDIT` when you
want an editable fill-in-the-blank box in place of the hidden code.

### `//CALL` and `//CALL HIDDEN` — method-call unit testing, no harness needed
Stack one or more `//CALL <args>` lines directly above a method declaration.
CodeCheck synthesizes a small driver that calls that method with the given
argument text (inserted verbatim — write it exactly as it would appear in a
real call), once for the submission and once for the solution, and diffs the
printed results line by line. **There is no `-> expectedValue` syntax** —
the solution's own output *is* the expected value.

```java
//SOLUTION
public class Numbers {
//CALL 3, 4
//CALL HIDDEN -3, 3
//CALL 3, 0
   public double average(int x, int y) {
      //HIDE
      return 0.5 * (x + y);
      //SHOW // Compute the average of x and y
   }
}
```

`//CALL HIDDEN` runs and scores the case but doesn't show its detail to the
student in the report. Array/collection literals work fine as args:

```java
//CALL new int[] { 1, 2, -3, -4, 5, 6 }
//CALL new int[] { }
public int countNegativeElements(int[] a) { ... }
```

Notes:
- All `//CALL`s for one problem must target methods in the *same* file.
- The method being called must have a return value — CodeCheck has no
  built-in support for asserting on `void` calls via `//CALL` (test those
  via stdin/stdout or a JUnit test instead).
- No syntax for expected exceptions; if the solution throws, its stack trace
  becomes the "expected" text the submission is diffed against.

### `//SUB` — running the same program with different literal values
Attach to a variable declaration; lists additional values (separated by
`;`) to substitute for that variable's initializer, one full program run per
value (including the original).

```java
int x = 3; //SUB 5; 8
int y = 4; //SUB 6; 4
```
Runs the program three times: `(x=3,y=4)`, `(x=5,y=6)`, `(x=8,y=4)` — i.e.
all `//SUB`'d variables in a file must supply the same *count* of values, and
they're substituted together, run-by-run, not as a cross product.

Only one file per problem may contain `//SUB`.

### `//ARGS` — command-line arguments
```java
//ARGS values.txt
//ARGS values2.txt
```
Each `//ARGS` line is a separate test run of the program with those
whitespace-separated args. If an arg names a `.txt` file that's also a
problem file, and the problem is in input mode, that file becomes editable
input rather than a static support file.

### `//IN` and `//IN HIDDEN` — stdin scripts
```java
//IN 3\n-3\n0
//IN 10\n100\n-1\n0
```
Each `//IN` line is one full run's worth of stdin, using Java-style escapes
(`\n` for newline, `\uXXXX`, etc.). `//IN HIDDEN` is scored but not shown in
detail. For long inputs, prefer a `test.in`/`test2.in`/... file on disk
instead of an inline `//IN` line.

### `//OUT` — output files to capture and diff
```java
//OUT evens.txt odds.txt
```
After each run, these files are captured and compared against the solution's
versions of the same files. Image files are compared pixel-by-pixel
automatically.

### `//REQUIRED` / `//FORBIDDEN` — regex checks on the submitted source
```java
//FORBIDDEN sort\s*\(
//Don't sort the array
```
```java
//REQUIRED (for|while)\s*\(
```
`//REQUIRED <regex>` fails the whole grading run unless the regex is found
somewhere in the submission's stripped source; `//FORBIDDEN <regex>` fails it
if the regex *is* found. If the very next line is itself a comment, its text
becomes the custom failure message shown to the student. These are `find`
matches (anywhere in the file), not anchored to a single line.

### `//HIDDEN` — hide an entire support/test file
Put at the top of a JUnit test class or a `*Tester.java` driver so its source
is never shown to the student, only its pass/fail result.

```java
//HIDDEN
import org.junit.Test;
import org.junit.Assert;

public class NumbersTest {
   @Test public void testNegative() {
      Assert.assertEquals(9, new Numbers().square(-3));
   }
}
```

### `//ID <string>`
Sets the problem's download/zip filename. Defaults to the first solution
file's name (extension stripped, non-alphanumerics removed).

### Global settings (each appears once per problem, values must agree if repeated)
```java
//IGNORECASE false     // case-sensitive output comparison (default: ignored)
//IGNORESPACE false    // whitespace-sensitive output comparison (default: ignored)
//INTERLEAVE false      // don't interleave echoed stdin into stdout diffing
//TIMEOUT 60000          // total run budget in ms (default 15000)
//MAXOUTPUTLEN 200000    // cap on captured output length (default 100000)
//TOLERANCE 0.01         // floating-point comparison tolerance (default 1e-6)
```

## Unit-test-style problems (Java)

Two distinct filename-driven conventions, both usually paired with
`//HIDDEN` and a `//SOLUTION` class under test:

1. **`*Tester.java`** ("Expected:" convention) — a plain `main` that prints
   an actual value immediately followed by a literal `"Expected: <value>"`
   line; CodeCheck parses and diffs these pairs.
   ```java
   //HIDDEN
   public class NumbersTester {
      public static void main(String[] args) {
         Numbers nums = new Numbers();
         System.out.println(nums.square(3));
         System.out.println("Expected: 9");
      }
   }
   ```
2. **`*Test.java`** (JUnit convention) — a real `@Test`/`org.junit.Assert`
   class, run and scored from JUnit's own console summary
   (`OK (3 tests)` / `Tests run: 3, Failures: 1`).
   ```java
   //HIDDEN
   import org.junit.Test;
   import org.junit.Assert;
   public class NumbersTest {
      @Test public void testSquare() {
         Assert.assertEquals(9, new Numbers().square(3));
      }
   }
   ```

Both can coexist in the same problem alongside a single `//SOLUTION` class
(see `samples/java/example13`).

## Language-specific comment syntax

The pseudo-comment *keyword* (`SOLUTION`, `CALL`, `HIDE`, ...) is the same in
every language; only the comment delimiter changes:

| Language | Delimiter | Example |
|---|---|---|
| Java, C, C++, C#, JS, Kotlin, Dart, Rust, PHP, Scala | `//` | `//CALL 3, 4` |
| Python, Bash | `##` | `##HIDE` |
| Matlab | `%%` | `%%CALL 3, 4` |
| Racket | `;;` | `;;CALL '(1 2 -4 90)` |
| Haskell | `--` | `--CALL 3` |
| Standard ML | `(* ... *)` | `(*CALL 3*)` |

## Java: flexible `main` (Java 25 unnamed classes / instance main methods)

`JavaLanguage`'s entry-point detector (used to decide which solution/use
file is "the" program to run) recognizes two forms:

- The traditional `public static void main(String[] args)` (or
  `String args[]`).
- Java 25's flexible launch protocol (JEP 512, "Compact Source Files and
  Instance Main Methods" — formerly the unnamed-classes preview): a bare
  `void main()` or `void main(String[] args)`, with no `public`/`static`
  required, so problems can use Java 25's terser, beginner-friendly form:
  ```java
  //SOLUTION
  void main() {
      println("Hello, World!");
  }
  ```
  This is detected with a loose regex (no modifier/class-context check), so
  it's a good idea to keep only one `void main(...)`-shaped method per
  solution file — an unrelated instance method that happens to be named
  `main` with a compatible signature would also be picked up as the file's
  entry point.

## Bulk-uploading problems: `tools/upload_problems.py`

Individual problems are normally uploaded by hand via `/uploadProblem`
(zip file), but `tools/upload_problems.py` automates batch authoring —
useful once you have several problems drafted as plain directories rather
than zips.

- Each problem is a directory containing **`index.md`** (Markdown, converted
  to `index.html` via the `markdown` library — the highest-level heading
  becomes the problem's title) plus its source files directly inside it
  (flat layout, no nested `solution/`/`student/`), using the same
  pseudo-comment markup described above.
- **Usage:**
  ```bash
  # A container directory with one subdirectory per problem:
  upload_problems.py DIR --host https://codecheck.example.com

  # One or more individual problem directories (no assignment created):
  upload_problems.py PROBLEM_DIR [PROBLEM_DIR ...] --host ...
  ```
  `--host` can also come from the `CODECHECK_HOST` environment variable.
  Requires `pip install -r requirements.txt` (`requests`, `markdown`) — see
  `tools/requirements.txt`.
- If `DIR/roster.md` exists (container-directory mode only), the script also
  creates an **assignment** from all the uploaded problems via
  `/saveAssignment`, restricted to the student IDs listed in `roster.md`
  (one per line), and prints both the assignment's public (student) and
  private (edit/view-submissions) URLs alongside each problem's public/edit
  URLs.
- Each problem zip is built in-memory: `index.md` → `index.html`, every
  other file in the problem directory copied in as-is (`roster.md` itself is
  excluded from the zip).
- This script has no special handling for Parsons or tracer problems beyond
  what's described above — a Parsons puzzle's `//TILE` markup or a tracer
  problem's `tracer.js`/placeholder file just need to be regular files
  inside the problem directory alongside `index.md`, and they upload the
  same way.

## Other things worth knowing when authoring

- Argument text in `//CALL` (and values in `//SUB`) is inserted **verbatim**
  into generated code — write real, syntactically valid expressions for the
  target language, not pseudocode.
- `//REQUIRED`/`//FORBIDDEN` regexes run against the file with all
  pseudo-comments and hidden lines already stripped — don't rely on hidden
  code being visible to the pattern.
- A duplicate global setting (`ID`, `TOLERANCE`, etc.) with *conflicting*
  values across two files throws an error at problem-load time, unless one of
  the occurrences is in a hidden support file (which silently loses to a
  non-hidden override) — handy for a shared library file that ships a
  default `//OUT` a specific problem wants to override.
- `index.html` is the problem statement; relative image `src=` paths are
  inlined as base64 automatically, and relative hyperlinks are flattened to
  plain text (only `http(s)://` links stay as real links).
- A `param.js` file (see the public authoring docs) enables **parametric
  problems**: JS code that randomizes values and substitutes `{{expr}}`
  placeholders throughout the problem text and source, with helpers like
  `randInt(a,b)`, `randFloat(a,b)`, `randSelect(...)`, `randWord()`,
  `randIntArray(len,a,b)`, etc. Not yet cross-verified against this repo's
  source in depth — treat as provisional and verify against
  `src/main/java/com/horstmann/codecheck/checker/` if a param.js problem is
  actually being authored.
- Non-code exercise types that live alongside this format in the same repo:
  **tracer problems** (`tracer.js` + `index.html`, no solution file needed —
  see `samples/java/tracer1/`) and **Parsons puzzles** (`//TILE`/`//OR`/
  `//FIXED`/`//PSEUDO` — see `PARSONS_PUZZLES.md`).
