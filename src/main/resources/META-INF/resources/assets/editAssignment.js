window.addEventListener('DOMContentLoaded', () => {
  function format(problems) {
    let result = ''
    for (let i = 0; i < problems.length; i++) {
      if (i > 0) result += '---\n'
      const group = problems[i]
      for (const problem of group) {
        result += 'qid' in problem ? problem.qid : problem.URL
        if (problem.weight != 1) result += ' ' + percent(problem.weight)
        if ('title' in problem) result += ' ' + problem.title 
        result += '\n'
      }      
    }
    return result
  }

  // A datetime-local input wants local time without a zone, like "2020-12-01T15:59"
  function toLocalInputValue(isoString) {
    const date = new Date(isoString)
    const pad = n => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  // prefix is 'deadline' or 'softDeadline'
  function showDeadline(prefix) {
    const date = document.getElementById(prefix + 'Date').value
    const local = document.getElementById(prefix + 'Local')
    const utc = document.getElementById(prefix + 'UTC')
    if (date === '') {
      local.style.display = "none"
      utc.style.display = "none"
    } else {
      let deadlineLocal = new Date(date)
      let deadlineUTC = new Date(deadlineLocal).toUTCString() 
      local.textContent = deadlineLocal
      utc.textContent = deadlineUTC + " (UTC)"
      local.style.display = "block"
      utc.style.display = "block"
    }
  }

  for (const prefix of ['deadline', 'softDeadline'])
    document.getElementById(prefix + 'Date').addEventListener('input', () => showDeadline(prefix))

  // Each extension row: student ID, that student's deadline, and its local time
  const extensionsDiv = document.getElementById('extensions')
  function addExtensionRow(ccid, deadline) {
    const row = append(extensionsDiv, 'div')
    row.className = 'extension-row'
    const idInput = append(row, 'input')
    idInput.type = 'text'
    idInput.placeholder = 'Student ID'
    idInput.className = 'extension-id'
    idInput.value = ccid ?? ''
    const dateInput = append(row, 'input')
    dateInput.type = 'datetime-local'
    dateInput.className = 'extension-date'
    if (deadline) dateInput.value = toLocalInputValue(deadline)
    const shown = append(row, 'span')
    shown.className = 'extension-shown'
    const show = () => shown.textContent = dateInput.value === '' ? 'no deadline' : new Date(dateInput.value).toString()
    dateInput.addEventListener('input', show)
    show()
    row.appendChild(createButton('hc-command', 'Remove', () => row.remove()))
  }

  function readExtensions() {
    const extensions = {}
    for (const row of extensionsDiv.querySelectorAll('.extension-row')) {
      const ccid = row.querySelector('.extension-id').value.trim()
      const date = row.querySelector('.extension-date').value
      if (ccid === '' && date === '') continue
      if (ccid === '') throw new Error('An extension is missing its student ID')
      if (ccid in extensions) throw new Error('More than one extension for ' + ccid)
      extensions[ccid] = date === '' ? null : new Date(date).toISOString()
    }
    return extensions
  }

  const responseDiv = document.getElementById('response')
  if ('problems' in assignment)
    document.getElementById('problems').value = format(assignment.problems)
  if ('roster' in assignment)
    document.getElementById('roster').value = assignment.roster.join('\n')
  if (askForDeadline) {
    for (const prefix of ['deadline', 'softDeadline']) {
      if (prefix in assignment) { // an ISO 8601 string like "2020-12-01T23:59:59Z"
        document.getElementById(prefix + 'Date').value = toLocalInputValue(assignment[prefix])
        showDeadline(prefix)
      }
    }
    for (const ccid in assignment.extensions ?? {})
      addExtensionRow(ccid, assignment.extensions[ccid])
    document.getElementById('addExtensionDiv').appendChild(createButton('hc-command', 'Add extension', () => addExtensionRow()))
  } else {  
    const deadlineDiv = document.getElementById('deadlineDiv')
    deadlineDiv.style.display = 'none'
  }
  
  const submitButton = createButton('hc-command', 'Save', async () => {
    let request = {
        assignmentID: assignment.assignmentID,
        editKey: assignment.editKey, // undefined when cloned
        problems: document.getElementById('problems').value,
        roster: document.getElementById('roster').value,
      }
      
    if (askForDeadline) {
      for (const prefix of ['deadline', 'softDeadline']) {
        const value = document.getElementById(prefix + 'Date').value
        if (value !== '') request[prefix] = new Date(value).toISOString()
      }
      if (request.softDeadline !== undefined && request.deadline !== undefined && request.softDeadline > request.deadline) {
        responseDiv.textContent = 'The soft deadline must not be after the hard deadline'
        responseDiv.style.display = 'block'
        return
      }
      try {
        const extensions = readExtensions()
        if (Object.keys(extensions).length > 0) request.extensions = extensions
      } catch (e) {
        responseDiv.textContent = e.message
        responseDiv.style.display = 'block'
        return
      }
    }
    submitButton.disabled = true
    responseDiv.style.display = 'none'
    try {
      let response = await postData(assignment.saveURL, request)
      if ('launchPresentationReturnURL' in assignment) {
        const params = new URLSearchParams()
        params.append('return_type', 'lti_launch_url')
        params.append('url', response.launchURL)
        const url =  assignment.launchPresentationReturnURL
          + (assignment.launchPresentationReturnURL.includes("?") ? "&" : "?")
          + params.toString()
        window.location.href = url
      } else {
        window.location.href = response.viewAssignmentURL
      }
    } catch (e) {
      responseDiv.textContent = e.message           
      responseDiv.style.display = 'block'
    }
    submitButton.disabled = false    
  })
  document.getElementById('saveButtonDiv').appendChild(submitButton) 
})
