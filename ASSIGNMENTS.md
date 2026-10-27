# CodeCheck assignments: deadlines, late penalties, extensions and grading

This is a reference for instructors and maintainers. It covers how deadlines, late
penalties and per-student extensions work in a (non-LTI) CodeCheck assignment, how scores
are calculated, and what the instructor sees. The code is in
`src/main/java/services/Assignment.java` (server) and
`src/main/resources/META-INF/resources/assets/workAssignment.js` (student page),
`viewSubmissions.js` and `submissionHistory.js` (instructor pages).

LTI assignments (launched from an LMS) don't use any of this. Their edit page has no
deadline fields, and the LMS handles due dates.

## Pages

| Page | URL |
|---|---|
| Edit the assignment (deadlines, penalty, extensions, roster) | `/private/editAssignment/{assignmentID}/{editKey}` |
| All students' scores | `/private/viewSubmissions/{assignmentID}/{editKey}` |
| One student's history | `/private/submissionHistory/{assignmentID}/{editKey}/{ccid}` |
| Student's page | `/assignment/{assignmentID}` |

The submissions list links to each student's history.

## Settings

Everything is optional. Leave a field blank to turn it off.

| Setting | Meaning |
|---|---|
| **Soft deadline** | After it, work is *late*. Students can still work and check. |
| **Late penalty** | Percentage points taken off each check made after the soft deadline (and the grace period), **per started day**. A score never goes below 0. Needs a soft deadline. |
| **Grace period** | Hours after the soft deadline before the penalty starts. Needs a late penalty. |
| **Hard deadline** | After it, the assignment is locked for students, and checks no longer count. Must not be before the soft deadline. |
| **Extensions** | Per student: a different hard deadline, or none (date left blank). |

In the stored assignment JSON (`CodeCheckAssignments/{assignmentID}`) these are
`softDeadline`, `latePenalty` (a fraction: `0.1` = 10 points), `lateGraceHours`,
`deadline` (the hard deadline), and `extensions` (CodeCheck ID → ISO 8601 date, or `null`).
Dates are entered in the instructor's local time and stored in UTC.

Saving the edit page fails with a message if:

- the soft deadline is after the hard deadline,
- the penalty isn't between 0% and 100%, or is set without a soft deadline,
- the grace period is negative, or is set without a penalty,
- an extension has no student ID, names a student twice, names a student who isn't on
  the roster (when there is one), or is before the soft deadline.

### How the penalty is counted

Lateness is counted from the soft deadline **plus** the grace period, and every started
24 hours costs one penalty. With a 10-point penalty and a 12-hour grace period:

| Check made after the soft deadline | Deduction |
|---|---|
| up to 12 hours | 0 |
| 12 – 36 hours | 10 points |
| 36 – 60 hours | 20 points |
| 60 – 84 hours | 30 points |

So an 85% check made 40 hours late counts as 65%.

## Grading

Each problem's score is the **best score over all of the student's checks** on that
problem made before their hard deadline, each one **less its own late penalty**. The
assignment score is the weighted average of the problem scores.

A late check therefore never lowers a score: 90% on time and then 100% three days late
(−30) gives 90%, but 40% on time and then 100% one day late (−10) gives 90%.

**Scores are never stored.** They are recalculated from the log of checks every time a
page shows them, using the deadlines, penalty and extensions as they are *now*. So you
can change any of them at any time, including after students have submitted or after a
deadline has passed, and every score follows:

- **Moving a deadline later** (or giving an extension) makes checks that were after it
  count, with the penalty they get under the new dates.
- **Moving a deadline earlier** stops checks after it from counting. That includes work
  the student saved after the new deadline.
- **Changing the penalty or grace period** changes the deduction on every late check
  already made.

Every check is logged, with its time and the student's code or answer, in
`CodeCheckSubmissions/{assignmentID}{ccid}{ccid}{problemID}/{timestamp}`. That includes
checks after the hard deadline, which is what makes these recalculations possible.

## Extensions

An extension replaces **only the hard deadline** for one student (by CodeCheck ID). The
soft deadline and the late penalty still apply to them:

- With an extension date, the student can keep working until that date. Checks after the
  soft deadline still lose the penalty.
- With the date left blank, the student has no hard deadline at all. Their penalty keeps
  growing by day, down to 0.
- To excuse lateness entirely on an assignment without a penalty, give a blank
  extension. With a penalty, there's no per-student way to remove it.

An extension can be given after the deadline has passed. Checks the student already made
after the deadline then count (they were logged). Their **editor still opens with the
last code saved before the deadline**, though, because work isn't saved after the hard
deadline. Their late code is on the history page, and anything they check from then on
is saved normally.

## What students see

- The deadlines and, if set, the penalty rule are shown at the top of the assignment.
- After the soft deadline, a banner says the work is late and, with a penalty, how much
  is currently deducted (or when the penalty starts, during the grace period).
- After a late check: "This check is late, so X counts as Y. Your best score on this
  problem is Z."
- The score shown is the same calculation as above, including penalties.
- After the hard deadline: "The final deadline has passed. You can no longer work on this
  assignment." The problems are shown read-only.
- The page reads the deadlines when it loads. After you change them, students with the
  page open see the change when they reload. Scores always use the current dates.
- Students never see the roster or other students' extensions.

## What the instructor sees

**Submissions list.** One row per student with their score, last submission time and a
status:

- *N checks after deadline (not counted)*: the student checked after their hard deadline.
- *Late*: the last submission was after the soft deadline.
- *Extension*: the student has an extension.

Roster students who only ever checked after the hard deadline are listed too. On an
assignment with **no roster**, a student who only checked after the hard deadline
can't be found, because the server can't tell their ID from the log alone.

**History page.** The deadlines, the student's extension, the penalty rule, the best
score per problem, and every check: time, score, what it *counts as* after the penalty
(or *Not counted* after the hard deadline), and the submitted code or answer. Late checks
are marked *(late)*, and checks after the hard deadline *(after deadline, not counted)*.

## Known gap

Code deployed on 2026-10-26 stopped students' pages from sending checks after the hard
deadline, so checks made then were never logged. The 2026-10-27 deploy fixed this.
Checks attempted after a hard deadline between those two deploys can't be counted, even
with an extension.
