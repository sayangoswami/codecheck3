/* (C) Cay S. Horstmann 2018-2023. All Rights Reserved.

 */

import { Gettext } from './Gettext.mjs'

const gt = new Gettext({
  domain: 'en_US',
  locale_data: {
    en_US : {
      '' : {
        'plural-forms'  : "nplurals=2; plural=(n != 1);"
      },
      
      'Press start to begin.' : [ null, 'Press start to begin.' ],
      'Select the next action.' : [ null, 'Select the next action.' ],
      'Time' : [ null, 'Time' ],
      'seconds' : [ null, 'seconds' ],
      'One correct' : [ '%1 correct', 'One correct', '%1 correct' ],
      'One error' : [ '%1 errors', 'one error', '%1 errors' ],
      'Try again' : [ null, 'Try again!' ],
      'Good job' : [ null, 'GOOD JOB!' ],
      'The end' : [ null, 'THE END!' ],
      'Done' : [ null, 'Done' ],
      'Start over' :  [ null, 'Start over' ],
      'Next input' : [ null, 'Next input' ],
      'start_button' : [null, 'Start'],
      'next_step_button' : [null, 'See next step'],
      'next_button' : [null, 'Next'],
      'play_button' : [null, 'Play'],
      'enter_press_inst' : [null, 'Press Enter when done.'],
      'new_value_inst' : [null, 'Provide the new value of'],
      'click_line_inst' : [null, 'Select the next line to be executed.'],
      'click_variable_inst' : [null, 'Select the variables that are now out of scope.'],
      'new_value_small_inst' : [null, 'Please enter the new'],
      'try_again_or_msg' : [null, 'Try again, or'],
      'try_again_msg' : [null, 'Try again'],
      'wrong_line_msg' : [null, 'Wrong line selected;'],
      'wrong_variable_msg' : [null, 'Wrong variable selected;'],
      'incomplete_attempt_msg' : [null, 'Still incomplete.'],
      'incorrect_position_msg' : [null, 'The marked line is at the wrong position.'],
      'incorrect_line_msg' : [null, 'The marked line is not a part of the solution.'],
      'text_entry_inst' : [null, 'Complete the second column. Press Enter to submit each entry.'],
      'od_enter_value' :  [null, "Provide the new value and hit Enter."],
      'od_arrow_start' : [null, "Select the start of the arrow"],
      'od_arrow_end' : [null, "Select the end of the arrow"],
      'od_remove_variable' :  [null, "Select the variable to be removed."],
      'od_remove_variables' :  [null, "Select the variables to be removed."],
      'od_remove_object' :  [null, "Select the object to be removed."],
      'od_remove_objects' :  [null, "Select the objects to be removed."],
      'od_remove_variable_object' :  [null, "Select the items to be removed."],
      'od_update_value': [null, "Update the value and hit Enter."],
      'od_arrow_start_end': [null, "Select the start and the end of the arrow."],
      'od_select_value': [null, "Select the value to be updated."],
      'od_click_button': [null, "Click one of the blue buttons."],
      
      'od_start_over_msg' :  [null, "Press Start Over button to restart the activity."],
      'vs_submit_scores' :  [null, "Submit scores to VitalSource"],
      'Reset' : [null, "Reset"],
      'Run' : [null, 'Run'],
      'CodeCheck' : [null, 'CodeCheck'],
      'Close' : [null, 'Close'],
    }
  }
})

function _(msgid) { return gt.gettext(msgid); }

/*
Turns a string into an array of quoted options, accepting double quotes (the default), single quotes, and curly quotes.
*/

function _qu(s) {
  if (Array.isArray(s)) {
    let result = []
    for (let i = 0; i < s.length; i++)
      result.push(_qu(s[i]))
    return result
  } else
    return ['"' + s + '"', "'" + s + "'", '“' + s + '”']
}

/*
Turns a string into an array of quoted options, accepting double quotes (the default), single quotes, curly quotes, or no quotes
*/

function _quu(s) {
  if (Array.isArray(s)) {
    let result = []
    for (let i = 0; i < s.length; i++)
      result.push(_quu(s[i]))
    return result
  } else
    return ['"' + s + '"', "'" + s + "'", '“' + s + '”', s]
}

/*
Turns an expression into a regex, escaping regex special characters,
allowing spaces around operators and parentheses, and making a trailing
semicolon optional. More than one alternative can be provided.

The _re() function won't ever make a space that you provide into an 
optional one. It merely ADDS optional spaces around 

++ += + -- -= -> - *= * /= / << >> == <= >= = < > , [ ] ( ) { } && & || | !

*/

function _re() {
    let result = "\\s*("
    for (let i = 0; i < arguments.length; i++) {
        let expr = arguments[i];
        if (i > 0) result += "|"
        result += expr.replace(/[\\^$*+?.()|[{]/g, '\\$&').replace(/;$/, '\\s*;?').replace(/(\\\+\+|\\\+=|\\\+|--|-=|->|-|\\\*=|\\\*|\/=|\/|<<|>>|==|<=|>=|=|<|>|,|\\\[|]|\\\(|\\\)|\\\{|}|&&|&|\\\|\\\||\\\||!)/g, '\\s*$1\\s*').replace(/\s+/g, '\\s+').replace(/\\s\*\\s\*/g, '\\s*')
    }
    result += ")\\s*"
    return new RegExp(result)
}

/*
  Common UI for interactive elements
*/

/*
   Initializes the UI
   int restoreState(state): called when UI initialized and state retrieved, returns maxscore
   start(): called when Start button clicked
   config: misc. configuration properties
           interactive: false - don't show scores, good job message
           hideHeader: true - hide header
           hideStartOver: true - hide start over
           doneAction: action for Done button next to score (rearrange)
    Returns an object with methods for updating the UI
*/

const ENTER_MESSAGE_TIMEOUT = 10000
const EDIT_COMPLETE_TIMEOUT = 20000
const AFTER_ACTION_DELAY = 1000
const GOOD_MARKER_DELAY = 2000

function getInteractiveId(e) {
  while (e && e.parentNode && (!e.parentNode.className || e.parentNode.className.indexOf('interactivities') < 0))
    e = e.parentNode
  return e ? e.id : null
}

/* Trap keys so they don't get forwarded to VitalSource */
function trapKeys(e) {
  if (e.keyCode === 13 || e.keyCode === 37 || e.keyCode === 39)
    e.stopPropagation();
}

const horstmann_common = {}

horstmann_common.iOS = /apple|safari/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1

horstmann_common.isNumeric = function(x) {
  return typeof x === 'number' || x !== null && typeof x === 'object' && x instanceof Number
}

horstmann_common.isString = function(x) {
  return typeof x === 'string' || x !== null && typeof x === 'object' && x instanceof String
}

horstmann_common.isBoolean = function(x) {
  return typeof x === 'boolean' || x !== null && typeof x === 'object' && x instanceof Boolean
}

horstmann_common.isScalar = function(x) {
  return x === null ||
    horstmann_common.isNumeric(x) ||
    horstmann_common.isString(x) ||
    horstmann_common.isBoolean(x) 
}

horstmann_common.matches = function(response, answer) {
  /*
    Checks whether the string str matches the RegExp re completely
  */
  function matchesCompletely(str, re) {
    let reString = re.toString()
    if (reString.charAt(1) === '^' && reString.charAt(reString.length - 2) === '$') 
      return re.test(str)
    reString = '^(' + reString.substring(1, reString.length - 1) + ')$'
    return new RegExp(reString).test(str)
  }

  if (Array.isArray(answer)) {
    for (let i = 0; i < answer.length; i++)
      if (horstmann_common.matches(response, answer[i])) return true;
    return false;
  } else if (horstmann_common.isNumeric(answer))
    return parseFloat(answer) === parseFloat(response)
  else if (answer instanceof RegExp)
    return matchesCompletely(response, answer)
  else
    return answer.trim().toUpperCase() === response.trim().toUpperCase()
}

/*
  If value is an array of scalars or regexp, and the first
  element is a scalar, choose the first element as the preferred one.
*/
horstmann_common.preferredValue = function(value) {
  if (horstmann_common.isScalar(value)) return '' + value
  if (!Array.isArray(value) || value.length === 0) return value // happens in object diagram
  if (!horstmann_common.isScalar(value[0])) return value
  for (let i = 1; i < value.length; i++)
    if (!(horstmann_common.isScalar(value[i]) || value[i] instanceof RegExp))
      return value
  return '' + value[0]
}

horstmann_common.createButton = function(clazz, label, action) {
  let button = document.createElement('button')
  button.classList.add('hc-button')
  button.classList.add(clazz)
  button.innerHTML = label
  button.tabIndex = 0 
  button.addEventListener('click', e => { action(button) })
  button.addEventListener('keydown', e => {
    if (e.keyCode === 32) {
      e.stopPropagation();
      e.preventDefault();
      action(button)
    } else if (e.keyCode === 37 || e.keyCode === 39) {
      e.stopPropagation();
    }
  });      
  button.addEventListener('keyup', trapKeys)
  return button    
}

horstmann_common.getScaleFactor = function() {
  let computedStyle = window.getComputedStyle(document.documentElement)
  let transform = computedStyle.transform
  if (transform !== 'none' && transform !== '') {
    let m = transform.match(/[0-9.]+/g);
    return m[0]
  }
  else
    return 1
}

horstmann_common.uiInit = function(element, startAction, config) {
  // Element-scoped variables
  let instructions = undefined
  let instruction1 = undefined
  let instruction2 = undefined
  let warning = undefined
  let goodJob = undefined
  let resultDiv = undefined
  let timeSpentDiv = undefined
  let buttons1 = undefined
  let buttons2 = undefined
  let buttons3 = undefined
  let startButton = undefined
  let startOverButton = undefined
  let seeNextStepButton = undefined
  let seeNextStepButtonAction = undefined
  let nextButton = undefined
  let nextButtonAction = undefined
  let doneButton = undefined
  let playButton = undefined
  let playButtonAction = undefined
  let startTime = undefined
  let interactive = undefined
  let tries = 0
  let restoreStateAction = undefined
  let isRestoring = false

  let inputField = undefined
  let inputTarget = undefined
  let defaultInputTarget = undefined

  function startButtonAction() {
    if (interactive)
      startTime = new Date().getTime() // TODO What if no start button
    removeAllMarkers()
    startButton.style.display = 'none'
    buttons2.style.display = ''
    showStartOver()

    element.correct = 0
    element.errors = 0
    tries = 0
    if (doneButton) doneButton.style.display = ''

    startAction(element) 
  }

  function showStart() {
    hideAll()
    if (config.hideInstructions) {
      instructions.style.display = 'none'
    }
    if (config.hideStart) {
      startButtonAction()
    } else {
      instruction1.innerHTML = _('Press start to begin.')
      startButton.style.display = ''
      if (!isRestoring) startButton.focus()
    }
  }
  
  function updateResult(state) {
    resultDiv.parentNode.parentNode.style.borderTop = 'solid thin black'
    warning.innerHTML = ''
    if (interactive) {
      let correct = element.correct
      let errors = element.errors
      let score = element.maxscore == 0 ? 0 : Math.min(1.0, Math.max(0, correct - errors) / element.maxscore)   
      if (correct + errors <= 1 && startTime === undefined)
        startTime = new Date().getTime()
      
      resultDiv.innerHTML = 
        gt.strargs(gt.ngettext('One correct', '%1 correct', correct), correct) +
        ', ' +
        gt.strargs(gt.ngettext('One error', '%1 errors', errors), errors) +
        (config.hidePercent ? '' : ', ' + Math.round(100 * score) + '%')
      if (!isRestoring && state !== null) { 
        element.state.correct = correct
        element.state.errors = errors
        window.horstmann_config &&
          window.horstmann_config.score_change_listener &&
          window.horstmann_config.score_change_listener(element, state, score);
      } 
    }
  }

  function doRestore(state) {
    isRestoring = true
    hideInput() 
    let oldErrors = state && state.errors ? state.errors : 0
    let algoData = restoreStateAction(state)
    let maxscore
    if (typeof algoData === 'object') {
      maxscore = algoData.maxscore
      config.hideInstructions = algoData.steps === 0
      config.hideStart = !algoData.startFound
    } else { // TODO: Legacy
      maxscore = algoData
    }
    
    // restoreStateAction can reset correct, errors
    element.correct = state && state.correct ? state.correct : 0 
    element.errors = state && state.errors ? state.errors : 0 
    element.maxscore = maxscore
    startTime = undefined

    if (oldErrors > 0 && element.errors === 0) { // forgiveness
      resultDiv.parentNode.parentNode.style.borderTop = 'solid thin black'
      resultDiv.innerHTML = _('Try again')
    }
    else if (state) { // some state has been restored
      if (element.correct < element.maxscore) showStartOver()
      updateResult(null) // Show correct, errors
    }
    else 
      showStart()
    isRestoring = false
  }

  function showStartOver() {
    if (!config.hideStartOver) {       
      startOverButton.style.display = ''
      resultDiv.parentNode.parentNode.style.borderTop = 'solid thin black'
    }
  }
  
  function hideAll() {
    warning.innerHTML = ''
    resultDiv.innerHTML = ''
    timeSpentDiv.innerHTML = ''
    startButton.style.display = 'none'
    buttons2.style.display = 'none'
    nextButton.style.display = 'none'
    seeNextStepButton.style.display = 'none'
    goodJob.style.display = 'none'
    playButton.style.display = 'none'
    startOverButton.style.display = 'none'
    resultDiv.parentNode.parentNode.style.borderTop = 'none'    
    if (doneButton) doneButton.style.display = 'none'
  }

  function hideInput() {
    if (inputField && inputField.style.display === '') {
      clearTimeout(inputField.inactivityTimeout)
      clearTimeout(inputField.placementTimeout)
      inputField.inactivityTimeout = undefined
      inputField.placementTimeout = undefined
      
      inputField.style.display = 'none'
      inputField.value = ''
      inputField.blur()
      if (!isRestoring) inputField.parentNode.focus() // TODO: To stop scrolling to top
      // TODO: Blur after successful removal?
      if (inputTarget && inputTarget !== defaultInputTarget) // TODO: What if it was originally hidden?
        inputTarget.style.visibility = 'visible'
      inputField.parentNode.removeChild(inputField) // TODO: try for iPad
      inputTarget = undefined
    }
  }

  function setInstruction(instr, instr2) {
    if (instr !== null) instruction1.innerHTML = instr
    instruction2.innerHTML = instr2 || ''
  }

  function removeMarkers(clazz) {
    for (const e of document.querySelectorAll('.' + clazz))
      e.classList.remove(clazz)
  }
  
  function makeButton(clazz, labelKey, action) {
    return horstmann_common.createButton(clazz, _(labelKey), action)
  }

  function removeAllMarkers() {
    setTimeout(() => removeMarkers('hc-good'), GOOD_MARKER_DELAY)
    removeMarkers('hc-bad')
    instruction1.innerHTML = ''
    instruction2.innerHTML = ''
    warning.innerHTML = ''
  }

  function initUI() {
    interactive = config !== undefined && config.hasOwnProperty('interactive') ? config.interactive : true
    isRestoring = true
    
    instruction1 = document.createElement('span')
    instruction1.id = 'hc-instruction1'
    instruction1.classList.add('hc-message')
    instruction1.setAttribute('aria-live', 'polite')

    defaultInputTarget = document.createElement('span')
    defaultInputTarget.style.visibility = 'hidden'
    defaultInputTarget.textContent = 'mmmmmmmmmmmmmmmmmmmm'
    defaultInputTarget.style.marginLeft = '1em'

    instruction2 = document.createElement('div')
    instruction2.id = 'hc-instruction2'
    instruction2.classList.add('hc-message')
    instruction2.classList.add('hc-message2')
    instruction2.setAttribute('aria-live', 'polite')

    buttons1 = document.createElement('span')
    buttons2 = document.createElement('span')
    buttons3 = document.createElement('span')
    
    warning = document.createElement('span')
    warning.classList.add('hc-message')
    warning.classList.add('hc-retry')
    warning.setAttribute('aria-live', 'assertive')

    startButton = makeButton('hc-start', 'start_button', startButtonAction)
    
    nextButton = makeButton('hc-step', 'next_button', function() {
      nextButton.style.display = 'none'
      if (nextButtonAction) {
        let state = nextButtonAction()
        if (state) updateResult(state)
      }
    })
    
    seeNextStepButton = makeButton('hc-retry', 'next_step_button', function() {
      tries = 0
      seeNextStepButton.style.display = 'none'
      warning.innerHTML = ''
      removeMarkers('hc-bad')
      hideInput()
      if (seeNextStepButtonAction) seeNextStepButtonAction(element) 
    })

    playButton = makeButton('hc-step', 'play_button', function() {
      goodJob.style.display = 'none'
      playButton.style.pointerEvents = 'none'
      startOverButton.style.pointerEvents = 'none'
      if (playButtonAction)
        playButtonAction(function() {
          removeAllMarkers()
          buttons2.innerHTML = ''
          goodJob.innerHTML = _('The end')
          goodJob.style.display = ''
          playButton.style.pointerEvents = 'auto'
          startOverButton.style.pointerEvents = 'auto'
        })
    })

    goodJob = document.createElement('span')
    goodJob.classList.add('hc-goodjob')
    goodJob.classList.add('hc-message')
    goodJob.setAttribute('aria-live', 'polite')

    let uiElement = document.createElement('div')
    uiElement.classList.add('hc-element')
    uiElement.classList.add('vstdonthighlight')
    uiElement.classList.add('VST-draggable')
    uiElement.classList.add('vst-click') // not mentioned in Vitalsource ePub3 Implementation Guide
    uiElement.addEventListener('mouseup', function(e) {
      e.stopPropagation()
      e.preventDefault()
      return false
    })
    /*
      uiElement.addEventListener('touchstart', function(e) { // XXX iOS
      e.stopPropagation()
      e.preventDefault()
      return false
      })
    */
    uiElement.addEventListener('keydown', trapKeys)
    uiElement.addEventListener('keyup', trapKeys)
    
    element.parentNode.insertBefore(uiElement, element)

    startOverButton = makeButton('hc-start', 'Start over', function() {
      removeAllMarkers()
      buttons2.innerHTML = ''
      doRestore(null)
    })
    instructions = document.createElement('div')     
    if (!(config && config.hideHeader))
      uiElement.appendChild(instructions)
    instructions.classList.add('hc-instructions')
    instructions.appendChild(instruction1)
    instructions.appendChild(goodJob)
    instructions.appendChild(defaultInputTarget)
    instructions.appendChild(instruction2)
    instructions.appendChild(warning)
    instructions.appendChild(buttons1)
    instructions.appendChild(buttons2)
    instructions.appendChild(buttons3)
    buttons1.appendChild(startButton)
    buttons1.appendChild(nextButton)
    buttons1.appendChild(seeNextStepButton)
    buttons1.appendChild(playButton)
    buttons3.appendChild(startOverButton)

    buttons3.style.float = 'right'
    
    if (config && config.hasOwnProperty('doneAction')) {
      doneButton = makeButton('hc-step', 'Done', config.doneAction)    
      doneButton.style.display = 'none'      
      buttons1.appendChild(doneButton)
    }

    uiElement.appendChild(element)
    
    resultDiv = document.createElement('span')
    resultDiv.areaLive = 'polite'
    timeSpentDiv = document.createElement('span')
    timeSpentDiv.areaLive = 'polite'
    
    let progress = document.createElement('div')
    progress.classList.add('hc-message')
    progress.appendChild(resultDiv)    
    progress.appendChild(timeSpentDiv)
    

    let bottom = document.createElement('div')
    bottom.classList.add('hc-bottom')
    bottom.appendChild(progress)
    if (config && config.hideStartOver) startOverButton.display = 'none'

    if (horstmann_common.creationDate) {
      let debugDiv = document.createElement('div')
      debugDiv.classList.add('hc-debug')
      debugDiv.innerHTML = 'Version ' + horstmann_common.creationDate + ' Element ID ' + getInteractiveId(element)
      bottom.appendChild(debugDiv)
    }

    uiElement.appendChild(bottom)
    
    hideAll()
  }

  // start of uiInit
  initUI()

  let commonUI = {
    /*
      restoreState: a function that receives the state, or null (!!!)
      if no prior state, in which case a new problem instance
      should be generated. The function returns the maxscore of the instance

      When calling restore, the state is retrieved. restoreState is called
      when the retrieved state becomes available, and when the Start Over button
      is clicked.
     */
    restore: function(restoreState) {
      restoreStateAction = restoreState
      if (interactive &&
          window.horstmann_config &&
          window.horstmann_config.retrieve_state) 
        window.horstmann_config.retrieve_state(element, function(element, state) {     
          doRestore(state)
        })
      else {
        doRestore(null)
      }
    },

    /*
      Shows an instruction.

      instr: the instruction text
      namedArgs
      .secondary: the secondary instruction text
      .nextAction: if provided, a Next button
      is displayed that calls nextAction when clicked. If that action
      returns a state, it is recorded.

      If instr is null, only the secondary instruction is updated.
      Otherwise, the primary instruction is set and the secondary
      instruction is cleared if none is provided
    */
    instruction: function(instr, namedArgs) {
      if (instr != null) {
        removeAllMarkers()
      }
      setInstruction(instr, namedArgs && namedArgs.secondary)
      seeNextStepButton.style.display = 'none'
      if (doneButton) doneButton.style.display = ''
      if (namedArgs && namedArgs.nextAction) {
        nextButton.style.display = ''
        nextButton.focus()
        nextButtonAction = namedArgs.nextAction
      }
      showStartOver() // in restore state, start button might have never be clicked
    },

    /*
      Call when the user has successfully completed a step.
      state: the state to be saved, or null to skip state saving
      namedArgs
      .afterAction: invoked (without args) after a short delay
    */
    correct: function(state, namedArgs) {
      hideInput()
      warning.innerHTML = ''
      seeNextStepButton.style.display = 'none'
      element.correct++
      tries = 0
      updateResult(state)
      if (namedArgs && namedArgs.afterAction)
        setTimeout(namedArgs.afterAction, AFTER_ACTION_DELAY)
    },

    // TODO: Clean up and remove historical baggage
    /*
      Call when the user has unsuccessfully attempted a step.
      If the seeNextStep function is provided, a "Next" button
      is provided that invokes it. If that function returns a 
      new state, it is recorded.
      If defined, namedArgs.afterAction is called (without args)
      a short delay after recording the new state. 
    */
    error: function(state, seeNextStep, namedArgs) {
      if (inputField) inputField.classList.add('hc-bad')
      element.errors++
      if (namedArgs && namedArgs.hasOwnProperty('correct')) element.correct = namedArgs.correct // Used in rearrange
      updateResult(state)
      showStartOver()
      if (namedArgs && namedArgs.hasOwnProperty('instruction'))
        setInstruction(namedArgs.instruction)
      if (seeNextStep === undefined) { // Used in rearrange
        tries = 0
        seeNextStepButtonAction = undefined
        warning.innerHTML = ''
        seeNextStepButton.style.display = 'none'
      } else {    
        tries++
        if (tries == 1) {
          warning.innerHTML = _('try_again_msg')
        }
        else {
          warning.innerHTML = _('try_again_or_msg')
          seeNextStepButton.style.display = ''
          if (!inputField) seeNextStepButton.focus()
          seeNextStepButtonAction = function() {
            tries = 0
            let nextState = seeNextStep()
            if (nextState) updateResult(nextState)
            if (namedArgs && namedArgs.afterAction)
              setTimeout(namedArgs.afterAction, AFTER_ACTION_DELAY)
          }
          if (doneButton) doneButton.style.display = 'none'
        }
      }
    },

    /*
      Show the input field
      target: the HTML element over which to display the input field
      iiiii   If target is null, the input field is shown in a default location
      action: invoked with the entered value and target when user hits Enter
      or after timeout

      TODO: 
      Text area for multiline inputs
    */
    inputOver: function(target, action) {
      if (!target) target = defaultInputTarget

      if (inputField === undefined) {
        inputField = document.createElement('input')
        inputField.setAttribute('aria-labelledby', 'hc-instruction1')
        inputField.setAttribute('aria-describedby', 'hc-instruction2')
        inputField.addEventListener('keydown', function(e) {
          inputField.classList.remove('hc-bad')
          e.stopPropagation()
          clearTimeout(inputField.inactivityTimeout)
          clearTimeout(inputField.placementTimeout)
          inputField.inactivityTimeout = undefined            
          inputField.placementTimeout = undefined
          if (/* e.keyCode === 9 || */ e.keyCode === 13) {
            e.preventDefault()
            let value = inputField.value
            if (value.trim().length > 0) {
              action(value, inputTarget)
            }
          } else {
            inputField.inactivityTimeout = setTimeout(function() {
              inputField.focus()
              warning.innerHTML = _('enter_press_inst')
              inputField.inactivityTimeout = setTimeout(function() {
                inputField.inactivityTimeout = undefined
                let value = inputField.value
                if (value.trim().length > 0) {
                  action(value, inputTarget)
                }
              }, EDIT_COMPLETE_TIMEOUT) 
            }, ENTER_MESSAGE_TIMEOUT)
          }
        })
        inputField.addEventListener('keypress', function(e) {
          trapKeys(e)
        })
        inputField.addEventListener('keyup', function(e) {
          trapKeys(e)
        })
      }
      else {
        clearTimeout(inputField.placementTimeout)
        inputField.placementTimeout = undefined
      }

      if (inputTarget) {
        if (target === inputTarget)
          return
        else if (inputTarget !== defaultInputTarget)
          inputTarget.style.visibility = 'visible'
      }
      if (target.style && target.style.visibility !== 'hidden') {
        inputField.value = target.children.length > 0
          ? target.lastChild.textContent.trim()
          : target.textContent.trim()
      }
      
      inputTarget = target
      if (inputField.parentNode === null)
        element.appendChild(inputField)
      inputField.style.display = ''
      inputField.classList.remove('hc-bad')

      let placeOver = function() {
        let outerRect = element.getBoundingClientRect()
        let targetRect = target.getBoundingClientRect()
        inputField.style.fontSize = '1em'
        let inputRect = inputField.getBoundingClientRect()
        let scaleFactor = horstmann_common.getScaleFactor()
        inputField.style.left = ((targetRect.left - outerRect.left) / scaleFactor) + 'px'
        inputField.style.top = ((targetRect.top - outerRect.top + (targetRect.height - inputRect.height) / 2) / scaleFactor) + 'px'
        // Floor the field at ~16 characters so a student typing a line of
        // console output (over an initially-empty target span) isn't cramped
        // into a one-character-wide box.
        const minWidth = Math.max(1.5 * inputRect.height, 16 * inputRect.height * 0.6)
        inputField.style.width = (Math.max(minWidth, targetRect.width) / scaleFactor) + 'px'
      }
      placeOver()
      inputField.placementTimeout = setTimeout(function() {
        placeOver()
        inputField.placementTimeout = setTimeout(placeOver, 9000)
      }, 1000)
      
      target.style.visibility = 'hidden'
      if (!config.hideStart) { // With multiple elements without start, don't want the last one to grab focus
      // TODO: After the first time, focus doesn't work on iOS
        inputField.focus() // iOS wants it in the same callback
        setTimeout(function() {
          inputField.focus()
        }, 100) // Desktop browsers want a delay
      }
    },

    addButton: function(label, action) {
      const button = horstmann_common.createButton('hc-step', label, action)
      buttons2.appendChild(button)
      return button
    },

    // Used by rearrange after each drop
    updateState: function(state, correct, errors) {
      element.state = state
      if (correct !== undefined)
        element.correct = correct
      if (errors !== undefined)
        element.errors = errors
      updateResult(state)
    },

    /*
      Call when the user has successfully completed all steps.
      Optionally displays a Play button that executes the given action.
    */
    done: function(playAction, goodJobMessage) {
      removeAllMarkers()

      goodJob.innerHTML = goodJobMessage || _(interactive ? 'Good job' : 'The end')
      goodJob.style.display = ''
      if (doneButton) doneButton.style.display = 'none'
      buttons2.innerHTML = ''
      if (startTime !== undefined) {
        let timeSpent = new Date().getTime() - startTime
        timeSpent = Math.round(timeSpent / 1000)
        if (timeSpent > 1) 
          timeSpentDiv.innerHTML = ', ' + timeSpent + ' ' + _("seconds")
        startTime = undefined
      }
      showStartOver() // in restore state, start button might have never be clicked
      if (playAction) {
        playButton.style.display = ''
        playButton.focus()
        playButtonAction = playAction
      }
    }
  }
  return commonUI
}

export { horstmann_common, gt, _, _qu, _quu, _re }