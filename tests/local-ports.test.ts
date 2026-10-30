import { createServer, type Server } from "node:net";
import { describe, expect, it } from "vitest";
import { isPortInUse } from "./local-ports";

function listen(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0 });
    });
  });
}

describe("isPortInUse", () => {
  it("detects a listening port and a freed one", async () => {
    const { server, port } = await listen();
    expect(await isPortInUse(port)).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await isPortInUse(port)).toBe(false);
  });
});
