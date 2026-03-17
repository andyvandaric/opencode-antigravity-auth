import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchWithTimeout } from "./http"

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("aborts on timeout", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal
      return await new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      fetchWithTimeout("https://example.com", { method: "GET" }, 5),
    ).rejects.toMatchObject({ message: "Fetch timeout" })
  })

  it("propagates upstream abort signals", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal
      return await new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const controller = new AbortController()
    const request = fetchWithTimeout(
      "https://example.com",
      { method: "GET", signal: controller.signal },
      5000,
    )
    controller.abort(new Error("User aborted"))

    await expect(request).rejects.toMatchObject({ message: "User aborted" })
  })
})
