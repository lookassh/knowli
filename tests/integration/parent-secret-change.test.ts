import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  changeParentSecret,
  loginParent,
  requireParent,
  setupParent,
} from "@learning/server/testing";
import { buildTestServices, countRows, handleParentApi, testDatabase, truncateCoreTables } from "./helpers";

const BASE = "http://localhost:3000";
const ORIGIN = { origin: BASE };

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "ok",
    (e: unknown) => (e as { code: string }).code,
  );
}

describe("zmiana PIN-u rodzica (#400)", () => {
  beforeEach(async () => {
    await truncateCoreTables();
  });

  afterAll(async () => {
    await testDatabase().pool.end();
  });

  it("poprawny obecny PIN: nowy hash, wszystkie sesje i ciastko urządzenia unieważnione", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "stary-pin");
    const current = await loginParent(services, "stary-pin");
    const other = await loginParent(services, "stary-pin");

    await changeParentSecret(services, current.token, "stary-pin", "nowy-pin");

    expect(await countRows("parent_sessions")).toBe(0);
    expect(await codeOf(requireParent(services, current.token))).toBe("unauthorized");
    expect(await codeOf(requireParent(services, other.token))).toBe("unauthorized");
    expect(await codeOf(loginParent(services, "stary-pin"))).toBe("invalid_credentials");
    const fresh = await loginParent(services, "nowy-pin", current.deviceToken);
    // HMAC kluczem nowego hasha: stare ciastko urządzenia nie jest już znane
    expect(fresh.deviceToken.split(".")[0]).not.toBe(current.deviceToken.split(".")[0]);
  });

  it("zły obecny PIN: nic nie zmienione, po 5 porażkach rate_limited tylko dla tej sesji", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "stary-pin");
    const { token } = await loginParent(services, "stary-pin");

    for (let i = 0; i < 5; i++) {
      expect(await codeOf(changeParentSecret(services, token, "zly", "nowy-pin"))).toBe("invalid_credentials");
    }
    expect(await codeOf(changeParentSecret(services, token, "stary-pin", "nowy-pin"))).toBe("rate_limited");

    await expect(requireParent(services, token)).resolves.toBeUndefined();
    // kubełek sesji nie blokuje logowania
    await expect(loginParent(services, "stary-pin")).resolves.toMatchObject({ token: expect.any(String) });
  });

  it("za krótki nowy PIN → validation, sesje i PIN bez zmian", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "stary-pin");
    const { token } = await loginParent(services, "stary-pin");

    expect(await codeOf(changeParentSecret(services, token, "stary-pin", "123"))).toBe("validation");
    await expect(requireParent(services, token)).resolves.toBeUndefined();
    await expect(loginParent(services, "stary-pin")).resolves.toBeDefined();
  });

  it("sesja usunięta przed zapisem → unauthorized i wycofanie zmiany PIN-u", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "stary-pin");

    expect(await codeOf(changeParentSecret(services, "nieznany-token", "stary-pin", "nowy-pin"))).toBe("unauthorized");
    await expect(loginParent(services, "stary-pin")).resolves.toBeDefined();
    expect(await codeOf(loginParent(services, "nowy-pin"))).toBe("invalid_credentials");
  });

  it("równoległe zmiany: wygrywa jedna, druga kończy się błędem bez zmiany PIN-u", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "stary-pin");
    const a = await loginParent(services, "stary-pin");
    const b = await loginParent(services, "stary-pin");

    const codes = await Promise.all([
      codeOf(changeParentSecret(services, a.token, "stary-pin", "pin-a")),
      codeOf(changeParentSecret(services, b.token, "stary-pin", "pin-b")),
    ]);

    expect(codes.filter((c) => c === "ok")).toHaveLength(1);
    // przegrana czyta poświadczenia przed albo po zatwierdzeniu wygranej
    expect(["conflict", "unauthorized", "invalid_credentials"]).toContain(codes.find((c) => c !== "ok"));
    const winner = codes[0] === "ok" ? "pin-a" : "pin-b";
    await expect(loginParent(services, winner)).resolves.toBeDefined();
  });

  it("HTTP POST /secret: 204 z czyszczącym cookie, 401 bez sesji i przy złym PIN-ie, 400 dla krótkiego", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "stary-pin");
    const login = await handleParentApi(post("/api/v1/parent/login", { secret: "stary-pin" }), services);
    const cookie = login.headers.getSetCookie().find((c) => c.startsWith("parent_session="))!.split(";")[0]!;

    const noSession = await handleParentApi(
      post("/api/v1/parent/secret", { currentSecret: "stary-pin", newSecret: "nowy-pin" }),
      services,
    );
    expect(noSession.status).toBe(401);
    expect(await noSession.json()).toMatchObject({ code: "unauthorized" });

    const wrong = await handleParentApi(
      post("/api/v1/parent/secret", { currentSecret: "zly", newSecret: "nowy-pin" }, { cookie }),
      services,
    );
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ code: "invalid_credentials" });

    const short = await handleParentApi(
      post("/api/v1/parent/secret", { currentSecret: "stary-pin", newSecret: "123" }, { cookie }),
      services,
    );
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ code: "validation" });

    const ok = await handleParentApi(
      post("/api/v1/parent/secret", { currentSecret: "stary-pin", newSecret: "nowy-pin" }, { cookie }),
      services,
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get("set-cookie")).toContain("Max-Age=0");

    const after = await handleParentApi(
      new Request(`${BASE}/api/v1/parent/children`, { headers: { host: "localhost:3000", cookie } }),
      services,
    );
    expect(after.status).toBe(401);
  });
});
