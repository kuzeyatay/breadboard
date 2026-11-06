/** Render only after an invalidation, or while the renderer reports active motion. */
export class GraphRenderLoop {
  private frame: number | undefined
  private active = true
  private disposed = false

  constructor(
    private readonly draw: (time: number) => boolean,
    private readonly requestFrame = (callback: FrameRequestCallback) =>
      requestAnimationFrame(callback),
    private readonly cancelFrame = (id: number) => cancelAnimationFrame(id),
  ) {}

  private render = (time: number) => {
    this.frame = undefined
    if (this.disposed || !this.active) return
    if (this.draw(time)) this.invalidate()
  }

  invalidate = () => {
    if (this.disposed || !this.active || this.frame !== undefined) return
    this.frame = this.requestFrame(this.render)
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return
    this.active = active
    if (active) {
      this.invalidate()
    } else if (this.frame !== undefined) {
      this.cancelFrame(this.frame)
      this.frame = undefined
    }
  }

  dispose() {
    this.disposed = true
    if (this.frame !== undefined) this.cancelFrame(this.frame)
    this.frame = undefined
  }
}
