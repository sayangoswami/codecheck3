window.addEventListener('DOMContentLoaded', () => {
  if (typeof ace !== 'undefined') ace.config.set('basePath', '/assets/ace')
  // Colors code like the student's CodeCheck editor (Ace, chrome theme), by file extension
  function highlightCode(pre, fileName) {
    if (typeof ace === 'undefined') return
    const mode = ace.require('ace/ext/modelist').getModeForPath(fileName).mode
    ace.require('ace/ext/static_highlight')(pre, { mode, theme: 'ace/theme/chrome', showGutter: false, trim: false })
  }

  // fileName is only given for programming problems, which are syntax colored
  function appendCode(parent, code, clazz, fileName) {
    const pre = append(parent, 'pre', code)
    pre.classList.add('history-code')
    if (clazz !== undefined) pre.classList.add(clazz)
    if (fileName !== undefined) highlightCode(pre, fileName)
  }

  // Code problems store each file as a list of the student's edited regions,
  // with fixed code (shown as ⋮) between them
  function appendRegions(parent, regions, fileName) {
    appendCode(parent, regions.join('\n⋮\n'), undefined, fileName)
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
        appendCode(parent, content, undefined, name)
      else if (Array.isArray(content) && content.every(region => typeof region === 'string'))
        appendRegions(parent, content, name)
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
  if (historyData.extension)
    append(body, 'p', 'This student has a deadline extension' + (deadline === undefined ? ' with no deadline.' : '.')).classList.add('history-label')
  if (softDeadline !== undefined)
    append(body, 'p', 'Soft deadline: ' + softDeadline.toLocaleString())
  if (deadline !== undefined)
    append(body, 'p', (historyData.extension ? 'Extended deadline: ' : softDeadline === undefined ? 'Deadline: ' : 'Hard deadline: ') + deadline.toLocaleString())
  const hasPenalty = softDeadline !== undefined && historyData.latePenalty !== undefined
  if (hasPenalty) {
    const grace = historyData.lateGraceHours ?? 0
    append(body, 'p', `Late penalty: ${percent(historyData.latePenalty)} per started day after the soft deadline`
      + (grace > 0 ? `, after a grace period of ${grace} hours` : ''))
  }
  // Only show what each check counts as when that can differ from its score
  const showCounts = hasPenalty || deadline !== undefined

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
    for (const header of showCounts ? ['#', 'Submitted At', 'Score', 'Counts As', 'Submission'] : ['#', 'Submitted At', 'Score', 'Submission'])
      append(tr, 'th', header)
    problem.submissions.forEach((submission, i) => {
      const row = append(table, 'tr')
      append(row, 'td', '' + (i + 1))
      const submittedAt = new Date(submission.submittedAt)
      const whenCell = append(row, 'td', submittedAt.toLocaleString())
      // Checks after the hard deadline are logged, but don't count
      if (deadline !== undefined && submittedAt > deadline) {
        row.classList.add('closed')
        append(whenCell, 'span', ' (after deadline, not counted)').classList.add('closed-label')
      } else if (softDeadline !== undefined && submittedAt > softDeadline) {
        row.classList.add('late')
        append(whenCell, 'span', ' (late)').classList.add('late-label')
      }
      append(row, 'td', percent(submission.score))
      if (showCounts) append(row, 'td', submission.counts === undefined ? 'Not counted' : percent(submission.counts))
      const details = append(append(row, 'td'), 'details')
      append(details, 'summary', 'Show')
      appendState(details, submission.state)
    })
  }
})
