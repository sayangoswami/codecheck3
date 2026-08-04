/* eslint-disable space-before-function-paren */
/* eslint-disable camelcase */
/* eslint-disable no-new-wrappers */
/* eslint-disable curly */
/* global alert, ResizeObserver */
'use strict'

/*
  (C) Cay S. Horstmann 2018-2025. All Rights Reserved.
*/

/*

Glossary

Simulation: The data structure that renders the nodes to be displayed and
handles user interaction.

Node: Anything that can be displayed, either top-level or embedded as
a value in another node. Must have a property $element with the HTML
element that renders the node. If it has an $attach method, it is
called when the element is first rendered, so that the node can register
listeners with the simulation. A top level node has $toplevel set to true.

Note that the non-visual functionality of nodes is executed before rendering,
to find the maximum points.

Value: Anything that can be stored inside a node for display and editing. Values can be
scalars (string, number, boolean), pointers, and embedded nodes.

NamedValuesNode: A node that holds named values. Subclasses must
define $getValueContainer to return the (properly configured) "value container"
--the element containing the visual representation of the value.

Path: The location of a value that the user can edit or select. The $valueContainer
property holds the DOM element visually containing the value. The $name property is a name for
assistive messages. If editable, the path has an $assign method to update the value.

They are called paths because they come from expressions of the form topLevelNode.name1.name2

Scalar values and top-level references are wrapped into objects
(String, Number, Boolean, Ref) so that
   (1) they can be used in expressions and
   (2) they can have $valueContainer, $name, $assign properties

CAUTION: The wrapping makes scalar and reference values work with operators
and methods EXCEPT for ==/===/!=/!==. If you must compare path values,
use sim.eq.

Pointer: An arrow from the valueContainer of a path to either a top-level node or
the valueContainer of another path


Sequence of actions:

addExercise: pushes generator function, optional config

'load' event handler:
- calls initElement for each exercise
-- calls countSteps: (to find out whether start button, instructions need to be shown)
--- calls the algo generator function, and then repeatedly the algo iterator (in getNextStep)
-- calls horstmann_common.uiInit
--- calls initUI
--- returns the commonUI object
-- calls commonUI.restore
--- registers callback, or calls doRestore(null) directly

At this point, nothing in the exercise has been painted yet

Callback from state restoration, or if no state retrieval mechanism, directly drom doRestore(null)
- calls restoreState
-- calls initState
--- calls countSteps (to get maxcount for this state)
--- calls initArena
--- calls the algo generator function to get the algo iterator
--- if start button, getNextStep() (to run the code prior to the start button)
- if no state restored, showStart
-- if hideStart:
--- startButtonAction (same as callback from Start button, see below)

Callback from Start button:
- calls startAction passed to horstmann_common.uiInit, i.e. prepareNextStep
-- calls getNextStep, which calls the generator function

Callback from Start over button:
- calls doRestore(null)
-- calls restoreState (as above)
--- calls showStart

Callback from click on node or edge:
- selected
-- stepCompleted
--- prepareNextStep
---- getNextStep

Callback from Show next step button:
- doStep
- prepareNextStep (afterAction)

Callback from Play button:
- initState
- loops through getNextStep, doStep with delay


*/

import { horstmann_common, _ } from './horstmann_common.mjs'

const setup = []

export const addExercise = (algo, config) => { setup.push({ algo, config }) }

/*
  Wraps a primitive value in an object or clones an object, so that
  path properties and methods can be attached.
*/
const wrap = value => {
  if (value === undefined) {
    return new String('')
  } else if (horstmann_common.isString(value)) {
    return new String(value)
  } else if (horstmann_common.isNumeric(value)) {
    return new Number(value)
  } else if (horstmann_common.isBoolean(value)) {
    return new Boolean(value)
  } else if (value === null || (typeof value === 'object' && value instanceof Null)) {
    return new Null()
  } else if (typeof value !== 'object') {
    alert(`Path cannot have value ${value}`)
    return undefined
  } else if (value instanceof Ref) {
    return new Ref(value.$valueOf())
  } else if (value instanceof Addr) {
    return new Addr(value.deref())
  } else if (value.$toplevel) {
    return new Ref(value)
  } else {
    return value // TODO!!!
    // return structuredClone(value)
  }
}

let counters = {}

const counter = key => {
  counters[key] = key in counters ? counters[key] + 1 : 1
  return counters[key]
}

const tabindex = (parent, clazz, value) => {
  if (parent === undefined) return
  if (value === -1) return // TODO The accessibility consultant did not like making values untabbable
  const items = parent.getElementsByClassName(clazz)
  for (const item of items) item.tabIndex = value
  // if (value >= 0 && items.length > 0) items[0].focus()
}

/*
const setAriaDescription = (elem, prefix, key) => {
  if (!elem.getAttribute('aria-label'))
    elem.setAttribute('aria-label', prefix + ' ' + counter(key))
}
*/

const setTextContent = (elem, text, ariaDescription) => {
  const NARROW_NO_BREAK_SPACE = '\u{202F}'

  if (text === undefined || text.length === 0) text = NARROW_NO_BREAK_SPACE
  else text = '' + text

  if (elem.classList.contains('dropHistory')) {
    elem.textContent = text
    if (ariaDescription !== undefined)
      elem.setAttribute('aria-label', ariaDescription)
    else
      elem.removeAttribute('aria-label')
  } else {
    const newContent = document.createElement('span')
    newContent.textContent = text
    if (ariaDescription !== undefined)
      newContent.setAttribute('aria-label', ariaDescription)
    if (elem.children.length > 0) {
      if (elem.lastChild.textContent === NARROW_NO_BREAK_SPACE)
        elem.lastChild.remove()
      else {
        elem.lastChild.classList.add('history')
        elem.lastChild.setAttribute('aria-label', 'previous value')
        newContent.setAttribute('aria-label', ariaDescription ?? 'current value')
      }
    }
    elem.appendChild(newContent)
  }
}

const GRIDX_TO_EM = 4
const GRIDY_TO_EM = 2.75

/*
  Gets the bounds of a DOM element in the arena in em
*/
const getBounds = e => {
  let outer = e.closest('.arenaContainer')
  const pxToEm = x => {
    const pxPerEm = parseFloat(window.getComputedStyle(outer).fontSize)
    return x / pxPerEm / horstmann_common.getScaleFactor()
  }
  if (!outer) {
    outer = document.getElementsByClassName('arenaContainer')[0]
    outer.appendChild(e)
    const result = { x: 0, y: 0, width: pxToEm(e.scrollWidth), height: 0 }
    outer.removeChild(e)
    return result
  }
  const outerRect = outer.getBoundingClientRect()
  const innerRect = e.getBoundingClientRect()
  return {
    x: pxToEm(innerRect.left - outerRect.left),
    y: pxToEm(innerRect.top - outerRect.top),
    width: pxToEm(e.scrollWidth), // client width is clipped to parent
    height: pxToEm(e.scrollHeight)
  }
}

// --------------------------------------------------------------------

// TODO https://dragonman225.js.org/curved-arrows.html
const drawPointer = (from, toBounds) => {
  // TODO attachments
  const arrowWidth = 0.4
  const attachmentHeight = 0.6
  const attachmentWidth = 0.40
  const maxCWidth = 3
  const minDelta = 2
  const maxDelta = 6
  const fromBounds = getBounds(from)
  const outerFromBounds = getBounds(from.parentNode.parentNode)
  const forward = fromBounds.x + fromBounds.width <= toBounds.x
  const x1 = fromBounds.x + fromBounds.width / 2
  const y1 = fromBounds.y + fromBounds.height / 2

  const x1outer = outerFromBounds.x + outerFromBounds.width + attachmentWidth
  const initial = `M ${x1} ${y1} L ${x1outer} ${y1}`
  let curve
  let arrow

  let attachment = 1

  let attachmentY = forward
    ? attachmentHeight
    : attachmentHeight * 3 / 2 // So that forward/backwards arrows don't cross
  // For narrow height objects, add all arrows in the middle
  if (toBounds.height < 2 * attachmentY) {
    attachmentY = toBounds.height / 2
    attachment = 1
  }

  const y2 = toBounds.y + attachmentY * attachment

  if (forward) {
    // S-shaped
    const x2 = toBounds.x - 2 * arrowWidth

    const cp1x = x1outer + Math.abs(y2 - y1) * 0.5
    const cp1y = y1
    const cp2x = x2 - Math.abs(y2 - y1) * 0.5
    const cp2y = y2
    curve = `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2} L ${x2 + arrowWidth} ${y2}`
    arrow = `M ${x2 + 2 * arrowWidth} ${y2} L ${x2 + arrowWidth} ${y2 - arrowWidth / 2} L ${x2 + arrowWidth} ${y2 + arrowWidth / 2} Z`
  } else if (toBounds.x + toBounds.width > fromBounds.x || y2 < outerFromBounds.y || y2 > outerFromBounds.y + outerFromBounds.height) {
    // Reverse C-shaped
    const x2 = toBounds.x + toBounds.width + 2 * arrowWidth
    const xmax = Math.max(x1outer, x2)
    const xmid = xmax + Math.min(maxCWidth, Math.abs(y1 - y2) * 0.25)
    const ymid = (y1 + y2) / 2
    curve = `L ${xmax} ${y1} Q ${xmid} ${y1}, ${xmid} ${ymid} Q ${xmid} ${y2}, ${xmax} ${y2} L ${x2 - arrowWidth} ${y2}`
    arrow = `M ${x2 - 2 * arrowWidth} ${y2} L ${x2 - arrowWidth} ${y2 - arrowWidth / 2} L ${x2 - arrowWidth} ${y2 + arrowWidth / 2} Z`
  } else {
    // Reverse C to start of outerFromBounds, then Bézier
    const outerYmid = outerFromBounds.y + outerFromBounds.height / 2
    const delta = minDelta + (maxDelta - minDelta) * Math.abs(y1 / outerYmid - 1)
    const x3 = outerFromBounds.x - delta
    const y3 = y1 > outerFromBounds.y + outerFromBounds.height / 2
      ? outerFromBounds.y + outerFromBounds.height + delta
      : outerFromBounds.y - delta
    const xmid = x1outer + Math.min(maxCWidth, Math.abs(y1 - y3) * 0.25)
    const ymid = (y1 + y3) / 2

    const x2 = toBounds.x + toBounds.width + 2 * arrowWidth

    const cp1x = x3 - Math.abs(y2 - y3) * 0.5
    const cp1y = y3
    const cp2x = x2 + Math.abs(y2 - y3) * 0.5
    const cp2y = y2
    curve = `Q ${xmid} ${y1}, ${xmid} ${ymid} Q ${xmid} ${y3}, ${x1outer} ${y3} L ${x3} ${y3} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2} L ${x2 - arrowWidth} ${y2}`
    arrow = `M ${x2 - 2 * arrowWidth} ${y2} L ${x2 - arrowWidth} ${y2 - arrowWidth / 2} L ${x2 - arrowWidth} ${y2 + arrowWidth / 2} Z`
  }

  const tempDiv = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  tempDiv.innerHTML = `<g><path d="${initial} ${curve}" stroke="black" stroke-width="0.075" fill="none"/><path d="${arrow}" fill="black"/></g>`
  return tempDiv.firstChild
}

const drawArrow = (fromBounds, toBounds, color, directed) => {
  const connectionPoint = (bounds, dx, dy) => {
    let x = bounds.x + bounds.width / 2
    let y = bounds.y + bounds.height / 2
    const w = bounds.width
    const h = bounds.height
    // compare slope dy/dx with slope h/w
    if (dx !== 0 && -h / w <= dy / dx && dy / dx <= h / w) {
      // |dy/dx| ≤ h/w
      // intersects at left or right boundary
      if (dx > 0) {
        x = bounds.x + bounds.width
        y += (bounds.width / 2) * dy / dx
      } else {
        x = bounds.x
        y -= (bounds.width / 2) * dy / dx
      }
    } else if (dy !== 0) {
      // intersects at top or bottom
      if (dy > 0) {
        x += (bounds.height / 2) * dx / dy
        y = bounds.y + bounds.height
      } else {
        x -= (bounds.height / 2) * dx / dy
        y = bounds.y
      }
    }
    return { x, y }
  }

  // Center points
  let x1 = fromBounds.x + fromBounds.width / 2
  let y1 = fromBounds.y + fromBounds.height / 2
  let x2 = toBounds.x + toBounds.width / 2
  let y2 = toBounds.y + toBounds.height / 2
  const dx = x2 - x1
  const dy = y2 - y1

  // Line end points
  const from = connectionPoint(fromBounds, dx, dy)
  const to = connectionPoint(toBounds, -dx, -dy)

  x1 = from.x
  y1 = from.y
  x2 = to.x
  y2 = to.y

  const tempDiv = document.createElementNS('http://www.w3.org/2000/svg', 'svg')

  if (directed) {
  // Arrow tip endpoints
    const angle = Math.atan2(dy, dx)
    const arrowWidth = 0.6
    const arrowAngle = Math.PI / 6

    const x3 = x2 - arrowWidth * Math.cos(angle + arrowAngle)
    const y3 = y2 - arrowWidth * Math.sin(angle + arrowAngle)
    const x4 = x2 - arrowWidth * Math.cos(angle - arrowAngle)
    const y4 = y2 - arrowWidth * Math.sin(angle - arrowAngle)
    const x5 = (x3 + x4) / 2
    const y5 = (y3 + y4) / 2

    const line = `M ${x1} ${y1} L ${x5} ${y5}`
    const arrow = `M ${x3} ${y3} L ${x2} ${y2} L ${x4} ${y4} Z`

    tempDiv.innerHTML = `<g><path d="${line}" stroke-width="0.2"/><path d="${arrow}"/></g>`
  } else {
    const line = `M ${x1} ${y1} L ${x2} ${y2}`
    tempDiv.innerHTML = `<g><path d="${line}" stroke-width="0.15"/></g>`
  }
  const paths = tempDiv.firstChild.children
  paths[0].style.stroke = color
  paths[0].style.fill = 'none'
  if (directed) {
    paths[1].style.stroke = 'none'
    paths[1].style.fill = color
  }
  tempDiv.firstChild.style.zIndex = '1'
  return tempDiv.firstChild
}

// --------------------------------------------------------------------

export class Buttons {
  constructor() {
    this.$element = document.createElement('div')
    this.$element.classList.add('buttons')
    this.actions = {}
  }

  $attach(sim) {
    this.$sim = sim
    for (const child of this.$element.children)
      sim.selectable(child, 'button')
  }

  add(label, action) {
    const button = document.createElement('span')
    button.classList.add('hc-button')
    button.classList.add('hc-step')
    button.innerHTML = label
    this.$element.appendChild(button)
    this.$sim?.selectable(button, 'button')
    this.actions[label] = action
  }

  ask(label) {
    tabindex(this.$element, 'selectable-button', 0)
    return {
      type: 'select',
      prompt: _('od_click_button'),
      elements: [...this.$element.children].filter(b => b.innerHTML === label),
      done: () => {
        tabindex(this.$element, 'selectable-button', -1)
        this.actions[label]()
      },
      description: `Next step: ${label}`
    }
  }
}

// --------------------------------------------------------------------

export class Code {
  constructor(code, config) {
    this.currentLine = 0

    this.$element = document.createElement('div')
    this.$element.classList.add('codelines')
    this.$element.setAttribute('role', 'radiogroup')
    this.$element.setAttribute('aria-live', 'polite')
    if (config?.pseudo)
      this.$element.classList.add('pseudo')
    const lines = code.split('\n')
    this.lines = []
    // Ignore leading/trailing blank lines
    let start = 0
    while (start < lines.length && lines[start].trim() === '')
      start++
    let end = lines.length - 1
    while (end >= 0 && lines[end].trim() === '')
      end--
    for (let i = start; i <= end; i++)
      this.lines.push(lines[i])
  }

  $attach(sim) {
    for (let i = 0; i < this.lines.length; i++) {
      const line = document.createElement('span')
      line.setAttribute('role', 'radio')
      line.innerHTML = this.lines[i]
      // if (this.isSelectable(this.lines[i]))  // TODO
      sim.selectable(line, 'line')

      this.$element.appendChild(line)
    }
    this.$sim = sim
    this.go(1)
  }

  isSelectable(line) { // TODO: Allow customization
    return !['', '{', '}', 'else', 'else:', 'else :', 'do'].includes(line.trim())
  }

  nextLine() {
    for (let i = this.currentLine + 1; i <= this.lines.length; i++) {
      if (this.isSelectable(this.lines[i - 1]))
        return i
    }
    return -1
  }

  // User API

  go(line) {
    line = line ?? this.nextLine()
    this.currentLine = line
    const silent = !this.$sim || this.$sim.silent
    if (!silent) {
      const items = this.$element.getElementsByClassName('hc-selected')
      for (let i = items.length - 1; i >= 0; i--) {
        items[i].setAttribute('aria-checked', false)
        items[i].classList.remove('hc-selected')
      }
      if (line >= 1 && line <= this.$element.children.length) {
        const e = this.$element.children[line - 1]
        e.classList.add('hc-selected')
        e.setAttribute('aria-checked', true)
      }
    }
    return this
  }

  ask(...lines) {
    const prompt = lines.length > 0 && typeof lines[lines.length - 1] === 'string'
      ? lines.pop()
      : _('click_line_inst')
    if (lines.length === 0) lines[0] = this.nextLine()
    const silent = !this.$sim || this.$sim.silent
    if (!silent) {
      tabindex(this.$element, 'selectable-line', 0)
      this.$element.children[this.currentLine - 1].focus()
    }

    return {
      type: 'select',
      elements: lines.map(line => this.$element.children[line - 1]),
      done: () => {
        if (!silent) {
          tabindex(this.$element, 'selectable-line', -1)
          document.activeElement.blur()
        }
        this.go(lines[0])
      },
      prompt,
      description: `Moving to line ${lines[0]}` // TODO What if there are multiple code blocks?
    }
  }
}

// --------------------------------------------------------------------

export class Terminal {
  constructor() {
    this.$element = document.createElement('pre')
    this.$element.classList.add('terminal')
    this.$element.setAttribute('aria-live', 'polite')
  }

  // User API

  print(line) {
    const span = document.createElement('span')
    span.textContent = line
    this.$element.appendChild(span)
    return this
  }

  println(line) {
    const span = document.createElement('span')
    span.textContent = line
    this.$element.appendChild(span)
    this.$element.appendChild(document.createTextNode('\n'))
    return this
  }

  input(line) {
    const span = document.createElement('span')
    span.classList.add('input')
    span.textContent = line
    this.$element.appendChild(span)
    this.$element.appendChild(document.createTextNode('\n'))
    return this
  }

  ask(line) {
    const span = document.createElement('span')
    span.textContent = ''
    this.$element.appendChild(span)
    this.$element.appendChild(document.createTextNode('\n'))
    if (line === undefined) span.classList.add('input')
    span.focus()
    return {
      type: 'input',
      element: span,
      select: false,
      value: line,
      prompt: 'Enter the next output',
      done: (inputText) => {
        span.blur()
        span.textContent = line ?? inputText
      },
      description: `Terminal output ${line}`
    }
  }
}

// --------------------------------------------------------------------

export class Null {
  toString() { return 'null' } // TODO In Python it's 'None'
}

// --------------------------------------------------------------------

class Node {
}

// --------------------------------------------------------------------

/**
   The address of a top-level node. A Ref object can have properties that start with $
   In particular, it can be a path. Any property get or set access to properties that
   don't start with $ are forwarded to the underlying node. To access a node property that
   starts with $ call ref.$valueOf() which yields the node.
*/
export class Ref {
  constructor(node) {
    this.$node = node instanceof Ref ? node.$valueOf() : node
    const handler = {
      get(target, key, receiver) {
        if (key === '$valueOf')
          return () => target.$node
        else if (typeof key === 'symbol' || key.toString().startsWith('$'))
          return target[key]
        else
          return target.$node[key]
      },
      set(target, key, value, receiver) {
        if (key.toString().startsWith('$'))
          target[key] = value
        else
          target.$node[key] = value
        return true
      },
      deleteProperty(target, key) {
        if (key.toString().startsWith('$'))
          return delete target[key]
        else
          return delete target.$node[key]
      }
    }
    return new Proxy(this, handler)
  }
}

// --------------------------------------------------------------------

/**
  The address of a non-heap value (only in C style languages)
*/
export class Addr {
  /**
   * @param path A path to a memory location
   */
  constructor(path) {
    if (!(typeof path === 'object' && '$assign' in path)) {
      alert(`Addr constructed with non-path ${path}`)
    }
    this.$path = path
  }

  /**
   * The memory location of which this is the address
   */
  deref() {
    return this.$path
  }
}

// --------------------------------------------------------------------

/**
   A node that holds named values.
*/

class NamedValuesNode extends Node {
  constructor() {
    super()
    this.$values = {} // A map from names to paths
  }

  $attach(sim) {
    this.$sim = sim
    this.$element.classList.add('node')
    for (const name in this.$values) {
      this.$set(name, this.$values[name])
      // calls renderValue, which recursively calls attach on embedded nodes
    }
  }

  /**
     Creates a path to the given named value.
     Called only by $set.
  */
  $path(name, value) {
    const path = wrap(value)

    path.$assign = (newValue) => { this.$set(name, newValue) }
    // Don't change names of top-level objects
    if (!path.$toplevel) {
      let pathName = this.$name ?? ''
      if (/^\p{L}[\p{L}\p{N}]*$/u.test(name))
        pathName = `${pathName}.${name}`
      else
        pathName = `${pathName}[${name}]`
      path.$name = pathName
    }

    return path
  }

  /**
     Return this.$proxy() from subclass constructors.
  */
  $proxy() {
    const handler = {
      get(target, key, receiver) {
        if (typeof key === 'symbol' || key.toString().startsWith('$') || key === 'toString')
          return target[key]
        else {
          return target.$get(key)
        }
      },
      set(target, key, value, receiver) {
        if (key.toString().startsWith('$'))
          target[key] = value
        else
          target.$set(key, value)
        return true
      },
      deleteProperty(target, key) {
        if (key.toString().startsWith('$'))
          return delete target[key]
        else
          return target.$delete(key)
      }
    }
    return new Proxy(this, handler)
  }

  /**
     Gets a value. Called from $proxy.
  */
  $get(name) {
    return this.$values[name]
  }

  /**
     Sets a name/value. Called from $proxy.
  */
  $set(name, value) {
    const path = this.$path(name, value)
    this.$values[name] = path
    if ('$hidden' in this && this.$hidden.includes(name)) return
    if (this.$sim !== undefined) {
      path.$valueContainer = this.$getValueContainer(name, path)
      this.$sim.renderValue(path)
    }
  }

  /**
     Deletes a name/value. Called from $proxy.
  */
  $delete(name) {
    if (!(name in this.$values)) return false
    delete this.$values[name]
    this.$deleteRow(name)
    return true
  }

  /**
     Applies f to each name/value in this node and all embedded nodes
     @param f a function receiving a name and value
  */
  $forEachDescendant(f) {
    for (const name in this.$values) {
      const value = this.$values[name]
      f(name, value)
      if (value instanceof NamedValuesNode)
        value.$forEachDescendant(f)
    }
  }
}

// --------------------------------------------------------------------

class TableNode extends NamedValuesNode {
  // Args [title], [config]

  constructor(...args) {
    super()
    let nextArg = 0
    let title

    if (args.length > nextArg && typeof args[nextArg] === 'string') {
      title = args[nextArg]
      nextArg++
    }

    if (args.length > nextArg && typeof args[nextArg] === 'object') {
      this.$config = args[nextArg]
    } else {
      this.$config = {}
    }
    if (title !== undefined) this.$config.title = title
    if (this.$config.title === undefined && this.$config.emptyTitle === undefined)
      this.$config.emptyTitle = '<span></span>'
  }

  $attach(sim) {
    this.$element = document.createElement('div')
    super.$attach(sim)
    sim.selectable(this.$element, 'node', this)
    sim.connectionTarget(this.$element)
    for (const valueElement of this.$element.getElementsByClassName('value')) {
      const fieldValueSpan = valueElement.firstChild
      this.$attachListeners(fieldValueSpan)
    }
    this.$adjustTitle()
  }

  $getValueContainer(name, path) {
    let nameElement = [...this.$element.getElementsByClassName('name')].find(e => e.textContent === '' + name)
    if (nameElement === undefined) {
      this.$addRow(name)
      nameElement = [...this.$element.getElementsByClassName('name')].find(e => e.textContent === '' + name)
    }
    const valueElement = nameElement.nextSibling
    if (path instanceof NamedValuesNode) {
      nameElement.classList.add('fat')
      valueElement.classList.add('fat')
    } else {
      nameElement.classList.remove('fat')
      valueElement.classList.remove('fat')
    }
    return valueElement.firstChild
  }

  $addRow(name) {
    const nameElement = document.createElement('div')
    nameElement.classList.add('name')
    nameElement.textContent = name
    const names = /^[\p{L}\p{Pc}][\p{L}\p{N}\p{Pc}]*$/u // Letters, numbers (but not at the beginning), punctuation connectors
    if (!names.test(name))
      nameElement.classList.add('pseudo')
    nameElement.id = 'field' + counter('field')
    this.$element.appendChild(nameElement)
    const valueElement = document.createElement('div')
    valueElement.classList.add('value')
    this.$element.appendChild(valueElement)
    const fieldValueSpan = document.createElement('span')
    valueElement.appendChild(fieldValueSpan)
    if ('dropHistory' in this.$config)
      fieldValueSpan.classList.add('dropHistory')
    setTextContent(fieldValueSpan, undefined, 'empty')
    this.$attachListeners(fieldValueSpan)
    fieldValueSpan.setAttribute('aria-live', 'polite')
    this.$adjustTitle()
  }

  $deleteRow(name) {
    if (this.$sim === undefined) return
    // Delete from HTML
    const nameElement = [...this.$element.getElementsByClassName('name')].find(e => e.textContent === '' + name)
    if (nameElement !== undefined) {
      nameElement.nextSibling.remove()
      nameElement.remove()
      this.$adjustTitle()
      if (this.$sim !== undefined) this.$sim.resize()
    }
  }

  $adjustTitle() {
    const titleElements = [...this.$element.children].filter(child => child.classList.contains('title'))
    const childCount = this.$element.children.length
    if (titleElements.length > 0) {
      if (childCount > 1) {
        if (this.$config.title)
          titleElements[0].innerHTML = this.$config.title
        else
          this.$element.removeChild(titleElements[0])
      } else {
        if (this.$config.emptyTitle || this.$config.title)
          titleElements[0].innerHTML = this.$config.emptyTitle || this.$config.title
        else
          this.$element.removeChild(titleElements[0])
      }
    } else if (this.$config.title || (childCount === 0 && this.$config.emptyTitle)) {
      const title = document.createElement('div')
      title.classList.add('title')
      title.innerHTML = this.$element.children > 0
        ? this.$config.title
        : this.$config.emptyTitle || this.$config.title
      this.$element.prepend(title)
    }
  }

  $attachListeners(fieldValueSpan) {
    if (this.$sim === undefined) return
    this.$sim.editable(fieldValueSpan)

    this.$sim.connectionSource(fieldValueSpan)
    if (this.$sim.language === 'cpp') {
      this.$sim.connectionTarget(fieldValueSpan)
      this.$sim.selectable(fieldValueSpan, 'field')
    }
    this.$sim.resize()
  }
}

// --------------------------------------------------------------------

export class Obj extends TableNode {
  constructor(...args) {
    super(...args)
    this.$name = 'Object ' + counter('Obj')
    return this.$proxy()
  }

  $attach(sim) {
    super.$attach(sim)
    this.$element.classList.add('object')
    // setAriaDescription(this.$element, 'Object', 'object')
    this.$element.setAttribute('aria-label', this.$name)
  }
}

// --------------------------------------------------------------------

export class Frame extends TableNode {
  constructor(...args) {
    super(...args)
    this.$name = 'Variables ' + counter('Frame')
    return this.$proxy()
  }

  $attach(sim) {
    super.$attach(sim)
    this.$element.classList.add('frame')
    // setAriaDescription(this.$element, 'Variables', 'frame')
    this.$element.setAttribute('aria-label', this.$name)
  }
}

// --------------------------------------------------------------------

export class Arr extends TableNode {
  constructor(...args) {
    super(...args)
    this.$values.length = 0
    this.$hidden = ['length']
    this.$name = 'Array ' + counter('Array')
    return this.$proxy()
  }

  $attach(sim) {
    super.$attach(sim)
    this.$element.classList.add('array')
    // setAriaDescription(this.$element, 'Array', 'array')
    this.$element.setAttribute('aria-label', this.$name)
  }

  $proxy() {
    const handler = {
      get(target, key, receiver) {
        if (typeof key === 'symbol' || key.toString().startsWith('$'))
          return target[key]
        else
          return target.$get(key)
      },
      set(target, key, value, receiver) {
        if (key.toString().startsWith('$'))
          target[key] = value
        else if (key === 'length') {
          let currentLength = target.$values.length
          target.$values.length = value
          while (currentLength < value) {
            target.$set('' + currentLength, '')
            currentLength++
          }
          while (currentLength > value) {
            currentLength--
            target.$delete(currentLength)
          }
        } else if (key.match(/[0-9]+/)) {
          const currentLength = target.$values.length
          if (currentLength <= key) {
            receiver.length = Number.parseInt(key) + 1
          }
          target.$set(key, value)
        }
        return true
      }
    }
    return new Proxy(this, handler)
  }
}

// --------------------------------------------------------------------

export class Seq extends NamedValuesNode {
  constructor(values) {
    super()
    // TODO allow Seq(1, 2, 3, ...)?
    // i.e. if more than one arg, use that, otherwise the analysis below
    this.$values = []
    if (values !== undefined) {
      if (typeof values === 'string') this.$values = values.split('')
      else if (Array.isArray(values)) this.$values = values
      else this.$values = [values]
    }
    this.$hidden = ['length']
    this.$name = 'Sequence ' + counter('Seq')

    this.$indexes = {}
    const indexProxyHandler = {
      get: (target, key, receiver) => {
        return target[key]
      },
      set: (target, key, value, receiver) => {
        target[key] = value
        this.$refreshIndexes()
        return true
      },
      deleteProperty: (target, key) => {
        const result = delete target[key]
        this.$refreshIndexes()
        return result
      }
    }
    this.index = new Proxy(this.$indexes, indexProxyHandler)

    return this.$proxy()
  }

  $getValueContainer(n, path) {
    n = n * 1 // Force string to int
    if (n >= this.$values.length) this.$addElements(n - this.$values.length + 1)
    return this.$element.children[0].children[n] // value container
  }

  $attach(sim) {
    this.$element = document.createElement('table')
    this.$element.classList.add('seq')
    // setAriaDescription(this.$element, 'Sequence', 'seq')
    this.$element.setAttribute('aria-label', this.$name)
    this.$element.appendChild(document.createElement('tr'))
    const indexRow = document.createElement('tr')
    indexRow.classList.add('index')
    this.$element.appendChild(indexRow)
    this.$addElements(this.$values.length)
    super.$attach(sim)
  }

  $addElements(n) {
    if (this.$element === undefined) return
    const row = this.$element.children[0]
    const indexRow = row.nextSibling
    for (let i = 0; i < n; i++) {
      const cell = document.createElement('td')
      cell.classList.add('dropHistory')
      row.appendChild(cell)
      indexRow.appendChild(document.createElement('td'))
    }
  }

  $deleteElements(n) {
    if (this.$element === undefined) return
    const rows = this.$element.children
    const cells = rows[0].children
    const indexCells = rows[1].children
    for (let i = 0; i < n; i++) {
      cells[cells.length - 1].remove()
      indexCells[cells.length - 1].remove()
    }
  }

  $refreshIndexes() {
    if (this.$sim === undefined) return
    const indexCells = this.$element.children[1].children
    for (let i = 0; i < indexCells.length; i++) {
      const values = []
      for (const name in this.$indexes) {
        if (this.$indexes[name] === i)
          values.push(name)
      }
      indexCells[i].innerHTML = values.join('<br/>')
    }
  }

  $proxy() {
    const handler = {
      get(target, key, receiver) {
        if (key === 'length' || key.match(/[0-9]+/))
          return target.$values[key]
        else
          return target[key]
      },
      set(target, key, value, receiver) {
        if (key === 'length') {
          const currentLength = target.$values.length
          target.$values.length = value
          if (currentLength < value) {
            target.$addElements(value - currentLength)
          }
          if (currentLength > value) {
            target.$deleteElements(currentLength - value)
          }
        } else if (key.match(/[0-9]+/)) {
          const currentLength = target.$values.length
          if (currentLength <= key) {
            receiver.length = Number.parseInt(key) + 1
          }
          target.$set(key, value)
        } else {
          target[key] = value
        }
        return true
      }
    }
    return new Proxy(this, handler)
  }
}

// --------------------------------------------------------------------

class MatRow extends NamedValuesNode {
  constructor(values) {
    super()
    this.$values = values

    return this.$proxy()
  }

  $attach(sim) {
    this.$element = document.createElement('tr')
    this.$element.classList.add('seq')
    // need row indexes on left because might be ragged right
    const indexCell = document.createElement('td')
    indexCell.classList.add('index')
    this.$element.appendChild(indexCell)

    for (let i = 0; i < this.$values.length; i++) {
      const cell = document.createElement('td')
      cell.classList.add('dropHistory')
      this.$element.appendChild(cell)
    }
    super.$attach(sim)
  }

  $getValueContainer(n, path) {
    n = n * 1 // Force string to int
    return this.$element.children[n + 1]
  }

  $proxy() {
    const handler = {
      get(target, key, receiver) {
        if (key === 'length' || key.match(/[0-9]+/))
          return target.$values[key]
        else
          return target[key]
      },
      set(target, key, value, receiver) {
        if (key === 'length')
          return false
        else if (key.match(/[0-9]+/))
          target.$set(key, value)
        else
          target[key] = value
        return true
      }
    }
    return new Proxy(this, handler)
  }
}

export class Mat {
  constructor(elements) {
    this.$values = []
    for (let i = 0; i < elements.length; i++) {
      const row = new MatRow(elements[i])
      this.$values.push(row)
    }

    this.$rowIndexes = []
    this.$columnIndexes = []

    this.rowIndex = new Proxy(this.$rowIndexes, {
      get: (target, key, receiver) => {
        return target[key]
      },
      set: (target, key, value, receiver) => {
        target[key] = value
        this.$refreshRowIndexes()
        return true
      },
      deleteProperty: (target, key) => {
        const result = delete target[key]
        this.$refreshRowIndexes()
        return result
      }
    })

    this.columnIndex = new Proxy(this.$columnIndexes, {
      get: (target, key, receiver) => {
        return target[key]
      },
      set: (target, key, value, receiver) => {
        target[key] = value
        this.$refreshColumnIndexes()
        return true
      },
      deleteProperty: (target, key) => {
        const result = delete target[key]
        this.$refreshColumnIndexes()
        return result
      }
    })
    this.$name = 'Matrix ' + counter('Mat')

    return this.$proxy()
  }

  $attach(sim) {
    // NamedValuesNode.$attach calls $getValueContainer, but the rows don't have
    // value containers
    this.$sim = sim
    this.$element = document.createElement('table')
    this.$element.classList.add('mat')
    // setAriaDescription(this.$element, 'Matrix', 'mat')
    this.$element.setAttribute('aria-label', this.$name)
    let maxlen = 0
    for (const row of this.$values) {
      row.$attach(sim)
      this.$element.appendChild(row.$element)
      maxlen = Math.max(maxlen, row.$values.length)
    }
    const indexRow = document.createElement('tr')
    indexRow.classList.add('seq')
    indexRow.classList.add('index')
    for (let i = 0; i <= maxlen; i++)
      indexRow.appendChild(document.createElement('td'))
    this.$element.appendChild(indexRow)
  }

  $refreshRowIndexes() {
    if (this.$element === undefined) return
    const rows = this.$element.children
    for (let i = 0; i < rows.length - 1; i++) {
      const values = []
      for (const name in this.$rowIndexes) {
        if (this.$rowIndexes[name] === i)
          values.push(name)
      }
      rows[i].children[0].innerHTML = values.join(' ')
    }
  }

  $refreshColumnIndexes() {
    if (this.$element === undefined) return
    const indexCells = this.$element.lastChild.children
    for (let i = 1; i < indexCells.length; i++) {
      const values = []
      for (const name in this.$columnIndexes) {
        if (this.$columnIndexes[name] === i - 1)
          values.push(name)
      }
      indexCells[i].innerHTML = values.join('<br/>')
    }
  }

  $proxy() {
    const handler = {
      get(target, key, receiver) {
        if (key === 'length' || key.match(/[0-9]+/))
          return target.$values[key]
        else
          return target[key]
      }
    }
    return new Proxy(this, handler)
  }
}

// --------------------------------------------------------------------

class GraphVertex extends TableNode {
  constructor(title) {
    super({ title, dropHistory: true })
    this.$title = title
    this.$name = title
    this.$hidden = ['color']
    this.$color = 'lightsteelblue'
    this.$toplevel = true // Can't call in sim.add since that only happens after layout
    return this.$proxy()
  }

  toString() { return this.$title }
  $get(key) {
    if (key === 'color')
      return this.$color
    else
      return super.$get(key)
  }

  $set(key, value) {
    if (key === 'color') {
      this.$color = value
      if (this.$element !== undefined) {
        this.$element.style.background = value
      }
    } else {
      super.$set(key, value)
    }
  }

  $attach(sim) {
    super.$attach(sim)
    this.$element.classList.add('vertex')
    this.$element.style.background = this.$color
    sim.draggable(this)
  }

  static $compare = (u, v) => u.$title < v.$title ? -1 : u.$title === v.$title ? 0 : 1
}

class GraphEdge {
  constructor(from, to) {
    this.$from = from
    this.$to = to
    this.$color = 'black'
    this.$value = undefined
    this.$name = `${from.$name}${to.$name}`
  }

  get from() { return this.$from }

  get to() { return this.$to }

  get value() {
    // TODO Return path
    return this.$value
  }

  set value(newValue) {
    this.$value = newValue
    // TODO update visual
  }

  get color() { return this.$color }

  set color(newColor) {
    this.$color = newColor
    if (this.$svg !== undefined) {
      for (const p of this.$svg.children) {
        if (p.style.fill !== 'none' && p.style.fill !== newColor)
          p.style.fill = newColor
        if (p.style.stroke !== 'none' && p.style.stroke !== newColor)
          p.style.stroke = newColor
      }
    }
  }

  $attach(sim) {
    if (this.value === undefined) return
    const fieldValueSpan = document.createElement('span')
    fieldValueSpan.classList.add('edgevalue')
    this.$element = fieldValueSpan
    if (horstmann_common.isScalar(this.value)) {
      setTextContent(fieldValueSpan, this.value, 'edge value')
      fieldValueSpan.setAttribute('aria-live', 'polite')
      sim.editable(fieldValueSpan)
    } else {
      fieldValueSpan.appendChild(this.value.$element)
      sim.selectable(fieldValueSpan, 'field')
      this.value.$attach?.(sim)
    }
    this.$element.style.zIndex = '2'
  }

  static $compare = (e, f) => {
    const d = GraphVertex.$compare(e.$from, f.$from)
    return d !== 0 ? d : GraphVertex.$compare(e.$to, f.$to)
  }
}

class GraphBase {
  constructor(directed) {
    this.$verts = []
    this.$edges = []
    this.$nextVertex = 'A'
    this.$directed = directed
  }

  vertex() {
    if (this.$sim !== undefined) {
      alert('Layout already called')
      return undefined
    }
    const v = new GraphVertex(this.$nextVertex)
    this.$nextVertex = String.fromCodePoint(this.$nextVertex.codePointAt(0) + 1)
    this.$verts.push(v)
    this.$verts.sort(GraphVertex.$compare) // TODO binary search, also in edge?
    v.$outgoing = []
    v.$incoming = []
    return v
  }

  edge(v, w) {
    if (this.$sim !== undefined) {
      alert('Layout already called')
      return undefined
    }
    const e = new GraphEdge(v, w)
    this.$edges.push(e)
    this.$edges.sort(GraphEdge.$compare)

    v.$outgoing.push(e)
    v.$outgoing.sort(GraphEdge.$compare)

    if (this.$directed) {
      w.$incoming.push(e)
      w.$incoming.sort(GraphEdge.$compare)
    } else {
      w.$outgoing.push(e)
      w.$outgoing.sort(GraphEdge.$compare)
    }
    // TODO compare undirected?
    return e
  }

  adjacent(v) {
    return v.$outgoing.map(e => e.$to === v ? e.$from : e.$to)
  }

  incident(v) {
    return v.$outgoing
  }

  findVertex(title) {
    for (const v of this.$verts)
      if (v.toString() === title.toString()) return v
    return undefined
  }

  verts() {
    return this.$verts
  }

  edges() {
    return this.$edges
  }

  layout(sim, x, y, width, height) { // TODO Or call this in $attach?
    if (sim.silent) return
    if (this.$sim !== undefined) {
      alert('Layout already called')
      return
    }
    if (this.$verts.length === 0) return

    // TODO Don't store?
    this.$x = x
    this.$y = y
    this.$width = width
    this.$height = height

    // Fruchterman-Reingold
    // https://faculty.washington.edu/joelross/courses/archive/s13/cs261/lab/k/

    // these can be tweaked
    const iterations = 100
    const c = 1
    const cool = temp => temp > 1 ? temp * 0.95 : temp - 1 / iterations

    const area = 4
    const k = c * Math.sqrt(area / this.$verts.length)
    let temp = Math.sqrt(this.$verts.length)

    // Start with circular layout; random might work just as well
    let j = 0
    for (const v of this.$verts) {
      v.$pos = {
        x: Math.cos(j * 2 * Math.PI / this.$verts.length),
        y: Math.sin(j * 2 * Math.PI / this.$verts.length)
      }
      j++
    }
    const step = () => {
      // gravity is from https://editor.p5js.org/JeromePaddick/sketches/bjA_UOPip
      for (const v of this.$verts) {
        v.$disp = { x: -v.$pos.x * 1.1, y: -v.$pos.y * 1.1 }
      }

      // calculate repulsive forces
      for (const v of this.$verts) {
        for (const u of this.$verts) {
          if (u !== v) {
            const dx = v.$pos.x - u.$pos.x
            const dy = v.$pos.y - u.$pos.y
            const len2 = Math.max(1E-8, dx * dx + dy * dy)
            v.$disp.x += dx * k * k / len2
            v.$disp.y += dy * k * k / len2
          }
        }
      }
      // calculate attractive forces
      for (const e of this.$edges) {
        const dx = e.$to.$pos.x - e.$from.$pos.x
        const dy = e.$to.$pos.y - e.$from.$pos.y
        const len = Math.hypot(dx, dy)
        e.$to.$disp.x -= dx * len / k
        e.$to.$disp.y -= dy * len / k
        e.$from.$disp.x += dx * len / k
        e.$from.$disp.y += dy * len / k
      }
      // limit max displacement to temperature
      for (const v of this.$verts) {
        const len = Math.hypot(v.$disp.x, v.$disp.y)
        v.$pos.x += v.$disp.x * temp / len
        v.$pos.y += v.$disp.y * temp / len
        // Limiting to the bounding box did not work well
      }
      temp = cool(temp)
    }

    const draw = () => {
      let xmin = Number.MAX_VALUE
      let xmax = Number.MIN_VALUE
      let ymin = Number.MAX_VALUE
      let ymax = Number.MIN_VALUE
      for (const v of this.$verts) {
        xmin = Math.min(xmin, v.$pos.x)
        ymin = Math.min(ymin, v.$pos.y)
        xmax = Math.max(xmax, v.$pos.x)
        ymax = Math.max(ymax, v.$pos.y)
      }

      const maxvertexwidth = 1 // TODO
      const maxvertexheight = 1

      for (const v of this.$verts) {
        const x = this.$x + (this.$width - maxvertexwidth) * (v.$pos.x - xmin) / (xmax - xmin)
        const y = this.$y + (this.$height - maxvertexheight) * (v.$pos.y - ymin) / (ymax - ymin)
        sim.add(x, y, v)
      }
      for (const e of this.$edges) {
        if (!('$sim' in e))
          e.$attach?.(sim)

        const from = e.$from.$element
        const to = e.$to.$element
        sim.addConnector(from, to, (f, tb) => {
          e.$svg = drawArrow(getBounds(f), tb, e.$color, this.$directed)
          e.$svg.style.pointerEvents = 'auto'
          sim.selectable(e.$svg, 'edge', e)
          return e.$svg
        }, e.$element)
      }
    }

    for (let iter = 1; iter <= iterations; iter++)
      step()
    draw()
  }
}

export class Graph extends GraphBase {
  constructor() {
    super(false)
  }
  // TODO Unify by expressing in terms of other?

  findEdge(v, w) {
    for (const e of v.$outgoing) {
      if (e.$to === w || e.$from === w) return e
    }
    return undefined
  }

  other(e, v) {
    return e.$from === v ? e.$to : e.$from
  }
}

export class Digraph extends GraphBase {
  constructor() {
    super(true)
  }

  from(e) {
    return e.$from
  }

  to(e) {
    return e.$to
  }

  findEdge(v, w) {
    for (const e of v.$outgoing) {
      if (e.$to === w) return e
    }
    return undefined
  }
}

// --------------------------------------------------------------------

export class BinaryTreeNode extends Node {
  constructor(value) {
    super()
    this.$name = 'Node ' + counter('Node')
    this.$color = 'lightsteelblue'
    this.value = value
    this.left = null
    this.right = null
    this.$toplevel = true
  }

  static drawConnector = (f, tb) => {
    const fb = getBounds(f)
    const svg = drawArrow({ x: fb.x + fb.width / 2, y: fb.y + fb.height / 2, width: 0, height: 0 }, tb, 'black')
    return svg
  }

  get color() {
    return this.$color
  }

  set color(value) {
    this.$color = value
    if (this.$element !== undefined) {
      this.$element.style.background = this.$color
    }
    // TODO text color
  }

  get value() {
    return this.$value
  }

  set value(newValue) {
    this.$value = wrap(newValue)
    this.$value.$assign = (newValue) => { this.value = newValue }
    if (this.$sim !== undefined) {
      this.$value.$valueContainer = this.$element.children[0].children[0]
      this.$sim.renderValue(this.$value)
    }
  }

  get left() {
    return this.$left
  }

  set left(node) {
    // TODO If setting to null and previously wasn't null, what happens to the arrow?
    this.$left = node === null || node instanceof Null ? new Null() : new Ref(node)
    this.$left.$assign = (newValue) => { this.left = newValue }
    this.$left.$drawConnector = BinaryTreeNode.drawConnector
    this.$left.$name = `${this.$name}.left`

    if (this.$sim !== undefined) {
      this.$left.$valueContainer = this.$element.children[1]
      if (this.$left.$sim === undefined) this.$left.$attach?.(this.$sim)
      this.$sim.renderValue(this.$left)
    }
  }

  get right() {
    return this.$right
  }

  set right(node) {
    this.$right = node === null || node instanceof Null ? new Null() : new Ref(node)
    this.$right.$assign = (newValue) => { this.right = newValue }
    this.$right.$drawConnector = BinaryTreeNode.drawConnector
    this.$right.$name = `${this.$name}.right`

    if (this.$sim !== undefined) {
      this.$right.$valueContainer = this.$element.children[2]
      if (node !== null && node.$sim === undefined) node.$attach?.(this.$sim)
      this.$sim.renderValue(this.$right)
    }
  }

  $attach(sim) {
    this.$sim = sim

    this.$element = document.createElement('div')
    this.$element.classList.add('treenode')
    this.$element.classList.add('node') // round corners
    // this.$element.setAttribute('aria-label', this.$name)
    // TODO Why do we need a span in a div?
    const valueRow = document.createElement('div')
    const valueContainer = document.createElement('span')
    valueContainer.classList.add('dropHistory')
    valueRow.appendChild(valueContainer)
    this.$element.appendChild(valueRow)
    const leftChild = document.createElement('div')
    leftChild.classList.add('dropHistory')
    this.$element.appendChild(leftChild)
    const rightChild = document.createElement('div')
    rightChild.classList.add('dropHistory')
    this.$element.appendChild(rightChild)

    sim.editable(valueContainer)
    sim.selectable(this.$element, 'node', this)
    sim.selectable(leftChild, 'field') // for Null
    sim.selectable(rightChild, 'field') // for Null
    sim.connectionSource(leftChild, BinaryTreeNode.drawConnector)
    sim.connectionSource(rightChild, BinaryTreeNode.drawConnector)
    sim.connectionTarget(this.$element)

    sim.add(0, 0, this)
    // Now set the values again so that they can be shown
    const { value, color, left, right } = this
    this.value = value
    this.color = color
    this.left = left
    this.right = right
  }

  layout(sim, gridX, gridY) {
    if (sim.silent) return undefined
    if (this.$sim === undefined) this.$attach(sim)
    const x = gridX * GRIDX_TO_EM
    const y = gridY * GRIDY_TO_EM
    const XGAP = 2
    const YGAP = 2

    // The children may not yet be attached
    const left = this.$left
    const right = this.$right
    this.$left = new Null()
    this.$right = new Null()

    const nodeBounds = getBounds(this.$element)

    const cy = y + nodeBounds.height + YGAP
    let width
    let cheight
    let nx
    let rx
    if (!sim.eq(left, null)) {
      const leftBounds = left.$valueOf().layout(sim, x / GRIDX_TO_EM, cy / GRIDY_TO_EM)
      rx = x + leftBounds.width + XGAP
      nx = x + leftBounds.width + XGAP / 2 - nodeBounds.width / 2
      cheight = leftBounds.height + YGAP
      width = leftBounds.width + XGAP / 2 + nodeBounds.width / 2
    } else {
      rx = x + nodeBounds.width / 2 + XGAP / 2
      nx = x
      cheight = 0
      width = nodeBounds.width
    }
    if (!sim.eq(right, null)) {
      const rightBounds = right.$valueOf().layout(sim, rx / GRIDX_TO_EM, cy / GRIDY_TO_EM)
      cheight = Math.max(cheight, rightBounds.height + YGAP)
      width += rightBounds.width - nodeBounds.width / 2 + XGAP / 2
    }
    sim.dragTo(nx, y, this) // TODO Coords
    this.left = left
    this.right = right

    return { width, height: nodeBounds.height + cheight }
  }

  $forEachDescendant(f) {
    f('left', this.$left)
    f('right', this.$right)
  }
}

// ====================================================================

window.addEventListener('load', () => {
  const PLAY_STEP_DELAY = 1000
  const PAUSE_DELAY = 1000
  // const REMOVE_X = '✘'

  const initElement = (tracerElement, { algo, config }) => {
    // Element-scoped variables

    let arena
    let arenaTopLevelNodes = []

    let stepIter
    let currentStepIndex
    let currentStep
    let currentStepStarted

    let rubberbandStarted = false
    let rubberbandDrawFunction
    let connectorsFrom = new Map()
    // maps $valueContainer/$element of start to map of $valueContainer/$element of end to { svg, draw: function to redraw }
    let connectorsTo = new Map()
    // maps $valueContainer/$element of end to set of $valueContainer/$element of starts
    const buttons = new Map()
    // maps button labels to elements, for non-interactive click

    let dragStarted = false
    let draggedNode
    let dragOffset

    const nodeResizeObserver = new ResizeObserver(entries => {
      // Recompute the connectors
      const connectorArena = arena.nextSibling
      connectorArena.innerHTML = ''
      for (const [from, tos] of connectorsFrom.entries()) {
        for (const [to, data] of tos.entries()) {
          const svg = data.draw(from, getBounds(to))
          tos.set(to, { ...data, svg })
          connectorArena.appendChild(svg)
          if (data.element !== undefined) {
            center(data.element, from, to)
          }
        }
      }
      resize()
    })

    /*
      Converts pixels in the object arena to em
    */
    const pxToEm = x => {
    // let pxPerRem = parseFloat(getComputedStyle(document.documentElement).fontSize)
      const pxPerEm = parseFloat(window.getComputedStyle(arena.parentNode).fontSize)
      return x / pxPerEm / horstmann_common.getScaleFactor()
    }

    const setPosition = (element, x, y) => {
      element.style.position = 'absolute'
      element.style.left = (x * GRIDX_TO_EM) + 'em'
      element.style.top = (y * GRIDY_TO_EM) + 'em'
    }

    const center = (element, from, to) => {
      if (element === undefined) return
      const fromBounds = getBounds(from)
      const toBounds = getBounds(to)
      const elementBounds = getBounds(element)
      const x1 = fromBounds.x + fromBounds.width / 2
      const y1 = fromBounds.y + fromBounds.height / 2
      const x2 = toBounds.x + toBounds.width / 2
      const y2 = toBounds.y + toBounds.height / 2
      element.style.position = 'absolute'
      element.style.left = ((x1 + x2 - elementBounds.width) / 2) + 'em'
      element.style.top = ((y1 + y2 - elementBounds.height) / 2) + 'em'
    }

    /*
      Gets the extent of an array of elements
    */
    const getExtent = elements => {
      const result = {
        width: 0,
        height: 0
      }
      for (let i = 0; i < elements.length; i++) {
        const bounds = getBounds(elements[i])
        result.width = Math.max(result.width, bounds.x + bounds.width)
        result.height = Math.max(result.height, bounds.y + bounds.height)
      }
      return result
    }

    /*
      Gets the extent of an SVG of element
    */
    const getSVGExtent = svg => {
      const elements = svg.children
      const result = {
        width: 0,
        height: 0
      }
      for (let i = 0; i < elements.length; i++) {
        const bounds = elements[i].getBBox()
        result.width = Math.max(result.width, bounds.x + bounds.width)
        result.height = Math.max(result.height, bounds.y + bounds.height)
      }
      return result
    }

    /*
      Resizes the arena and connectors to hold all elements.
    */
    const resize = () => {
      const extent = getExtent(arenaTopLevelNodes)
      const connectorArena = arena.nextSibling
      const connectorArenaBounds = getSVGExtent(connectorArena)
      const height = Math.max(extent.height, connectorArenaBounds.height)
      const width = Math.max(extent.width, connectorArenaBounds.width)

      connectorArena.setAttribute('viewBox', `0 0 ${width} ${height}`)
      connectorArena.style.width = width + 'em'
      connectorArena.style.height = height + 'em'

      arena.style.width = width + 'em'
      arena.style.height = height + 'em'
      arena.parentNode.style.width = width + 'em'
      arena.parentNode.style.height = height + 'em'
    }

    const selected = (element, value) => { // value can be undefined
      if (currentStep === undefined || currentStep.type !== 'select' || element.classList.contains('hc-bad')) return
      // Ignore selections of the wrong type
      if ('alreadySelected' in currentStep) { // askAll
        if (element.classList.contains('selectable-node') &&
            !currentStep.values.some(v => v instanceof Node)) return
        if (element.classList.contains('selectable-edge') &&
            !currentStep.values.some(v => v instanceof GraphEdge)) return
        if (currentStep.alreadySelected.includes(value)) return
      } else {
        if (element.classList.contains('selectable-node') &&
            !(currentStep.value instanceof Ref || currentStep.value instanceof Node)) return
        if (element.classList.contains('selectable-field') &&
            !(currentStep.value instanceof Null || (currentStep.value instanceof Node && !currentStep.value.$toplevel))) return
        if (element.classList.contains('selectable-edge') &&
            !(currentStep.value instanceof GraphEdge)) return
      }

      if (currentStepStarted) return
      currentStepStarted = true

      let good
      if ('alreadySelected' in currentStep) { // askAll
        good = currentStep.values.includes(value)
        if (good) {
          currentStep.alreadySelected.push(value)
        }
      } else { // single selection
        good = (currentStep.elements !== undefined && currentStep.elements.includes(element)) || (currentStep.elements === undefined && currentStep.value === value)
      }
      if (good) {
        element.classList.add('hc-good')
        currentStepStarted = false
        stepCompleted(true)
      } else {
        element.classList.add('hc-bad')
        currentStepStarted = false
        stepCompleted(false)
      }
    }

    const match = (inputText) => {
      // IMPORTANT Use value, not inputText, because inputText is
      // always a string. You want to give numbers a chance. Consider
      // vars.n = 1
      // vars.n = yield sim.ask(vars.n + 1)
      // vars.n = yield sim.ask(vars.n + 1)

      if (currentStep.predicate !== undefined) {
        if (currentStep.predicate(inputText)) {
          return typeof currentStep.value === 'number' ? parseFloat(inputText) : inputText
        }
      } else if (currentStep.values !== undefined) {
        for (const v of currentStep.values) {
          if (horstmann_common.matches(inputText, v)) return v
        }
      } else if (currentStep.value !== undefined) {
        if (horstmann_common.matches(inputText, currentStep.value)) return currentStep.value
      }
      return undefined
    }

    const editStarted = (element) => {
      if (currentStep === undefined || currentStep.type !== 'input') return
      if (element !== undefined) {
        if (element !== currentStep.element) {
          element.classList.add('hc-bad')
          stepCompleted(false)
          return
        } else {
          commonUI.instruction(null, {
            secondary: _('od_enter_value')
          })
        }
      }
      commonUI.inputOver(element, (inputText, target) => {
        // TODO Why is sometimes element != target in this callback?
        // I wanted to add hc-good/hc-bad to element, but it didn't work
        const inputTextMatch = match(inputText)
        if (currentStep.value === undefined) {
          stepCompleted(true, inputText)
        } else if (inputTextMatch !== undefined) {
          if (target !== undefined) {
            target.classList.add('hc-good')
          }
          stepCompleted(true, inputTextMatch)
        } else {
          if (target !== undefined) {
            target.classList.add('hc-bad')
          }
          stepCompleted(false)
        }
      })
    }

    const startPointer = (element, drawFunction) => {
      tabindex(arena, 'editable', -1)
      if (currentStep === undefined || currentStep.type !== 'connect') return

      if (currentStep.source !== element) {
        element.classList.add('hc-bad')
        stepCompleted(false)
      }

      if (currentStep.target.classList.contains('editable'))
        tabindex(arena, 'editable', 0)
      else
        tabindex(arena, 'selectable-node', 0)

      rubberbandStarted = true
      rubberbandDrawFunction = to => (drawFunction ?? drawPointer)(element, to)
      commonUI.instruction(null, { secondary: _('od_arrow_end') }, {
        removeBadMarkers: true
      })
      element.focus()
    }

    function completePointer(element) {
      rubberbandStarted = false
      repaintRubberband()
      if (element === currentStep.target) {
        stepCompleted(true)
      } else {
        element.classList.add('hc-bad')
        commonUI.instruction(null, { secondary: _('od_arrow_start') })
        stepCompleted(false)
      }
    }

    const stepCompleted = (success, actual) => {
      if (success) {
        if ('alreadySelected' in currentStep && currentStep.alreadySelected < currentStep.values)
          commonUI.correct(null) // don't save partial state
        else {
          if ('done' in currentStep) currentStep.done(actual)
          tracerElement.state.lastStep = currentStepIndex
          commonUI.correct(tracerElement.state)
        }
        currentStep.actual = actual
        prepareNextStep()
      } else {
        commonUI.error(tracerElement.state, doStep, {
          afterAction: prepareNextStep
        })
      }
    }

    // https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript/47593316#47593316
    const mulberry32 = seed => () => {
      let t = seed += 0x6D2B79F5
      t = Math.imul(t ^ t >>> 15, t | 1)
      t ^= t + Math.imul(t ^ t >>> 7, t | 61)
      return ((t ^ t >>> 14) >>> 0) / 4294967296
    }

    let random = mulberry32((Math.random() * 4294967296) >>> 0)

    const sim = { // The object that is passed to the algorithm
      // Utility functions
      randSeed: seed => {
        if (seed === undefined) seed = Math.random()
        random = mulberry32((seed * 4294967296) >>> 0)
        return seed
      },
      randInt: (a, b) => {
        // a <= r <= b
        return Math.floor(a + (b - a + 1) * random())
      },
      randDouble: (a, b) => {
        return a + (b - a) * random()
      },
      randFloat: (a, b) => {
        return a + (b - a) * random()
      },
      randBoolean: () => {
        return random() < 0.5
      },
      randIntArray: (n, low, high) => {
        const a = []
        for (let i = 0; i < n; i++) {
          a.push(sim.randInt(low, high))
        }
        return a
      },
      randDistinctInts: (n, low, high) => {
        if (n > high - low + 1) throw new Error(`Not ${n} distinct integers between ${low} and ${high}`)
        const candidates = []
        for (let i = low; i <= high; i++) candidates.push(i)
        const a = []
        for (let i = 0; i < n; i++) {
          const k = sim.randInt(0, candidates.length - 1)
          a.push(candidates[k])
          candidates[k] = candidates[candidates.length - 1]
          candidates.splice(k, 1)
        }
        return a
      },
      randIntArray2: (r, c, low, high) => {
        const a = []
        for (let i = 0; i < r; i++) {
          const b = []
          for (let _j2 = 0; _j2 < c; _j2++) {
            b.push(sim.randInt(low, high))
          }
          a.push(b)
        }
        return a
      },
      randSelect: (...args) => {
        return args[sim.randInt(0, args.length - 1)]
      },
      randString: (len, a, b) => {
        let result = ''
        for (let i = 0; i < len; i++)
          result += sim.randCodePoint(a, b)
        return result
      },
      randCodePoint: (c, d) => {
        const a = Number.isInteger(c) ? c : c.codePointAt(0)
        const b = Number.isInteger(d) ? d : d.codePointAt(0)
        return String.fromCodePoint(sim.randInt(a, b))
      },

      // Public API

      eq: (x, y) => {
        if (x === null || x instanceof Null)
          return y === null || y instanceof Null
        else if (horstmann_common.isScalar(x) && horstmann_common.isScalar(y))
          return x.valueOf() === y.valueOf()
        else if (x instanceof Ref && y instanceof Ref)
          return x.$valueOf() === y.$valueOf()
        else if (x instanceof Ref)
          return x.$valueOf() === y
        else if (y instanceof Ref)
          return x === y.$valueOf()
        else if (x instanceof Addr && y instanceof Addr)
          return x.deref().$name === y.deref().$name
        else
          return x === y
      },

      pause: (prompt, secondary) => {
        return {
          type: 'pause',
          prompt,
          secondary
        }
      },

      start: (state, prompt, secondary) => {
        return {
          type: 'start',
          state,
          prompt,
          secondary
        }
      },

      next: (prompt, secondary) => {
        return {
          type: 'next',
          prompt,
          secondary
        }
      },

      click: (label, prompt, secondary) => {
        return {
          type: 'select',
          elements: [buttons.get(label)],
          prompt: prompt ?? _('od_click_button'),
          secondary,
          value: label,
          description: `Next step: ${label}`
        }
      },

      // TODO: Also makes sense for selectable
      askIf: (predicate, sampleValue, prompt, secondary) => {
        return {
          type: 'input',
          select: true,
          predicate,
          value: sampleValue,
          prompt: prompt ?? _('od_enter_value'),
          secondary,
          description: `The new value is ${sampleValue}`
        }
      },

      // values: array of scalars or regex, initial element is preferred value
      // TODO: Also makes sense for selectable
      askAny: (values, prompt, secondary) => {
        return {
          type: 'input',
          select: true,
          values,
          value: values[0],
          prompt: prompt ?? _('od_enter_value'),
          secondary,
          description: `The new value is ${values[0]}`
        }
      },

      askAll: (values, prompt, secondary) => {
        if (values.some(v => v instanceof Node && v.$toplevel))
          tabindex(arena, 'selectable-node', 0)
        if (values.some(v => v instanceof GraphEdge))
          tabindex(arena, 'selectable-edge', 0)
        return {
          type: 'select',
          values,
          alreadySelected: [],
          prompt: prompt ?? 'Select the target.',
          secondary,
          done: () => {
            tabindex(arena, 'selectable-node', -1)
            tabindex(arena, 'selectable-edge', -1)
          },
          description: `Selecting ${values.map(v => v.$name)}`
        }
      },

      ask: (value, prompt, secondary) => {
        if (value === undefined || horstmann_common.isScalar(value)) {
          return {
            type: 'input',
            select: true,
            value,
            prompt: prompt ?? _('od_enter_value'),
            secondary,
            description: `The new value is ${value}`
          }
        } else if (value instanceof Null) {
          tabindex(arena, 'selectable-field', 0)
          return {
            type: 'select',
            elements: [value.$valueContainer],
            value,
            prompt: prompt ?? 'Select the location of the null pointer',
            secondary,
            done: () => tabindex(arena, 'selectable-field', -1), // ???
            description: 'TODO'
          }
        } else if (value instanceof Addr) {
          tabindex(arena, 'editable', 0)
          return {
            type: 'select',
            elements: [value.deref().$valueContainer],
            value,
            prompt: prompt ?? 'Select the pointer target.',
            secondary,
            done: () => tabindex(arena, 'editable', -1),
            description: 'TODO'
          }
        } else if (value instanceof Ref) {
          tabindex(arena, 'selectable-node', 0)
          return {
            type: 'select',
            elements: [value.$valueOf().$element],
            value,
            prompt: prompt ?? 'Select the target.',
            secondary,
            done: () => tabindex(arena, 'selectable-node', -1),
            description: `Selecting ${value.$valueOf().$name}`
          }
        } else if (value instanceof GraphEdge) {
          tabindex(arena, 'selectable-edge', 0)
          return {
            type: 'select',
            elements: undefined, // Can't use SVG because they move
            value,
            prompt: prompt ?? 'Select the edge.',
            secondary,
            done: () => tabindex(arena, 'selectable-edge', -1),
            description: `Selecting ${value.$name}`
          }
        } else if (value instanceof Node && value.$toplevel) {
          tabindex(arena, 'selectable-node', 0)
          return {
            type: 'select',
            // elements: [value.$element],
            value,
            prompt: prompt ?? 'Select the target.',
            secondary,
            done: () => tabindex(arena, 'selectable-node', -1),
            description: `Selecting ${value.$name}`
          }
        } else {
          alert(`Cannot ask for ${value}`)
          return undefined
        }
      },

      /**
         @param lhs a path
         @param rhs the value to be set: An Addr, heap node, or scalar (string, number, boolean)
         @param prompt the optional prompt
         @param secondary the optional secondary prompt
      */
      set: (lhs, rhs, prompt, secondary) => {
        if (!(typeof lhs === 'object' && '$assign' in lhs)) {
          alert(`${lhs} is not a path`)
        }

        if (!sim.silent)
          tabindex(arena, 'editable', 0)
        if (horstmann_common.isScalar(rhs)) {
          return {
            type: 'input',
            value: rhs,
            prompt: prompt ?? _('od_update_value'),
            secondary,
            element: lhs.$valueContainer,
            select: true,
            done: () => {
              if (!sim.silent)
                tabindex(arena, 'editable', -1)
              lhs.$assign(rhs)
            },
            description: `Setting ${lhs.$name} to ${rhs}`
          }
        } else if (rhs instanceof Addr) {
          return {
            type: 'connect',
            source: lhs.$valueContainer,
            target: rhs.deref().$valueContainer, // TODO pointers to fields
            prompt: prompt ?? _('od_arrow_start_end.'),
            done: () => lhs.$assign(rhs),
            description: `Connecting ${lhs.$name} to ${rhs.$name}`
          }
        } else if (rhs instanceof Ref) {
          return {
            type: 'connect',
            source: lhs.$valueContainer,
            target: rhs.$valueOf().$element,
            prompt: prompt ?? _('od_arrow_start_end'),
            done: () => lhs.$assign(rhs),
            description: `Connecting ${lhs.$name} to ${rhs.$valueOf().$name}`
          }
        } else if (rhs.$toplevel) {
          return {
            type: 'connect',
            source: lhs.$valueContainer,
            target: rhs.$element,
            prompt: prompt ?? _('od_arrow_start_end'),
            done: () => lhs.$assign(rhs),
            description: `Connecting ${lhs.$name} to ${rhs.$name}`
          }
        } else {
          alert(`Cannot set ${lhs} to ${rhs}`)
          return undefined
        }
      },

      add: (gridX, gridY, node) => {
        node.$toplevel = true
        if (!sim.silent) {
          if (!('$sim' in node))
            node.$attach?.(sim)
          if (node instanceof NamedValuesNode)
            node.$element.classList.add('heap')
          arenaTopLevelNodes.push(node.$element)

          setPosition(node.$element, gridX, gridY)
          arena.appendChild(node.$element)
          nodeResizeObserver.observe(node.$element)
          resize()
        }
        return node
      },

      remove: (node) => {
        if (sim.silent) return
        if (node instanceof Ref) node = node.$node
        node?.$forEachDescendant((name, path) => {
          sim.removeConnectorsFrom(path.$valueContainer)
          sim.removeConnectorsTo(path.$valueContainer)
        })
        sim.removeConnectorsFrom(node.$element)
        sim.removeConnectorsTo(node.$element)

        arena.removeChild(node.$element)
        arenaTopLevelNodes.splice(arenaTopLevelNodes.indexOf(node.$element), 1)
        resize()
      },

      addButtons: (...labels) => {
        if (sim.silent) return
        for (const label of labels) {
          const button = commonUI.addButton(label, (button) => { selected(button, label) })
          buttons.set(label, button)
        }
      },

      // Internal API

      resize: () => {
        if (sim.silent) return
        resize()
      },

      /**
         @param path the path to the value
      */
      renderValue: (path) => {
        if (typeof path === 'object' && 'type' in path) {
          console.warn(`Right hand side is ${JSON.stringify(path)}. Forgotten yield?`)
        }
        const valueContainer = path.$valueContainer
        sim.removeConnectorsFrom(valueContainer)
        if (horstmann_common.isScalar(path)) {
          setTextContent(valueContainer, path)
        } else if (path instanceof Null) {
          setTextContent(valueContainer, '⏺')
        } else if (path instanceof Ref) {
          const targetDescription = `Arrow to ${path.$valueOf().$name}`
          setTextContent(valueContainer, undefined, targetDescription)
          const target = path.$valueOf().$element
          if (target !== undefined) { // Could be that target not yet attached
            sim.addConnector(valueContainer, target, path.$drawConnector ?? drawPointer)
          }
        } else if (path instanceof Addr) {
          const targetDescription = `Arrow to ${path.deref().$name}`
          setTextContent(valueContainer, undefined, targetDescription)
          const target = path.deref().$valueContainer
          if (target !== undefined) {
            sim.addConnector(valueContainer, target, path.$drawConnector ?? drawPointer)
          }
        } else if (path instanceof NamedValuesNode) { // embedded
          // TODO More general, if '$element' in path ???
          if (!('$sim' in path)) {
            path.$attach?.(sim)
            path.$element.classList.add('struct') // TODO Find better place? Call it 'embedded'?
          }
          valueContainer.innerHTML = ''
          valueContainer.appendChild(path.$element)
        }
      },

      removeConnectorsFrom: (from) => {
        if (sim.silent) return
        if (connectorsFrom.has(from)) {
          for (const [to, data] of connectorsFrom.get(from).entries()) {
            data.svg.remove()
            if (data.element !== undefined) data.element.remove()
            connectorsTo.get(to).delete(from)
          }
          connectorsFrom.delete(from)
        }
      },

      removeConnectorsTo: (to) => {
        if (sim.silent) return
        if (connectorsTo.has(to)) {
          for (const from of [...connectorsTo.get(to)]) {
            const data = connectorsFrom.get(from).get(to)
            data.svg.remove()
            if (data.element !== undefined) data.element.remove()
          }
          connectorsTo.delete(to)
        }
      },

      dragTo: (x, y, node) => {
        node.$element.style.left = x + 'em'
        node.$element.style.top = y + 'em'
        const connectorArena = arena.nextSibling
        const from = node.$element
        const tos = connectorsFrom.get(from)
        if (tos !== undefined) {
          for (const [to, data] of tos.entries()) {
            data.svg.remove()
            const svg = data.draw(from, getBounds(to))
            connectorArena.appendChild(svg)
            tos.set(to, { ...data, svg })
            center(data.element, from, to)
          }
        }
        const to = node.$element
        const froms = connectorsTo.get(to)
        if (froms !== undefined) {
          for (const from of froms) {
            const tos = connectorsFrom.get(from)
            const data = tos.get(to)
            data.svg.remove()
            const svg = data.draw(from, getBounds(to))
            connectorArena.appendChild(svg)
            tos.set(to, { ...data, svg })
            center(data.element, from, to)
          }
        }
        resize()
      },
      /**
       * @param from the element where the connector starts
       * @param to the element where the connector ends
       * @param draw a function (element, bounds) => svg that is used for redrawing when nodes move
       *        and for rubberbanding
       * @param element an optional element displayed in the connector (such as an edge weight)
       */
      addConnector: (from, to, draw, element) => {
        if (sim.silent) return
        const connectorArena = arena.nextSibling
        const svg = draw(from, getBounds(to))
        let tos = connectorsFrom.get(from)
        if (tos === undefined) {
          tos = new Map()
          connectorsFrom.set(from, tos)
        }
        tos.set(to, { draw, svg, element })
        let froms = connectorsTo.get(to)
        if (froms === undefined) {
          froms = new Set()
          connectorsTo.set(to, froms)
        }
        froms.add(from)
        connectorArena.appendChild(svg)
        if (element !== undefined) {
          arena.appendChild(element)
          center(element, from, to)
        }
        resize()
      },

      selectable: (element, type, value) => { // value can be undefined
        element.classList.add('selectable-' + type)
        element.addEventListener('click', e => {
          selected(element, value)
        })
        element.addEventListener('dblclick', e => {
          e.preventDefault()
        })
        element.addEventListener('keydown', e => {
          if (currentStep === undefined || currentStep.type !== 'select') return
          if (e.keyCode === 32) {
            e.stopPropagation()
            e.preventDefault()
            selected(element, value)
          }
        })
      },

      editable: element => {
        element.classList.add('editable')
        element.addEventListener('click', e => {
          if (currentStep === undefined || currentStep.type !== 'input') return
          e.stopPropagation()
          e.preventDefault()
          editStarted(element)
        })
        element.addEventListener('dblclick', e => {
          if (currentStep === undefined || currentStep.type !== 'input') return
          e.stopPropagation()
          e.preventDefault()
          editStarted(element)
        })
        element.addEventListener('keydown', e => {
          if (currentStep === undefined || currentStep.type !== 'input') return
          if (e.keyCode === 32) {
            e.stopPropagation()
            e.preventDefault()
            editStarted(element)
          }
        })
      },

      connectionSource: (element, drawFunction) => {
        element.addEventListener('keydown', function(e) {
          if (currentStep === undefined || currentStep.type !== 'connect') return
          if (rubberbandStarted) return
          if (e.keyCode === 32) {
            e.stopPropagation()
            e.preventDefault()
            startPointer(element, drawFunction)
          }
        })

        const mousedownListener = function(e) {
          if (currentStep === undefined || currentStep.type !== 'connect') return
          if (rubberbandStarted) return
          e.stopPropagation()
          startPointer(element, drawFunction)
        }
        element.addEventListener('mousedown', mousedownListener)
        element.addEventListener('touchstart', mousedownListener, { passive: true })

        // If the mouse goes up where it went down, don't count the
        // event. Otherwise, it's not possible to click on the source
        // and the target separately
        const mouseupListener = function(e) {
          if (rubberbandStarted && currentStep.source === element) {
            e.stopPropagation()
          }
        }
        element.addEventListener('mouseup', mouseupListener)
        element.addEventListener('touchend', mouseupListener)
      },
      connectionTarget: element => {
        element.addEventListener('keydown', function(e) {
          if (!rubberbandStarted) return
          if (e.keyCode === 32) {
            e.stopPropagation()
            e.preventDefault()
            completePointer(element)
          }
        })
        element.addEventListener('focus', function(e) {
          if (rubberbandStarted && currentStep.source !== element) {
            repaintRubberband(getBounds(element))
          }
        })

        const mouseupListener = function(e) {
          if (rubberbandStarted && currentStep.source !== element) {
            e.stopPropagation()
            completePointer(element)
          }
        }
        element.addEventListener('mouseup', mouseupListener)
        element.addEventListener('touchend', mouseupListener)
      },
      draggable: node => {
        const mousedownListener = function(e) {
          if (dragStarted) return
          e.stopPropagation()
          dragStarted = true
          draggedNode = node
          const targetRect = e.currentTarget.getBoundingClientRect()
          dragOffset = { x: e.clientX - targetRect.left, y: e.clientY - targetRect.top }
        }
        node.$element.addEventListener('mousedown', mousedownListener)
        node.$element.addEventListener('touchstart', mousedownListener, { passive: true })
      }
    }

    // Plays the remaining steps with a delay
    const playSteps = doneAction => {
      getNextStep()
      if (currentStep !== undefined) {
        commonUI.instruction(null, { secondary: currentStep.description })
        doStep()
        setTimeout(() => { playSteps(doneAction) }, PLAY_STEP_DELAY)
      } else {
        commonUI.instruction(null, { secondary: '' })
        doneAction()
      }
    }

    /**
      Does the current step non-interactively (in play, show next steps)
    */
    const doStep = () => {
      if (currentStep.type === 'select') {
        if ('alreadySelected' in currentStep) { // askAll
          // Find element that is not already selected
          let found = false
          let i = 0
          while (!found && i < currentStep.values.length) {
            if (!currentStep.alreadySelected.includes(currentStep.values[i]))
              found = true
            else
              i++
          }
          const selected = currentStep.values[i]
          currentStep.alreadySelected.push(selected)
          if ('$svg' in selected) // GraphEdge have both $svg and $element
            selected.$svg.classList.add('hc-selected')
          else
            selected.$element.classList.add('hc-selected')
        } else if ('elements' in currentStep) {
          const element = currentStep.elements[0]
          element.classList.add('hc-good')
        }
      }
      if ('done' in currentStep)
        currentStep.done()
      tracerElement.state.lastStep = currentStepIndex
      return tracerElement.state
    }

    function repaintRubberband(to) {
      const connectorArena = arena.nextSibling
      const items = connectorArena.getElementsByClassName('rubberband')
      if (items.length > 0) connectorArena.removeChild(items[0])

      if (rubberbandStarted) {
        const rubberband = rubberbandDrawFunction(to)
        rubberband.classList.add('rubberband') // TODO Why use classList?
        connectorArena.appendChild(rubberband)
        resize()
      }
    }

    const initArena = () => {
      arenaTopLevelNodes = []
      connectorsFrom = new Map()
      connectorsTo = new Map()

      let container = null
      if (arena) { // start over
        container = arena.parentNode
        arena.innerHTML = ''
        const connectorArena = arena.nextSibling
        connectorArena.innerHTML = ''
      } else {
        container = document.createElement('div')
        tracerElement.appendChild(container)
        container.classList.add('arenaContainer')
        arena = document.createElement('div')
        arena.style.position = 'absolute' // TODO in CSS? (validator)
        container.appendChild(arena)
        const connectorArena = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        // svg.style.width = '100%' // Doesn't work in CSS
        // svg.style.height = '100%'
        connectorArena.style.position = 'absolute'
        connectorArena.style.pointerEvents = 'none'
        container.appendChild(connectorArena)

        const mousemoveListener = function(e) {
          const outerRect = container.getBoundingClientRect()
          if (rubberbandStarted) {
            e.stopPropagation()
            repaintRubberband({
              x: pxToEm(e.pageX - outerRect.left - window.scrollX),
              y: pxToEm(e.pageY - outerRect.top - window.scrollY),
              width: 0,
              height: 0
            })
          } else if (dragStarted) {
            e.stopPropagation()
            const x = pxToEm(e.pageX - outerRect.left - window.scrollX - dragOffset.x)
            const y = pxToEm(e.pageY - outerRect.top - window.scrollY - dragOffset.y)
            sim.dragTo(x, y, draggedNode)
          }
        }
        arena.addEventListener('mousemove', mousemoveListener)
        /*
        arena.addEventListener('touchmove', mousemoveListener, {passive: true})
        */

        const mouseupListener = function(e) {
          if (dragStarted) {
            e.stopPropagation()
            dragStarted = false
          }
        }
        arena.addEventListener('mouseup', mouseupListener)
        arena.addEventListener('touchend', mouseupListener)
      }
    }

    /*
      Prepares the visual appearance for the next interactive step
    */
    const prepareNextStep = () => {
      getNextStep()
      if (currentStep === undefined) {
        if (currentStepIndex > 1) 
          commonUI.done(doneAction => {
            initState(tracerElement.state)
            setTimeout(() => {
              playSteps(doneAction)
            }, PLAY_STEP_DELAY)
          })
        else commonUI.done()
      } else {
        const prompt = currentStep.prompt || ''
        if (currentStep.type === 'next') {
          commonUI.instruction(prompt, {
            secondary: currentStep.secondary,
            nextAction: () => {
              doStep()
              prepareNextStep()
            }
          })
        } else if (currentStep.type === 'pause') {
          commonUI.instruction(prompt, { secondary: currentStep.secondary })
          setTimeout(prepareNextStep, PAUSE_DELAY)
        } else if (currentStep.type === 'input') {
          if (currentStep.element === undefined) {
            commonUI.instruction(prompt, { secondary: currentStep.secondary })
            editStarted(undefined)
          } else if (currentStep.select) {
            commonUI.instruction(prompt, {
              secondary: currentStep.secondary || _('od_select_value')
            })
          } else {
            commonUI.instruction(prompt, { secondary: currentStep.secondary })
            editStarted(currentStep.element)
          }
        } else {
          commonUI.instruction(prompt, { secondary: currentStep.secondary })
        }
      }
    }

    const countSteps = (data) => {
      sim.silent = true
      stepIter = algo(sim, data)
      currentStep = undefined
      currentStepIndex = -1
      let steps = 0
      let done = false
      let maxscore = 0
      let startFound = false
      let startState
      while (!done) {
        getNextStep()
        if (currentStep === undefined) done = true
        else {
          if ('alreadySelected' in currentStep) {
            currentStep.alreadySelected = currentStep.values
            steps += currentStep.values.length
          } else {
            steps++
          }
          if (!['start', 'next', 'pause'].includes(currentStep.type))
            maxscore++
          else if (currentStep.type === 'start' && steps === 1) {
            startFound = true
            startState = currentStep.state
          }
          if ('done' in currentStep) currentStep.done()
        }
      }
      sim.silent = false
      return { maxscore, startFound, startState, steps }
    }

    const initState = from => {
      tracerElement.state = {
        data: from === null || from === undefined ? undefined : from.data,
        lastStep: -1
      }
      const algoData = countSteps(tracerElement.state.data)
      tracerElement.state.data = algoData.startState
      initArena()
      counters = {}
      stepIter = algo(sim, tracerElement.state.data)
      if (algoData.startFound) getNextStep()
      currentStep = undefined
      currentStepIndex = -1
      return algoData
    }

    /*
      Sends the current result back to the algo iterator and gets the next
      step.
    */
    const getNextStep = () => {
      let lastResult = undefined
      if (currentStep !== undefined) {
        lastResult = currentStep.actual ?? currentStep.value
        if ('alreadySelected' in currentStep) {
          if (currentStep.alreadySelected.length < currentStep.values.length)
            return // Stay in current step
          else
            currentStep.alreadySelected = []
        }
      }

      const nextStep = stepIter.next(lastResult)
      if (!nextStep.done &&
          (typeof nextStep.value !== 'object' ||
           !('type' in nextStep.value) ||
           !['input', 'select', 'pause', 'next', 'start', 'connect'].includes(nextStep.value.type))) {
        alert('Unexpected step ' + JSON.stringify(nextStep))
      }
      if (currentStepIndex !== -1 && nextStep.value === 'start') {
        alert('Unexpected start ' + JSON.stringify(nextStep))
      }
      currentStep = nextStep.done ? undefined : nextStep.value
      currentStepIndex++
    }

    const restoreState = state => {
      const algoData = initState(state)
      if (state && (state.correct > 0 || state.errors > 0)) {
        // Play the first steps
        while (currentStepIndex < state.lastStep) {
          getNextStep()
          doStep()
        }
        prepareNextStep() // Prepare the UI for the next step (or show Good Job!)
      }
      return algoData
    }

    const commonUI = horstmann_common.uiInit(tracerElement, prepareNextStep, {
      ...config,
      interactive: true // TODO
    })
    commonUI.restore(restoreState)
    tabindex(arena, 'selectable-line', 0)
    tabindex(arena, 'selectable-node', 0)
    tabindex(arena, 'editable', 0)
  }

  // Start of event listener
  const elements = [...document.getElementsByClassName('codecheck_tracer')]
  while (elements.length < setup.length) {
    const element = document.createElement('div')
    element.classList.add('codecheck_tracer')
    elements.push(element)
    document.getElementsByTagName('body')[0].appendChild(element)
  }
  if ('SPLICE' in window) {
    if (!('horstmann_config' in window)) window.horstmann_config = {}
    window.horstmann_config.retrieve_state = (element, callback) => {
      window.SPLICE.getState(element.id, state => callback(element, state))
    }
    window.horstmann_config.score_change_listener = (element, state, score) => {
      window.SPLICE.reportScoreAndState(element.id, score, state)
    }
  }
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index]
    element.id = 'codecheck_tracer' + (index + 1)
    initElement(element, setup[index])
  }
})