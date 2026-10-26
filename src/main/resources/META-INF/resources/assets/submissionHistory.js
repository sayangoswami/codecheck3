window.addEventListener('DOMContentLoaded', () => {
  function appendCode(parent, code, clazz) {
    const pre = append(parent, 'pre', code)
    pre.classList.add('history-code')
    if (clazz !== undefined) pre.classList.add(clazz)
  }

  // Code problems store each file as a list of the student's edited regions,
  // with fixed code (shown as ⋮) between them
  function appendRegions(parent, regions) {
    appendCode(parent, regions.join('\n⋮\n'))
  }

  // Parsons problems store the arranged tiles (left, in sections between fixed code)
  // with their indent level in characters, and the unused tiles (right)
  function appendParsons(parent, parsons) {
    const sections = parsons.left
      .filter(section => section.length > 0)
      .map(section => section.map(tile => ' '.repeat(tile.indent ?? 0) + tile.text).join('\n'))
    appendCode(parent, sections.length === 0 ? '(nothing arranged)' : sections.join('\n⋮\n'))
    if (parsons.right !== undefined && parsons.right.length > 0) {
      append(parent, 'p', 'Not used:').classList.add('history-label')
      appendCode(parent, parsons.right.join('\n'), 'unused')
    }
  }

  // Tracer and other problems store small objects of values
  function appendValues(parent, values) {
    const table = append(parent, 'table')
    for (const key of Object.keys(values)) {
      const tr = append(table, 'tr')
      append(tr, 'th', key)
      const value = values[key]
      append(append(tr, 'td'), 'code', typeof value === 'string' ? value : JSON.stringify(value))
    }
  }

  function appendState(parent, stateString) {
    if (stateString === null || stateString === undefined) return
    let state
    try {
      state = JSON.parse(stateString)
    } catch (e) {
      appendCode(parent, stateString)
      return
    }
    if (state === null || typeof state !== 'object' || !('work' in state)) {
      appendValues(parent, state ?? {})
      return
    }
    const work = state.work
    for (const name of Object.keys(work)) {
      append(parent, 'h4', name)
      const content = work[name]
      if (typeof content === 'string')
        appendCode(parent, content)
      else if (Array.isArray(content) && content.every(region => typeof region === 'string'))
        appendRegions(parent, content)
      else if (content !== null && typeof content === 'object' && Array.isArray(content.left))
        appendParsons(parent, content)
      else if (content !== null && typeof content === 'object')
        appendValues(parent, content)
      else
        appendCode(parent, JSON.stringify(content, null, 2))
    }
  }

  const body = document.querySelector('body')
  append(body, 'h1', 'Submission History')
  append(body, 'p', 'Student: ' + historyData.ccid)
  append(body, 'p', 'Score (best attempt on each problem): ' + percent(historyData.score)).style.fontWeight = 'bold'
  const softDeadline = historyData.softDeadline === undefined ? undefined : new Date(historyData.softDeadline)
  const deadline = historyData.deadline === undefined ? undefined : new Date(historyData.deadline)
  if (softDeadline !== undefined)
    append(body, 'p', 'Soft deadline: ' + softDeadline.toLocaleString())
  if (deadline !== undefined)
    append(body, 'p', (softDeadline === undefined ? 'Deadline: ' : 'Hard deadline: ') + deadline.toLocaleString())

  for (const problem of historyData.problems) {
    append(body, 'h2', problem.problemID)
    append(body, 'p', 'Best: ' + percent(problem.best))
    if (problem.submissions.length === 0) {
      append(body, 'p', 'No submissions')
      continue
    }
    const table = append(body, 'table')
    table.classList.add('history-table')
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
