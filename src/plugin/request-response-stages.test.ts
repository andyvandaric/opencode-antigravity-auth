import { describe, expect, it } from "vitest"
import { transformBufferedResponseStage } from "./request-response-stages"

describe("transformBufferedResponseStage", () => {
  it("adds retry headers from google.rpc.RetryInfo details", async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: "Rate limit exceeded",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "2.5s",
            },
          ],
        },
      }),
      {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "content-type": "application/json" },
      },
    )

    const transformed = await transformBufferedResponseStage({
      response,
      streaming: false,
      isEventStreamResponse: false,
      injectDebugThinking: (value: unknown) => value,
    })

    expect(transformed.headers.get("Retry-After")).toBe("3")
    expect(transformed.headers.get("retry-after-ms")).toBe("2500")
  })
})
