# CodeCheck Parsons puzzle authoring reference

This documents how to author a **Parsons puzzle** — a drag-and-drop
exercise where the student rearranges pre-written code tiles into the
correct order/indentation — in this repo (`codecheck3`). It assumes
familiarity with the general pseudo-comment format in `CODE_AUTHORING.md`
(`//SOLUTION`, `//CALL`, `//IN`, etc.); a Parsons puzzle uses those same
grading mechanisms underneath, just with a different presentation layer.

The canonical spec for this syntax is a doc comment inside
`src/main/java/com/horstmann/codecheck/checker/Problem.java` (~line
471–521); everything below is expanded from that plus the two real examples
in `samples/parsons/` and the client-side implementation in
`src/main/resources/META-INF/resources/assets/horstmann_codecheck.js`.

## The core idea: this is presentation-only, not a new grading model

A Parsons puzzle is an **ordinary CodeCheck problem** (still graded by
`//CALL`, `//IN`+stdout diffing, JUnit, etc.) whose solution file happens to
contain `//TILE` markup. There is **no separate "correct order" comparison**
— when the student submits, the client-side JS reassembles whatever
arrangement they built (in the "your code" column, in DOM order, with
indentation from wherever each tile was dropped) back into one ordinary
source-code string, and that string is graded exactly like any other
submission. A wrong tile choice or wrong order is only ever detected because
it changes the program's *behavior* (a failed `//CALL` test, wrong stdout,
etc.) — never by comparing tile positions to a stored "correct" arrangement.

This has one important authoring consequence: **your distractors must be
chosen so that picking them actually breaks a test**, not just because
they "look wrong." If a distractor doesn't change behavior in a way one of
your `//CALL`/`//IN` tests catches, picking it will silently score as
correct.

## File shape

A Parsons puzzle is normally a single source file, same shape as any other
CodeCheck problem — a class/method with a docstring, `//CALL` (or `//IN`)
test annotations above the method, and then the method body marked up with
`//TILE`/`//FIXED`/`//OR`. No `index.html`, config file, or placeholder file
is required beyond what any ordinary problem in that language needs — Parsons
puzzles are fully language-agnostic (the `//TILE` family works in any
language, using that language's own comment delimiter — see the table in
`CODE_AUTHORING.md`) and language detection works exactly as normal (based on
file extension), with no special-casing.

## Annotation reference

### `//TILE` — start of a draggable region
Turns on tile mode. Each following non-blank line becomes its own separate
draggable tile, one line = one tile, until the mode changes.

**Anything before the first `//TILE` in the file is implicitly fixed** —
class/method signatures, Javadoc, and your `//CALL`/`//IN` annotations above
the method all become read-only skeleton automatically; you don't need to
mark them `//FIXED` explicitly.

**Opening braces attach to the preceding line.** A tile-mode line that is
just `{` is not made into its own tile — it's glued onto the end of the
immediately preceding tile (and onto all of that tile's `//OR` distractors
too), so `while (i < a.length)` followed by `{` becomes a single draggable
tile containing both lines.

### `//TILE n` — group the next n lines into one tile
```java
//TILE 3
}
else
{
```
Joins the next 3 physical lines into a single draggable unit (must be
dragged/dropped together, in that relative order). After the group, tiling
reverts to ordinary one-line-per-tile mode for subsequent lines — `//TILE n`
is not sticky.

### `//FIXED` — end of a draggable region
Switches back to fixed mode: subsequent lines are shown as read-only
skeleton code, left-aligned, until the next `//TILE`/`//TILE n`.

### `//OR <code>` — a wrong-answer distractor tile
Adds one extra draggable tile with the given code, as a **wrong alternative**
to whatever tile it's attached to:

```java
int count = 0;
//OR int count = 1;
```

- If `//OR` immediately follows a tile that's still being accumulated (i.e.
  you're actively in a `//TILE` region), the distractor is tied to that
  specific tile — it's a wrong-answer sibling shown as an alternative pick
  for that slot in the shuffled tile bank.
- If `//OR` appears where there's no "current" tile to attach to — right
  after `//FIXED`, or before the first `//TILE` in the file — it becomes a
  **global distractor**: a red-herring tile mixed anywhere into the whole
  shuffled bank, not tied to any one slot.
- If a `//OR` distractor is itself followed by a `{`-only line (while still
  in non-global tile mode), that brace is appended to the distractor too, the
  same way it attaches to the real tile.

### `//OR n` — a multi-line distractor
```java
//OR 2
//else
//{
```
Like `//TILE n` but for a distractor: the next `n` lines (written as
ordinary comments, since they need to *not* compile as live code) are joined
into one distractor tile. This is how you offer a wrong multi-line block
(e.g. a bogus `else { ... }`) as a red herring.

### `//PSEUDO` — show pseudocode on the tile instead of real code
Attach to the end of a tile-mode line:
```python
result = ""##PSEUDO result = empty string
for w in words :##PSEUDO for every word w in words
```
The text before `//PSEUDO` (`ann.before`) is the real code — what's actually
submitted/compiled/graded. The text after `//PSEUDO` is what's *displayed*
on the draggable tile face. Use this when you want students reasoning about
algorithm structure without being tripped up by exact syntax. Python
convention in the public docs uses `##PSEUDO`; in this repo's delimiter
scheme that's just "the language's own pseudo-comment delimiter" + `PSEUDO`
(e.g. `//PSEUDO` for Java/JS/C-family, matching the table in
`CODE_AUTHORING.md`). Mixed tiles are fine — a multi-line tile can have
`//PSEUDO` on some lines and plain code (no pseudocode label) on others; the
non-labeled lines just display their real code text on the tile.

### `//SUB` inside a tile
`//SUB` can appear on a tile-mode declaration line same as anywhere else —
the `//SUB ...` suffix is stripped from what's shown/dragged, leaving just
the plain declaration as that tile's code.

## Worked example (`samples/parsons/p1/CountNegative.java`)

```java
public class CountNegative
{
   /**
      Counts the negative elements in a given array
      @param a an array of integers
      @return the count of negative integers in a
   */
   //CALL new int[] { 1, 2, -3, -4, 5, 6 }
   //CALL new int[] { -1, -2, -3, -4, -5 }
   //CALL new int[] { -1, -2, 0, 4, -5 }
   //CALL new int[] { 1, 2, 3, 4 }
   //CALL new int[] { }
   public int countNegativeElements(int[] a) {
//TILE
      int count = 0;
      //OR int count = 1;
      int i = 0;
      //OR int i = 1;

      while (i < a.length)
      //OR while (i <= a.length)
      {
         if (a[i] < 0)
         //OR if (a[i] <= 0)
         {
            count++;
         }
         i++;
      }
      return count;
      //OR return i;
//FIXED
   }
}
//OR 2
//else
//{
//OR }
```

Walkthrough:
- The class header, Javadoc, `//CALL` lines, and method signature are all
  implicitly fixed (they're before the first `//TILE`).
- Each statement in the `//TILE`…`//FIXED` region is a separate draggable
  tile. Each `//OR` right after a tile is a wrong-answer sibling for that
  specific slot — e.g. `count = 0` vs. distractor `count = 1`; `i < a.length`
  vs. distractor `i <= a.length` (note the brace attaches to both the real
  condition and its distractor). These distractors are deliberately chosen
  to change behavior — an off-by-one on the comparison, or the wrong seed
  value — so that picking the wrong one fails one of the five `//CALL`
  cases above.
- After `//FIXED`, the closing braces of the method/class are fixed again.
- The trailing `//OR 2` / `//else` / `//{` / `//OR }` block, sitting after
  the last `//FIXED`, are **global distractors** (a bogus `else { }` 2-line
  block and a stray `}`) — scattered anywhere into the shuffled tile bank as
  red herrings, not tied to a specific correct tile.

## Second example: multiple tile regions + `//IN`-based grading (`samples/parsons/p2/CountPosNeg.java`)

```java
/**
   Print the number of positive and negative inputs.
*/
//IN 1 2 -3 -4 5 6 Q
//IN -1 -2 -3 -4 -5 Q
import java.util.Scanner;

public class CountPosNeg
{
   public static void main(String[] args)
   {
//TILE
      int positive = 0;
      int negative = 0;
//FIXED
      Scanner in = new Scanner(System.in);
      while (in.hasNextInt())
      {
//TILE
         int input = in.nextInt();
         if (input < 0)
         //OR if (input <= 0)
         {
            negative++;
         }
         if (input > 0)
         //OR if (input >= 0)
         {
            positive++;
         }
//FIXED
      }
      //TILE 2
      System.out.println("Positive: " + positive);
      System.out.println("Negative: " + negative);
//FIXED
   }
}
```

Points this adds beyond example 1:
- A file can have **any number of alternating `//TILE`/`//FIXED` regions** —
  fixed "scaffolding" code (the `Scanner` setup, the `while` loop wrapper)
  can sit between separate draggable blocks.
- Grading doesn't need `//CALL` at all — this one is graded by ordinary
  `//IN <stdin> Q`-style stdout diffing, proving Parsons puzzles work with
  any of CodeCheck's normal grading mechanisms.
- `//TILE 2` glues the two `println` lines into one non-splittable tile
  (they must move as a unit, though other tiles could still land between
  this block and the surrounding fixed code).

## Scoring & indentation details worth knowing

- Indentation the student gives a tile (by dragging it left/right) is
  rendered as **3 spaces per indent level** when reassembled into source —
  for indentation-insensitive languages (Java, C-family) this only matters
  cosmetically; for indentation-sensitive languages (Python) getting the
  indent level wrong will actually change program behavior and can fail
  tests, so plan distractor/tile granularity accordingly.
- Tiles are shuffled per page load: distractor groups and their siblings are
  shuffled independently, so re-testing the same puzzle should show a
  different tile-bank order each time — don't rely on tile position as a
  hint.
- A lone `}` tile always sorts to the very end of the shuffled tile bank (a
  small UX nicety, not something you control).
- When a submission fails, the report highlights specific **tiles** (not
  just lines) as wrong by mapping the compiler/test error's line number back
  to whichever tile produced it.

## Checklist when authoring a new Parsons puzzle

1. Write the working solution first, as an ordinary graded problem (`//CALL`
   or `//IN` cases that actually exercise every branch you plan to make
   draggable).
2. **If using `//IN`, verify the input count.** Count every `IO.readln()` /
   `nextInt()` / `nextLine()` call in the solution (including those inside
   the tile region) and confirm the `//IN` value has exactly that many
   `\n`-separated fields. For programs that read control values then data in
   a loop — e.g. `rows`, `cols`, then `rows × cols` entries — you need
   `1 + 1 + rows × cols` fields total. An off-by-one here causes the
   automated checker to submit a correct tile arrangement that throws an
   exception at runtime, so the puzzle scores 0/1 even when it looks right.
   Also, each `//IN` annotation must be exactly one physical line in the
   file — see the `//IN` section in `CODE_AUTHORING.md` for the escape
   sequence rules.
3. Wrap the body you want draggable in `//TILE` … `//FIXED`. Leave
   boilerplate (signature, imports, scaffolding) outside — it'll be fixed
   automatically if it's before the first `//TILE`, or you can push it back
   into a fixed region mid-file with `//FIXED`.
4. For each line where a plausible-but-wrong version exists, add `//OR
   <wrong version>` directly after it — and make sure at least one of your
   test cases actually fails when that wrong version is used. An untested
   distractor is a silent hole in the puzzle.
5. Only use global distractors (an `//OR` block placed right after
   `//FIXED` or before the first `//TILE`) for structural red herrings that
   don't belong to one specific line (stray braces, a bogus whole block).
6. If the underlying algorithm is more useful to reason about at a
   conceptual level than a syntax level, add `//PSEUDO` labels to show
   plain-English tiles instead of raw code.
7. **Use `index.md` (not `index.html`)** when using `tools/upload_problems.py`
   to batch-upload. The script looks for `index.md` to detect problem
   directories and converts it to `index.html` during upload. A directory
   with only `index.html` is silently skipped by the upload script.
