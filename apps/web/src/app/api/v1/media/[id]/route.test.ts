import { describe, expect, it, vi } from "vitest";

const { readReadyMediaStreamMock } = vi.hoisted(() => ({
  readReadyMediaStreamMock: vi.fn(),
}));

// Usługi i magazyn mediów są nieistotne dla nagłówków — mocki, żeby test
// nie wymagał bazy ani DATABASE_URL (wzorzec route.test.ts tras parent/kid).
vi.mock("@/composition", () => ({
  getServerServices: vi.fn(() => ({}) as never),
}));
vi.mock("@learning/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@learning/server")>();
  return { ...actual, readReadyMediaStream: readReadyMediaStreamMock };
});

import { GET } from "./route";

async function* singleChunk(): AsyncIterable<Uint8Array> {
  yield new Uint8Array([1, 2, 3]);
}

function media(immutableCache: boolean) {
  return { body: singleChunk(), mimeType: "image/webp", byteCount: 3, immutableCache };
}

// #399: media nie trafiają do współdzielonych cache (private, nie public),
// a typ z bazy jest chroniony przez nosniff.
describe("GET /api/v1/media/[id] — nagłówki (#399)", () => {
  it("wariant niezmienny: private immutable + nosniff", async () => {
    readReadyMediaStreamMock.mockResolvedValueOnce(media(true));

    const response = await GET(new Request("http://localhost/api/v1/media/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("image/webp");
  });

  it("wariant awaryjny: private krótki + nosniff", async () => {
    readReadyMediaStreamMock.mockResolvedValueOnce(media(false));

    const response = await GET(new Request("http://localhost/api/v1/media/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
