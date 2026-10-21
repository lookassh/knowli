import { AppError, readSessionActivityResult, type Services } from "@learning/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withApi } from "../http/errors";
import { handleKidApi } from "./kid-router";

vi.mock("@learning/server", async (importActual) => {
  const actual = await importActual<typeof import("@learning/server")>();
  return { ...actual, readSessionActivityResult: vi.fn() };
});

const services = {} as Services;
const sessionId = "11111111-1111-4111-8111-111111111111";
const readActivityResult = vi.mocked(readSessionActivityResult);

function request(path = sessionId) {
  return new Request(`http://localhost/api/v1/kid/sessions/${path}/activity-result`);
}

beforeEach(() => { vi.clearAllMocks(); });

describe("Kid API activity result", () => {
  it("reads only the public durable result with no-store caching", async () => {
    readActivityResult.mockResolvedValueOnce({
      status: "evaluated",
      pointsAwarded: 3,
      errorCode: null,
    });

    const response = await handleKidApi(request(), services, ["sessions", sessionId, "activity-result"]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "evaluated", pointsAwarded: 3, errorCode: null });
    expect(readActivityResult).toHaveBeenCalledWith(services, sessionId);
    expect(readActivityResult).toHaveBeenCalledTimes(1);
  });

  it("returns a public pending result when evaluation has not settled", async () => {
    readActivityResult.mockResolvedValueOnce(null);

    const response = await handleKidApi(request(), services, ["sessions", sessionId, "activity-result"]);

    await expect(response.json()).resolves.toEqual({ status: "already_started", pointsAwarded: 0, errorCode: null });
  });

  it("maps invalid identifiers and denied reads through the Kid API error boundary", async () => {
    const api = withApi((incoming) => handleKidApi(incoming, services, ["sessions", "not-a-uuid", "activity-result"]));
    const invalid = await api(request("not-a-uuid"));
    expect(invalid.status).toBe(400);
    expect(readActivityResult).not.toHaveBeenCalled();

    readActivityResult.mockRejectedValueOnce(new AppError("not_found"));
    const deniedApi = withApi((incoming) => handleKidApi(incoming, services, ["sessions", sessionId, "activity-result"]));
    const denied = await deniedApi(request());
    expect(denied.status).toBe(404);
  });
});
