<script setup lang="ts">
import { FieldCheckbox } from '@proj-airi/ui'
import FieldRange from '@proj-airi/ui/src/components/Form/Field/FieldRange.vue'
import { useCssVar, useElementBounding, useEventListener, useLocalStorage } from '@vueuse/core'

import { Bodies, Body, Composite, Engine, Render } from 'matter-js'
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useTicker } from './composables/useTicker'

const gameContentRef = useTemplateRef<HTMLDivElement>('gameContentRef')
const {
  width: gameContentWidth,
} = useElementBounding(gameContentRef)
const viewportWidth = useCssVar('--viewport-width')
watch(gameContentWidth, (width) => {
  viewportWidth.value = width.toString()
})

const largeBoxAcceleration = ref({
  x: 0,
  y: 0,
  angle: 0,
})
const largeBoxVelocity = ref({
  x: 0,
  y: 0,
  angle: 0,
})

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

const learningRate = useLocalStorage('learning-rate', 0.01)

const engine = Engine.create()

const largeBox = {
  left: Bodies.rectangle(180, 360, 4, 360, { isStatic: true }),
  right: Bodies.rectangle(540, 360, 4, 360, { isStatic: true }),
  bottom: Bodies.rectangle(360, 540, 360, 4, { isStatic: true }),
}
Composite.add(engine.world, [largeBox.left, largeBox.right, largeBox.bottom])

const smallBox = Bodies.rectangle(360, 360, 180, 180)
Composite.add(engine.world, smallBox)

const ground = Bodies.rectangle(360, 720, 720, 4, { isStatic: true })
Composite.add(engine.world, ground)

useEventListener(window, 'keydown', (event) => {
  if (event.code === 'KeyS') {
    largeBoxAcceleration.value.y += 0.01
  }
  if (event.code === 'KeyW') {
    largeBoxAcceleration.value.y -= 0.01
  }
  if (event.code === 'KeyA') {
    largeBoxAcceleration.value.x -= 0.01
  }
  if (event.code === 'KeyD') {
    largeBoxAcceleration.value.x += 0.01
  }
  if (event.code === 'KeyQ') {
    largeBoxAcceleration.value.angle -= 1 * Math.PI / 180
  }
  if (event.code === 'KeyE') {
    largeBoxAcceleration.value.angle += 1 * Math.PI / 180
  }
})

const { start, stop } = useTicker((deltaTime) => {
  largeBoxVelocity.value.x += largeBoxAcceleration.value.x
  largeBoxVelocity.value.y += largeBoxAcceleration.value.y
  largeBoxCenter.value.x += largeBoxVelocity.value.x
  largeBoxCenter.value.y += largeBoxVelocity.value.y
  largeBoxAngle.value += largeBoxAcceleration.value.angle

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
})
</script>

<template>
  <div class="flex items-center justify-center h-screen w-screen">
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
        <div class="card h-98">
          <div id="matterjs-renderer" class="w-180 h-180 rounded-md overflow-hidden scale-50 origin-top-left" />
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
        <div class="card space-y-2 text-black">
          <FieldCheckbox
            v-model="isSmallBoxInsideLargeBox"
            label="Is Small Box Inside Large Box"
            description="Whether the small box is inside the large box"
            class="text-black w-full pointer-events-none"
          />
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

.game-settings-container {
  --at-apply: w-full h-full flex-1 p-4 overflow-y-auto;

  .game-settings {
    --at-apply: w-full h-full;
    --at-apply: flex flex-col gap-4;
  }
}
</style>
