<script setup lang="ts">
import { FieldCheckbox } from '@proj-airi/ui'
import FieldRange from '@proj-airi/ui/src/components/Form/Field/FieldRange.vue'
import { useCssVar, useElementBounding, useEventListener, useLocalStorage } from '@vueuse/core'

import { Bodies, Body, Composite, Engine, Render } from 'matter-js'
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useTicker } from './composables/useTicker'

const gameContentRef = useTemplateRef<HTMLDivElement>('gameContentRef')
const {
  width: gameContentWidth,
} = useElementBounding(gameContentRef)
const viewportWidth = useCssVar('--viewport-width')
watch(gameContentWidth, (width) => {
  viewportWidth.value = width.toString()
})

const showMatterJsRenderer = ref(false)

const largeBoxVelocity = ref({
  x: 0,
  y: 0,
  angle: 0,
})

const largeBoxAcceleration = ref({
  x: 0,
  y: 0,
  angle: 0,
})

const MAX_VELOCITY = {
  x: 15,
  y: 15,
  angle: 360,
} as const

const MAX_ACCELERATION = {
  x: 3,
  y: 3,
  angle: 180,
} as const

const LARGE_BOX_CENTER_INITIAL = {
  x: 360,
  y: 360,
}
const LARGE_BOX_OFFSETS = {
  left: { x: -180, y: 0 },
  right: { x: 180, y: 0 },
  bottom: { x: 0, y: 180 },
} as const
const LARGE_BOX_DIMENSIONS = {
  left: { width: 4, height: 360 },
  right: { width: 4, height: 360 },
  bottom: { width: 360, height: 4 },
} as const
const LARGE_BOX_HALF_SIZE = {
  x: LARGE_BOX_DIMENSIONS.bottom.width / 2,
  y: LARGE_BOX_DIMENSIONS.left.height / 2,
} as const
const SMALL_BOX_HALF_SIZE = {
  x: 90,
  y: 90,
} as const
const LARGE_BOX_INSIDE_TOLERANCE = 12

interface Vector2 {
  x: number
  y: number
}

function rotateVector(offset: Vector2, cos: number, sin: number): Vector2 {
  return {
    x: offset.x * cos - offset.y * sin,
    y: offset.x * sin + offset.y * cos,
  }
}

function getOrientedCorners(center: Vector2, halfSize: Vector2, angle: number): Vector2[] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const localCorners: Vector2[] = [
    { x: -halfSize.x, y: -halfSize.y },
    { x: halfSize.x, y: -halfSize.y },
    { x: halfSize.x, y: halfSize.y },
    { x: -halfSize.x, y: halfSize.y },
  ]

  return localCorners.map((corner) => {
    const rotated = rotateVector(corner, cos, sin)
    return {
      x: center.x + rotated.x,
      y: center.y + rotated.y,
    }
  })
}

function isPointInsideOrientedRect(
  point: Vector2,
  center: Vector2,
  halfSize: Vector2,
  angle: number,
  tolerance = 0,
): boolean {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = point.x - center.x
  const dy = point.y - center.y

  const localX = dx * cos + dy * sin
  const localY = -dx * sin + dy * cos

  return Math.abs(localX) <= halfSize.x + tolerance && Math.abs(localY) <= halfSize.y + tolerance
}

const largeBoxCenter = ref({ ...LARGE_BOX_CENTER_INITIAL })
const largeBoxAngle = ref(0)

const largeBoxTransformLeft = ref({
  x: LARGE_BOX_CENTER_INITIAL.x + LARGE_BOX_OFFSETS.left.x - LARGE_BOX_DIMENSIONS.left.width / 2,
  y: LARGE_BOX_CENTER_INITIAL.y + LARGE_BOX_OFFSETS.left.y - LARGE_BOX_DIMENSIONS.left.height / 2,
  angle: 0,
})
const largeBoxTransformRight = ref({
  x: LARGE_BOX_CENTER_INITIAL.x + LARGE_BOX_OFFSETS.right.x - LARGE_BOX_DIMENSIONS.right.width / 2,
  y: LARGE_BOX_CENTER_INITIAL.y + LARGE_BOX_OFFSETS.right.y - LARGE_BOX_DIMENSIONS.right.height / 2,
  angle: 0,
})
const largeBoxTransformBottom = ref({
  x: LARGE_BOX_CENTER_INITIAL.x + LARGE_BOX_OFFSETS.bottom.x - LARGE_BOX_DIMENSIONS.bottom.width / 2,
  y: LARGE_BOX_CENTER_INITIAL.y + LARGE_BOX_OFFSETS.bottom.y - LARGE_BOX_DIMENSIONS.bottom.height / 2,
  angle: 0,
})
const smallBoxTransform = ref({
  x: 360 - 90,
  y: 360 - 90,
  angle: 0,
})
const isSmallBoxInsideLargeBox = ref(false)
const isLargeBoxInsideViewport = ref(false)
const modelFileInputRef = useTemplateRef<HTMLInputElement>('modelFileInputRef')
const modelStatusMessage = ref('')
const modelStatusLevel = ref<'success' | 'error' | ''>('')
let modelStatusTimeout: number | null = null

const learningRate = useLocalStorage('learning-rate', 0.01)
const discountFactor = useLocalStorage('discount-factor', 0.99)
const epsilon = useLocalStorage('epsilon', 0.1)
const simulationSpeed = useLocalStorage('simulation-speed', 1) // Physics simulation speed multiplier, 1 = normal speed

// Training state
const isTraining = ref(false)
const currentEpisode = ref(0)
const currentStep = ref(0)
const totalReward = ref(0)
const episodeRewards = ref<number[]>([])
const averageReward = computed(() => {
  if (episodeRewards.value.length === 0)
    return 0
  const last100 = episodeRewards.value.slice(-100)
  return last100.reduce((a, b) => a + b, 0) / last100.length
})

// Q-Table (simple implementation with state discretization)
const qTable = ref<Map<string, number[]>>(new Map())
const MODEL_FILE_VERSION = 1

interface SavedModelFile {
  version: number
  savedAt: string
  qTable: Array<[string, number[]]>
  hyperParams: {
    learningRate: number
    discountFactor: number
    epsilon: number
  }
}

// Small box speed (for display)
const smallBoxSpeed = ref(0)

const engine = Engine.create()
// Set physics simulation time scale
engine.timing.timeScale = simulationSpeed.value

const largeBox = {
  left: Bodies.rectangle(180, 360, 4, 360, { isStatic: true }),
  right: Bodies.rectangle(540, 360, 4, 360, { isStatic: true }),
  bottom: Bodies.rectangle(360, 540, 360, 4, { isStatic: true }),
}
Composite.add(engine.world, [largeBox.left, largeBox.right, largeBox.bottom])

const smallBox = Bodies.rectangle(360, 360, 180, 180)
Composite.add(engine.world, smallBox)

// Expand ground to prevent small box from falling infinitely
// Lower position, wider width
const ground = Bodies.rectangle(360, 900, 1440, 100, { isStatic: true })
Composite.add(engine.world, ground)

useEventListener(window, 'keydown', (event) => {
  if (event.code === 'KeyS') {
    largeBoxAcceleration.value.y = Math.min(MAX_ACCELERATION.y, largeBoxAcceleration.value.y + 0.5)
  }
  if (event.code === 'KeyW') {
    largeBoxAcceleration.value.y = Math.max(-MAX_ACCELERATION.y, largeBoxAcceleration.value.y - 0.5)
  }
  if (event.code === 'KeyA') {
    largeBoxAcceleration.value.x = Math.max(-MAX_ACCELERATION.x, largeBoxAcceleration.value.x - 0.5)
  }
  if (event.code === 'KeyD') {
    largeBoxAcceleration.value.x = Math.min(MAX_ACCELERATION.x, largeBoxAcceleration.value.x + 0.5)
  }
  if (event.code === 'KeyQ') {
    largeBoxAcceleration.value.angle = Math.max(-MAX_ACCELERATION.angle, largeBoxAcceleration.value.angle - 5)
  }
  if (event.code === 'KeyE') {
    largeBoxAcceleration.value.angle = Math.min(MAX_ACCELERATION.angle, largeBoxAcceleration.value.angle + 5)
  }
})

// State space definition
const stateSpace = {
  low: [0, 0, 0, -MAX_VELOCITY.x, -MAX_VELOCITY.y, -MAX_VELOCITY.angle, 0],
  high: [720, 720, 360, MAX_VELOCITY.x, MAX_VELOCITY.y, MAX_VELOCITY.angle, 1],
  shape: [7],
}

// Discretize state (for Q-learning)
function discretizeState(state: number[]): string {
  const bins = [20, 20, 12, 10, 10, 12, 2] // Number of discretization bins for each dimension
  const discretized = state.map((value, i) => {
    const min = stateSpace.low[i]
    const max = stateSpace.high[i]
    const binSize = (max - min) / bins[i]
    const clamped = Math.max(min, Math.min(max, value))
    return Math.min(bins[i] - 1, Math.floor((clamped - min) / binSize))
  })
  return discretized.join(',')
}

// Get current state
function getCurrentState(): number[] {
  const normalizedAngle = ((largeBoxAngle.value * 180 / Math.PI) % 360 + 360) % 360
  return [
    largeBoxCenter.value.x,
    largeBoxCenter.value.y,
    normalizedAngle,
    largeBoxVelocity.value.x,
    largeBoxVelocity.value.y,
    largeBoxVelocity.value.angle,
    isSmallBoxInsideLargeBox.value ? 1 : 0,
  ]
}

// Calculate reward
function calculateReward(): number {
  let reward = 0

  // Calculate small box speed
  const smallBoxSpeed = Math.sqrt(
    smallBox.velocity.x ** 2
    + smallBox.velocity.y ** 2,
  )

  // Check if small box falls too far out of viewport
  const smallBoxY = smallBox.position.y
  if (smallBoxY > 800) {
    // Small box falls too low, apply heavy penalty
    reward -= 10
  }

  // Primary goal: small box inside large box
  if (isSmallBoxInsideLargeBox.value) {
    reward += 5
  }
  else {
    reward -= 10
  }

  // Secondary goal: large box inside viewport
  if (isLargeBoxInsideViewport.value) {
    reward += 1
  }
  else {
    reward -= 5
  }

  // Constraint: small box speed cannot be too small (minimum speed threshold: 2)
  const MIN_SMALL_BOX_SPEED = 2
  if (smallBoxSpeed < MIN_SMALL_BOX_SPEED) {
    reward -= 2
  }
  else {
    // Give small reward when small box speed is appropriate
    reward += 0.5
  }

  // Penalize excessive speed (prevent infinite acceleration)
  const MAX_SMALL_BOX_SPEED = 10
  if (smallBoxSpeed > MAX_SMALL_BOX_SPEED) {
    reward -= 5
  }

  // Penalize large box excessive speed
  const largeBoxSpeed = Math.sqrt(
    largeBoxVelocity.value.x ** 2
    + largeBoxVelocity.value.y ** 2,
  )
  if (largeBoxSpeed > 10) {
    reward -= 0.5
  }

  return reward
}

// Reset environment
function resetEnvironment() {
  // Reset large box position and angle
  largeBoxCenter.value = { ...LARGE_BOX_CENTER_INITIAL }
  largeBoxAngle.value = 0
  largeBoxVelocity.value = { x: 0, y: 0, angle: 0 }
  largeBoxAcceleration.value = { x: 0, y: 0, angle: 0 }

  // Reset small box position (randomized to improve generalization)
  const randomX = 200 + Math.random() * 320
  const randomY = 200 + Math.random() * 320
  Body.setPosition(smallBox, { x: randomX, y: randomY })
  Body.setAngle(smallBox, Math.random() * Math.PI * 2)

  // Give small box random initial velocity (ensure speed is not too small)
  const angle = Math.random() * Math.PI * 2
  const speed = 1 + Math.random() * 2 // Speed between 1-3
  Body.setVelocity(smallBox, {
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed,
  })
  Body.setAngularVelocity(smallBox, 0)

  currentStep.value = 0
  totalReward.value = 0
}

// Select action (ε-greedy strategy)
function selectAction(state: string): number[] {
  if (Math.random() < epsilon.value) {
    // Exploration: random acceleration
    return [
      Math.random() * MAX_ACCELERATION.x * 2 - MAX_ACCELERATION.x,
      Math.random() * MAX_ACCELERATION.y * 2 - MAX_ACCELERATION.y,
      Math.random() * MAX_ACCELERATION.angle * 2 - MAX_ACCELERATION.angle,
    ]
  }
  else {
    // Exploitation: select action with highest Q-value
    const qValues = qTable.value.get(state) || Array.from({ length: 27 }, () => 0)
    const maxQ = Math.max(...qValues)
    const maxIndices = qValues
      .map((q, i) => (q === maxQ ? i : -1))
      .filter(i => i !== -1)
    const actionIndex = maxIndices[Math.floor(Math.random() * maxIndices.length)]

    // Convert action index to continuous acceleration
    const xIndex = Math.floor(actionIndex / 9) % 3
    const yIndex = Math.floor(actionIndex / 3) % 3
    const angleIndex = actionIndex % 3

    return [
      (xIndex - 1) * MAX_ACCELERATION.x,
      (yIndex - 1) * MAX_ACCELERATION.y,
      (angleIndex - 1) * MAX_ACCELERATION.angle,
    ]
  }
}

// Get discrete action index
function getActionIndex(action: number[]): number {
  const xIndex = Math.round((action[0] + MAX_ACCELERATION.x) / (MAX_ACCELERATION.x * 2) * 2)
  const yIndex = Math.round((action[1] + MAX_ACCELERATION.y) / (MAX_ACCELERATION.y * 2) * 2)
  const angleIndex = Math.round((action[2] + MAX_ACCELERATION.angle) / (MAX_ACCELERATION.angle * 2) * 2)
  return xIndex * 9 + yIndex * 3 + angleIndex
}

// Update Q-value
function updateQValue(
  state: string,
  action: number[],
  reward: number,
  nextState: string,
) {
  const actionIndex = getActionIndex(action)

  if (!qTable.value.has(state)) {
    qTable.value.set(state, Array.from({ length: 27 }, () => 0))
  }
  if (!qTable.value.has(nextState)) {
    qTable.value.set(nextState, Array.from({ length: 27 }, () => 0))
  }

  const qValues = qTable.value.get(state)!
  const nextQValues = qTable.value.get(nextState)!
  const maxNextQ = Math.max(...nextQValues)

  // Q-learning update formula
  qValues[actionIndex] = qValues[actionIndex]
    + learningRate.value * (reward + discountFactor.value * maxNextQ - qValues[actionIndex])
}

// Train one step
let trainingIntervalId: number | null = null
const MAX_STEPS_PER_EPISODE = 1000

function trainStep() {
  if (!isTraining.value)
    return

  const state = getCurrentState()
  const stateKey = discretizeState(state)
  const action = selectAction(stateKey)

  // Apply action as acceleration
  largeBoxAcceleration.value = {
    x: action[0],
    y: action[1],
    angle: action[2],
  }

  // Wait for physics engine update, then get next state and reward
  setTimeout(() => {
    const reward = calculateReward()
    const nextState = getCurrentState()
    const nextStateKey = discretizeState(nextState)

    // Update Q-table
    updateQValue(stateKey, action, reward, nextStateKey)

    totalReward.value += reward
    currentStep.value++

    // Check if small box is outside viewport
    const isSmallBoxOutsideViewport = smallBox.position.x < 0
      || smallBox.position.x > 720
      || smallBox.position.y < 0
      || smallBox.position.y > 720

    // Check if current episode should end
    const isDone
      = !isLargeBoxInsideViewport.value
        || currentStep.value >= MAX_STEPS_PER_EPISODE
        || (isSmallBoxInsideLargeBox.value && currentStep.value > 500) // Successfully maintained for a period
        || smallBox.position.y > 800 // Small box falls too low
        || isSmallBoxOutsideViewport // Small box flies out of viewport

    if (isDone) {
      episodeRewards.value.push(totalReward.value)
      currentEpisode.value++
      resetEnvironment()
    }
  }, 16) // Approximately 60fps
}

// Start training
function startToTrain() {
  if (isTraining.value)
    return

  isTraining.value = true
  resetEnvironment()

  // Adjust training interval based on simulation speed
  // Faster simulation speed means shorter training interval to keep up with physics simulation rhythm
  const baseInterval = 50 // Base training interval (ms)
  const actualInterval = baseInterval / simulationSpeed.value

  trainingIntervalId = window.setInterval(() => {
    trainStep()
  }, actualInterval)
}

// Stop training
function stopTraining() {
  isTraining.value = false
  if (trainingIntervalId !== null) {
    clearInterval(trainingIntervalId)
    trainingIntervalId = null
  }
  largeBoxVelocity.value = { x: 0, y: 0, angle: 0 }
  largeBoxAcceleration.value = { x: 0, y: 0, angle: 0 }
}

// Reset training
function resetTraining() {
  stopTraining()
  currentEpisode.value = 0
  currentStep.value = 0
  totalReward.value = 0
  episodeRewards.value = []
  qTable.value.clear()
  resetEnvironment()
}

function setModelStatus(message: string, level: 'success' | 'error') {
  modelStatusMessage.value = message
  modelStatusLevel.value = level
  if (modelStatusTimeout !== null)
    window.clearTimeout(modelStatusTimeout)
  modelStatusTimeout = window.setTimeout(() => {
    modelStatusMessage.value = ''
    modelStatusLevel.value = ''
    modelStatusTimeout = null
  }, 3000)
}

function saveModelToFile() {
  const data: SavedModelFile = {
    version: MODEL_FILE_VERSION,
    savedAt: new Date().toISOString(),
    qTable: Array.from(qTable.value.entries()),
    hyperParams: {
      learningRate: learningRate.value,
      discountFactor: discountFactor.value,
      epsilon: epsilon.value,
    },
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `model-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  setModelStatus('Model saved.', 'success')
}

function triggerLoadModel() {
  modelFileInputRef.value?.click()
}

async function handleModelFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file)
    return

  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as SavedModelFile
    if (!parsed.qTable || !Array.isArray(parsed.qTable))
      throw new Error('Invalid model file')
    applyLoadedModel(parsed)
    setModelStatus('Model loaded successfully.', 'success')
  }
  catch (error) {
    console.error(error)
    setModelStatus('Failed to load model. Please ensure the file is valid.', 'error')
  }
  finally {
    input.value = ''
  }
}

function applyLoadedModel(model: SavedModelFile) {
  stopTraining()
  qTable.value = new Map(model.qTable)
  if (model.hyperParams) {
    if (typeof model.hyperParams.learningRate === 'number')
      learningRate.value = model.hyperParams.learningRate
    if (typeof model.hyperParams.discountFactor === 'number')
      discountFactor.value = model.hyperParams.discountFactor
    if (typeof model.hyperParams.epsilon === 'number')
      epsilon.value = model.hyperParams.epsilon
  }

  currentEpisode.value = 0
  currentStep.value = 0
  totalReward.value = 0
  episodeRewards.value = []
  resetEnvironment()
}

// Watch simulation speed changes, update physics engine time scale and training interval in real-time
watch(simulationSpeed, (newSpeed) => {
  engine.timing.timeScale = newSpeed

  // If training is in progress, need to update training interval
  if (isTraining.value && trainingIntervalId !== null) {
    clearInterval(trainingIntervalId)
    const baseInterval = 50
    const actualInterval = baseInterval / newSpeed
    trainingIntervalId = window.setInterval(() => {
      trainStep()
    }, actualInterval)
  }
})

const { start, stop } = useTicker((deltaTime) => {
  const dt = deltaTime / 1000

  // Integrate acceleration into velocity with clamping
  largeBoxVelocity.value.x = Math.max(
    -MAX_VELOCITY.x,
    Math.min(MAX_VELOCITY.x, largeBoxVelocity.value.x + largeBoxAcceleration.value.x * dt),
  )
  largeBoxVelocity.value.y = Math.max(
    -MAX_VELOCITY.y,
    Math.min(MAX_VELOCITY.y, largeBoxVelocity.value.y + largeBoxAcceleration.value.y * dt),
  )
  largeBoxVelocity.value.angle = Math.max(
    -MAX_VELOCITY.angle,
    Math.min(MAX_VELOCITY.angle, largeBoxVelocity.value.angle + largeBoxAcceleration.value.angle * dt),
  )

  // Integrate velocity into position
  largeBoxCenter.value.x += largeBoxVelocity.value.x * dt
  largeBoxCenter.value.y += largeBoxVelocity.value.y * dt
  largeBoxAngle.value += largeBoxVelocity.value.angle * dt * Math.PI / 180

  const cos = Math.cos(largeBoxAngle.value)
  const sin = Math.sin(largeBoxAngle.value)
  const leftOffset = rotateVector(LARGE_BOX_OFFSETS.left, cos, sin)
  const rightOffset = rotateVector(LARGE_BOX_OFFSETS.right, cos, sin)
  const bottomOffset = rotateVector(LARGE_BOX_OFFSETS.bottom, cos, sin)

  Body.setPosition(largeBox.left, {
    x: largeBoxCenter.value.x + leftOffset.x,
    y: largeBoxCenter.value.y + leftOffset.y,
  })
  Body.setPosition(largeBox.right, {
    x: largeBoxCenter.value.x + rightOffset.x,
    y: largeBoxCenter.value.y + rightOffset.y,
  })
  Body.setPosition(largeBox.bottom, {
    x: largeBoxCenter.value.x + bottomOffset.x,
    y: largeBoxCenter.value.y + bottomOffset.y,
  })

  Body.setAngle(largeBox.left, largeBoxAngle.value)
  Body.setAngle(largeBox.right, largeBoxAngle.value)
  Body.setAngle(largeBox.bottom, largeBoxAngle.value)

  largeBoxTransformLeft.value = {
    x: largeBox.left.position.x - LARGE_BOX_DIMENSIONS.left.width / 2,
    y: largeBox.left.position.y - LARGE_BOX_DIMENSIONS.left.height / 2,
    angle: largeBox.left.angle,
  }

  largeBoxTransformRight.value = {
    x: largeBox.right.position.x - LARGE_BOX_DIMENSIONS.right.width / 2,
    y: largeBox.right.position.y - LARGE_BOX_DIMENSIONS.right.height / 2,
    angle: largeBox.right.angle,
  }

  largeBoxTransformBottom.value = {
    x: largeBox.bottom.position.x - LARGE_BOX_DIMENSIONS.bottom.width / 2,
    y: largeBox.bottom.position.y - LARGE_BOX_DIMENSIONS.bottom.height / 2,
    angle: largeBox.bottom.angle,
  }

  smallBoxTransform.value = {
    x: smallBox.position.x - 90,
    y: smallBox.position.y - 90,
    angle: smallBox.angle,
  }

  const smallBoxCorners = getOrientedCorners(
    { x: smallBox.position.x, y: smallBox.position.y },
    SMALL_BOX_HALF_SIZE,
    smallBox.angle,
  )
  isSmallBoxInsideLargeBox.value = smallBoxCorners.every(corner =>
    isPointInsideOrientedRect(
      corner,
      largeBoxCenter.value,
      LARGE_BOX_HALF_SIZE,
      largeBoxAngle.value,
      LARGE_BOX_INSIDE_TOLERANCE,
    ),
  )

  const largeBoxCorners = getOrientedCorners(largeBoxCenter.value, LARGE_BOX_HALF_SIZE, largeBoxAngle.value)
  isLargeBoxInsideViewport.value = largeBoxCorners.every(corner =>
    corner.x >= 0 && corner.x <= 720 && corner.y >= 0 && corner.y <= 720,
  )

  // Update small box speed display
  smallBoxSpeed.value = Math.sqrt(
    smallBox.velocity.x ** 2
    + smallBox.velocity.y ** 2,
  )

  Engine.update(engine, deltaTime)
})

onMounted(() => {
  start()

  const renderer = Render.create({
    engine,
    element: document.querySelector('#matterjs-renderer') as HTMLDivElement,
    options: {
      width: 720,
      height: 720,
      pixelRatio: globalThis.devicePixelRatio,
      showAngleIndicator: true,
    },
  })
  Render.run(renderer)
})

onUnmounted(() => {
  stop()
  stopTraining()
})
</script>

<template>
  <div class="flex items-center justify-center h-screen w-screen">
    <input
      ref="modelFileInputRef"
      type="file"
      accept="application/json"
      class="hidden"
      @change="handleModelFileSelected"
    >
    <div class="game-container font-[100pxp]">
      <div
        ref="gameContentRef"
        class="game-content"
      >
        <div class="small-box" :style="{ '--left': smallBoxTransform.x, '--top': smallBoxTransform.y, '--angle': smallBoxTransform.angle }" />
        <div class="large-box-left" :style="{ '--left': largeBoxTransformLeft.x, '--top': largeBoxTransformLeft.y, '--angle': largeBoxTransformLeft.angle }" />
        <div class="large-box-right" :style="{ '--left': largeBoxTransformRight.x, '--top': largeBoxTransformRight.y, '--angle': largeBoxTransformRight.angle }" />
        <div class="large-box-bottom" :style="{ '--left': largeBoxTransformBottom.x, '--top': largeBoxTransformBottom.y, '--angle': largeBoxTransformBottom.angle }" />
      </div>
    </div>
    <div class="game-settings-container">
      <div class="game-settings">
        <div class="card">
          <FieldCheckbox
            v-model="showMatterJsRenderer"
            label="Show Matter.js Renderer"
            description="Whether to show the Matter.js renderer"
            class="text-black w-full"
          />
        </div>
        <div class="card h-98" :class="{ hidden: !showMatterJsRenderer }">
          <div id="matterjs-renderer" class="w-180 h-180 rounded-md overflow-hidden scale-50 origin-top-left" />
        </div>
        <div class="card">
          <div class="text-black space-y-4">
            <h3 class="text-lg font-bold">
              Training Control
            </h3>
            <div class="flex gap-2">
              <button
                :disabled="isTraining"
                class="btn btn-primary flex-1"
                @click="startToTrain"
              >
                Start Training
              </button>
              <button
                :disabled="!isTraining"
                class="btn btn-secondary flex-1"
                @click="stopTraining"
              >
                Stop Training
              </button>
              <button
                class="btn btn-danger flex-1"
                @click="resetTraining"
              >
                Reset Training
              </button>
            </div>
            <div class="text-sm space-y-1">
              <div>Status: <span class="font-bold">{{ isTraining ? 'Training' : 'Stopped' }}</span></div>
              <div>Episode: <span class="font-bold">{{ currentEpisode }}</span></div>
              <div>Current Step: <span class="font-bold">{{ currentStep }}</span></div>
              <div>Current Reward: <span class="font-bold">{{ totalReward.toFixed(2) }}</span></div>
              <div>Average Reward (Last 100 Episodes): <span class="font-bold">{{ averageReward.toFixed(2) }}</span></div>
              <div>Q-Table Size: <span class="font-bold">{{ qTable.size }}</span></div>
              <div>
                Small Box Speed:
                <span class="font-bold" :class="{ 'text-red-600': smallBoxSpeed < 0.5, 'text-green-600': smallBoxSpeed >= 0.5 }">
                  {{ smallBoxSpeed.toFixed(2) }}
                </span>
                <span class="text-xs text-gray-500">(Min: 0.5)</span>
              </div>
            </div>
            <div class="flex gap-2">
              <button
                class="btn btn-outline flex-1"
                @click="saveModelToFile"
              >
                Save Model
              </button>
              <button
                class="btn btn-outline flex-1"
                @click="triggerLoadModel"
              >
                Load Model
              </button>
            </div>
            <div
              v-if="modelStatusMessage"
              class="text-xs"
              :class="modelStatusLevel === 'error' ? 'text-red-600' : 'text-green-600'"
            >
              {{ modelStatusMessage }}
            </div>
          </div>
        </div>
        <div class="card">
          <FieldRange
            v-model="learningRate"
            :min="0"
            :max="1"
            :step="0.01"
            label="Learning Rate"
            description="The learning rate of the agent"
            class="text-black w-full"
          />
        </div>
        <div class="card">
          <FieldRange
            v-model="discountFactor"
            :min="0"
            :max="1"
            :step="0.01"
            label="Discount Factor"
            description="Discount factor for future rewards"
            class="text-black w-full"
          />
        </div>
        <div class="card">
          <FieldRange
            v-model="epsilon"
            :min="0"
            :max="1"
            :step="0.01"
            label="Epsilon"
            description="Exploration probability for ε-greedy strategy"
            class="text-black w-full"
          />
        </div>
        <div class="card">
          <FieldRange
            v-model="simulationSpeed"
            :min="0.1"
            :max="10"
            :step="0.1"
            label="Simulation Speed"
            description="Physics simulation speed multiplier, higher values mean faster simulation (takes effect in real-time)"
            class="text-black w-full"
          />
        </div>
        <div class="flex gap-4">
          <div class="card flex-1 pointer-events-none">
            <FieldRange
              v-model="largeBoxVelocity.x"
              :min="-MAX_VELOCITY.x"
              :max="MAX_VELOCITY.x"
              :step="0.01"
              label="Large Box X Velocity"
              class="text-black w-full"
            />
          </div>
          <div class="card flex-1 pointer-events-none">
            <FieldRange
              v-model="largeBoxVelocity.y"
              :min="-MAX_VELOCITY.y"
              :max="MAX_VELOCITY.y"
              :step="0.01"
              label="Large Box Y Velocity"
              class="text-black w-full"
            />
          </div>
          <div class="card flex-1 pointer-events-none">
            <FieldRange
              v-model="largeBoxVelocity.angle"
              :min="-MAX_VELOCITY.angle"
              :max="MAX_VELOCITY.angle"
              :step="0.01"
              label="Large Box Angle Velocity"
              class="text-black w-full"
            />
          </div>
        </div>
        <div class="flex gap-4">
          <div class="card flex-1 space-y-2 text-black">
            <FieldCheckbox
              v-model="isSmallBoxInsideLargeBox"
              label="Is Small Box Inside Large Box"
              description="Whether the small box is inside the large box"
              class="text-black w-full pointer-events-none"
            />
          </div>
          <div class="card flex-1 space-y-2 text-black">
            <FieldCheckbox
              v-model="isLargeBoxInsideViewport"
              label="Is Large Box Inside Viewport"
              description="Whether the large box is inside the viewport"
              class="text-black w-full pointer-events-none"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.keyboard-key {
  --at-apply: w-10 h-10 rounded-md flex items-center justify-center;
  --at-apply: border-2 border-solid;
  --at-apply: text-2xl text-neutral-500;

  border-color: rgb(238, 238, 238);
  background-color: rgba(238, 238, 238, 0.6);
}

.keyboard-key-active {
  --at-apply: text-primary-400 bg-primary-400/10;
  --at-apply: border-primary-400;
}

.game-container {
  --at-apply: w-full h-full flex-1 flex-shrink-0 flex justify-end;
  --at-apply: p-4;

  .game-information {
    --at-apply: text-right text-black flex-1;
    --at-apply: mr-4;
    --at-apply: overflow-y-auto;
  }

  .game-content {
    --at-apply: aspect-1/1 max-w-full max-h-full relative;
    --at-apply: outline-gray-200 outline-solid outline-4 rounded-md;
    --at-apply: overflow-hidden;
  }

  .bricks-container {
    --at-apply: absolute top-0 left-0 w-full h-full;

  }

  .large-box-left {
    --at-apply: absolute;
    --at-apply: rounded-md;
    --at-apply: bg-blue-300;

    top: calc(var(--top) * 1pxp);
    left: calc(var(--left) * 1pxp);
    width: 4pxp;
    height: 360pxp;
    transform-origin: center;
    transform: rotate(calc(var(--angle) * 1rad));
  }
  .large-box-right {
    --at-apply: absolute;
    --at-apply: rounded-md;
    --at-apply: bg-blue-300;

    top: calc(var(--top) * 1pxp);
    left: calc(var(--left) * 1pxp);
    width: 4pxp;
    height: 360pxp;
    transform-origin: center;
    transform: rotate(calc(var(--angle) * 1rad));
  }
  .large-box-bottom {
    --at-apply: absolute;
    --at-apply: rounded-md;
    --at-apply: bg-blue-300;

    top: calc(var(--top) * 1pxp);
    left: calc(var(--left) * 1pxp);
    width: 360pxp;
    height: 4pxp;
    transform-origin: center;
    transform: rotate(calc(var(--angle) * 1rad));
  }

  .small-box {
    --at-apply: absolute;
    --at-apply: bg-pink-300 rounded-md;
    --at-apply: border-solid border-2 border-pink-400;

    top: calc(var(--top) * 1pxp);
    left: calc(var(--left) * 1pxp);
    width: 180pxp;
    height: 180pxp;
    transform-origin: center;
    transform: rotate(calc(var(--angle) * 1rad));
  }
}

.card {
  --at-apply: outline-2 outline-gray-100 bg-gray-50 outline-solid rounded-md p-4;
}

.btn {
  --at-apply: px-4 py-2 rounded-md font-medium transition-colors;
  --at-apply: disabled:opacity-50 disabled:cursor-not-allowed;
}

.btn-primary {
  --at-apply: bg-blue-500 text-white;
  --at-apply: hover:bg-blue-600;
  --at-apply: disabled:hover:bg-blue-500;
}

.btn-secondary {
  --at-apply: bg-gray-500 text-white;
  --at-apply: hover:bg-gray-600;
  --at-apply: disabled:hover:bg-gray-500;
}

.btn-danger {
  --at-apply: bg-red-500 text-white;
  --at-apply: hover:bg-red-600;
  --at-apply: disabled:hover:bg-red-500;
}

.btn-outline {
  --at-apply: border border-gray-400 text-gray-700 bg-white;
  --at-apply: hover:bg-gray-100;
}

.game-settings-container {
  --at-apply: w-full h-full flex-1 p-4 overflow-y-auto;

  .game-settings {
    --at-apply: w-full h-full;
    --at-apply: flex flex-col gap-4;
  }
}
</style>
