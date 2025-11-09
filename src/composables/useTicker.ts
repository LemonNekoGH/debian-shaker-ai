import { ref } from 'vue'

export function useTicker(onUpdate: (deltaTime: number) => void) {
  const lastTime = ref(performance.now())
  let frameId: number | null = null

  const tick = (currentTime: number) => {
    let deltaTime = currentTime - lastTime.value
    lastTime.value = currentTime

    deltaTime = Math.min(deltaTime, 100)

    onUpdate(deltaTime)

    frameId = requestAnimationFrame(tick)
  }

  const start = () => {
    lastTime.value = performance.now()
    frameId = requestAnimationFrame(tick)
  }

  const stop = () => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId)
      frameId = null
    }
  }

  return { start, stop }
}
