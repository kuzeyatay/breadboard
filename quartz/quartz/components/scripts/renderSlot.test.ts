import test from "node:test"
import assert from "node:assert/strict"
import { RenderSlot } from "./renderSlot"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test("overlapping updates dispose a late mount before starting only the latest replacement", async () => {
  const slot = new RenderSlot<{ cleanup: () => void }>()
  const first = deferred<{ cleanup: () => void }>()
  const events: string[] = []
  const initial = slot.replace(() => {
    events.push("start:first")
    return first.promise
  })
  await Promise.resolve()
  const skipped = slot.replace(async () => {
    throw new Error("superseded mount ran")
  })
  const latest = slot.replace(async () => {
    events.push("start:latest")
    return {
      cleanup: () => {
        events.push("stop:latest")
      },
    }
  })
  first.resolve({
    cleanup: () => {
      events.push("stop:first")
    },
  })
  assert.equal(await initial, undefined)
  assert.equal(await skipped, undefined)
  assert.ok(await latest)
  slot.clear()
  slot.clear()
  assert.deepEqual(events, ["start:first", "stop:first", "start:latest", "stop:latest"])
})

test("closing during initialization disposes the late result and cancels queued mounts", async () => {
  const slot = new RenderSlot<{ cleanup: () => void }>()
  const first = deferred<{ cleanup: () => void }>()
  let cleaned = 0
  const initial = slot.replace(() => first.promise)
  await Promise.resolve()
  const queued = slot.replace(async () => {
    throw new Error("closed mount ran")
  })
  slot.clear()
  first.resolve({
    cleanup: () => {
      cleaned++
    },
  })
  await Promise.all([initial, queued])
  assert.equal(cleaned, 1)
})

test("replacement releases its context before allocating another, and recovers from initialization failure", async () => {
  const slot = new RenderSlot<{ cleanup: () => void }>()
  let live = 0
  const mount = async () => {
    assert.equal(live, 0)
    live++
    return {
      cleanup: () => {
        live--
      },
    }
  }
  await slot.replace(mount)
  await assert.rejects(
    slot.replace(async () => {
      assert.equal(live, 0)
      throw new Error("initialization failed")
    }),
    /initialization failed/,
  )
  await slot.replace(mount)
  await slot.replace(mount)
  slot.clear()
  assert.equal(live, 0)
})
