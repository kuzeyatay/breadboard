type Renderer = { cleanup: () => void }

/** One owner, including while an async renderer is still being constructed. */
export class RenderSlot<T extends Renderer> {
  private generation = 0
  private pending: Promise<void> = Promise.resolve()
  private active: T | undefined

  private release() {
    const previous = this.active
    this.active = undefined
    previous?.cleanup()
  }

  clear() {
    this.generation += 1
    this.release()
  }

  replace(mount: () => Promise<T>): Promise<T | undefined> {
    const generation = ++this.generation
    const run = async () => {
      if (generation !== this.generation) return
      this.release()
      const renderer = await mount()
      if (generation !== this.generation) {
        renderer.cleanup()
        return
      }
      this.active = renderer
      return renderer
    }
    const result = this.pending.then(run)
    // A failed mount must not prevent the next replacement or retain its result.
    this.pending = result.then(
      () => {},
      () => {},
    )
    return result
  }
}
