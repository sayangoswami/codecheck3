window.addEventListener('DOMContentLoaded', () => {
  function appendState(parent, stateString) {
    if (stateString === null || stateString === undefined) return
    let state
    try {
      state = JSON.parse(stateString)
    } catch (e) {
      append(parent, 'pre', stateString)
      return
    }
    const work = state.work ?? state
    for (const name of Object.keys(work)) {
      append(parent, 'h4', name)
      const content = work[name]
      append(parent, 'pre', typeof content === 'string' ? content : JSON.stringify(content, null, 2))
    }
  }

  const body = document.querySelector('body')
  append(body, 'h1', 'Submission History')
  append(body, 'p', 'Student: ' + historyData.ccid)
  const softDeadline = historyData.softDeadline === undefined ? undefined : new Date(historyData.softDeadline)
  const deadline = historyData.deadline === undefined ? undefined : new Date(historyData.deadline)
  if (softDeadline !== undefined)
    append(body, 'p', 'Soft deadline: ' + softDeadline.toLocaleString())
  if (deadline !== undefined)
    append(body, 'p', (softDeadline === undefined ? 'Deadline: ' : 'Hard deadline: ') + deadline.toLocaleString())

  for (const problem of historyData.problems) {
    append(body, 'h2', problem.problemID)
    if (problem.submissions.length === 0) {
      append(body, 'p', 'No submissions')
      continue
    }
    const table = append(body, 'table')
    const tr = append(table, 'tr')
    for (const header of ['#', 'Submitted At', 'Score', 'Submission'])
      append(tr, 'th', header)
    problem.submissions.forEach((submission, i) => {
      const row = append(table, 'tr')
      append(row, 'td', '' + (i + 1))
      const submittedAt = new Date(submission.submittedAt)
      const whenCell = append(row, 'td', submittedAt.toLocaleString())
      // Only older submissions can be after the hard deadline, from before it was enforced
      if (deadline !== undefined && submittedAt > deadline) {
        row.classList.add('closed')
        append(whenCell, 'span', ' (after hard deadline)').classList.add('closed-label')
      } else if (softDeadline !== undefined && submittedAt > softDeadline) {
        row.classList.add('late')
        append(whenCell, 'span', ' (late)').classList.add('late-label')
      }
      append(row, 'td', percent(submission.score))
      const details = append(append(row, 'td'), 'details')
      append(details, 'summary', 'Show')
      appendState(details, submission.state)
    })
  }
})
