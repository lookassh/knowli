import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createChild,
  deleteChild,
  isParentSetupRequired,
  listChildren,
  loginParent,
  logoutParent,
  requireParent,
  setupParent,
  type AppError,
} from "@learning/server";
import { disposeServerServices } from "../../apps/web/src/composition";
import {
  buildTestServices,
  countRows,
  openRestartedServices,
  testDatabase,
  testDatabaseUrl,
  truncateCoreTables,
  UUID_PATTERN,
} from "./helpers";

// route handlery tworzą Services z process.env — ustawiamy zanim padnie pierwsze żądanie
process.env.DATABASE_URL = testDatabaseUrl();
import {
  GET as loginStatus,
  POST as login,
} from "../../apps/web/src/app/api/v1/parent/login/route";
import {
  GET as listChildrenRoute,
  POST as createChildRoute,
} from "../../apps/web/src/app/api/v1/parent/children/route";
import {
  DELETE as deleteChildRoute,
} from "../../apps/web/src/app/api/v1/parent/children/[id]/route";
import { POST as setup } from "../../apps/web/src/app/api/v1/parent/setup/route";
import { POST as logout } from "../../apps/web/src/app/api/v1/parent/logout/route";

const BASE = "http://localhost:3000";
const SESSION_COOKIE = "parent_session";

function jsonRequest(path: string, method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function readBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function sessionCookieFrom(response: Response): string {
  const cookies = response.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!session) throw new Error(`Brak cookie ${SESSION_COOKIE} w odpowiedzi: ${cookies.join(" | ")}`);
  return session.split(";")[0]!;
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
  const error = await promise.then(
    () => {
      throw new Error(`Oczekiwano błędu ${code}, otrzymano sukces`);
    },
    (e: unknown) => e,
  );
  expect(error).toMatchObject({ code });
  return error as AppError;
}

const childRouteContext = (id: string) => ({ params: Promise.resolve({ id }) });

describe("auth i profile dzieci (integracja)", () => {
  beforeEach(async () => {
    await truncateCoreTables();
  });

  afterAll(async () => {
    await disposeServerServices();
    const { pool } = testDatabase();
    await pool.end();
  });

  it("poprawny login działa, błędny nie tworzy sesji", async () => {
    const { services, clock } = buildTestServices();
    await setupParent(services, "rodzinny-pin-1");

    const bad = await expectAppError(loginParent(services, "zly-pin"), "invalid_credentials");
    expect(bad.status).toBe(401);
    expect(await countRows("parent_sessions")).toBe(0);

    const good = await loginParent(services, "rodzinny-pin-1");
    expect(good.token.length).toBeGreaterThan(20);
    // wygaśnięcie liczone względem zegara usług, nie rzeczywistego — test
    // nie może starzeć się wraz z kalendarzem
    expect(new Date(good.expiresAt).getTime()).toBeGreaterThan(clock.now().getTime());
    expect(await countRows("parent_sessions")).toBe(1);

    await expect(requireParent(services, good.token)).resolves.toBeUndefined();
  });

  it("endpoint rodzica bez cookie zwraca 401 w formacie błędu API", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "rodzinny-pin-1");
    await loginParent(services, "rodzinny-pin-1");

    const response = await listChildrenRoute(jsonRequest("/api/v1/parent/children", "GET"));
    expect(response.status).toBe(401);
    const body = await readBody(response);
    expect(body).toMatchObject({ code: "unauthorized", retryable: false });
    expect(typeof body.message).toBe("string");
    expect(typeof body.requestId).toBe("string");
    expect(body.message).not.toMatch(/select|postgres|error:/i);
  });

  it("dwa profile mają różne ID i wracają na liście", async () => {
    const { services } = buildTestServices();
    const ala = await createChild(services, { displayName: "Ala", avatarKey: "fox" });
    const ola = await createChild(services, {
      displayName: "Ola",
      avatarKey: "cat",
      birthYear: 2017,
    });

    expect(ala.id).toMatch(UUID_PATTERN);
    expect(ola.id).toMatch(UUID_PATTERN);
    expect(ala.id).not.toBe(ola.id);

    const list = await listChildren(services);
    expect(list.map((c) => c.displayName).sort()).toEqual(["Ala", "Ola"]);
    expect(list.find((c) => c.id === ola.id)?.birthYear).toBe(2017);
  });

  it("pierwsze uruchomienie: jednorazowy setup, równoległa konfiguracja nie tworzy drugiego wiersza", async () => {
    const { services } = buildTestServices();
    expect(await isParentSetupRequired(services)).toBe(true);

    await setupParent(services, "pierwsze-haslo");
    expect(await isParentSetupRequired(services)).toBe(false);
    await expectAppError(setupParent(services, "drugie-haslo"), "already_configured");

    // równoległa próba na świeżej bazie
    await truncateCoreTables();
    const results = await Promise.allSettled([
      setupParent(services, "wariant-a"),
      setupParent(services, "wariant-b"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await countRows("parent_credentials")).toBe(1);
  });

  it("wygasła sesja jest odrzucana i leniwie usuwana", async () => {
    const { services, clock } = buildTestServices();
    await setupParent(services, "pin1");
    const { token } = await loginParent(services, "pin1");

    clock.advanceHours(13); // sesja ważna 12 h
    await expectAppError(requireParent(services, token), "unauthorized");
    expect(await countRows("parent_sessions")).toBe(0);
  });

  it("limit logowania blokuje po serii błędów i odtyka po oknie", async () => {
    const { services, clock } = buildTestServices();
    await setupParent(services, "pin1");

    for (let i = 0; i < 5; i++) {
      await expectAppError(loginParent(services, "zle"), "invalid_credentials");
    }
    const locked = await expectAppError(loginParent(services, "pin1"), "rate_limited");
    expect(locked.status).toBe(429);

    clock.advanceMs(16 * 60_000);
    const fresh = await loginParent(services, "pin1");
    await expect(requireParent(services, fresh.token)).resolves.toBeUndefined();
  });

  it("logout unieważnia sesję", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "pin1");
    const { token } = await loginParent(services, "pin1");
    await logoutParent(services, token);
    await expectAppError(requireParent(services, token), "unauthorized");
  });

  it("usuwanie profilu działa jednokrotnie, powtórzone zwraca not_found", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ala", avatarKey: "fox" });

    await deleteChild(services, child.id);
    expect(await listChildren(services)).toEqual([]);
    await expectAppError(deleteChild(services, child.id), "not_found");
  });

  it("DELETE profilu przez API wymaga sesji i tego samego Origin; nieznany profil daje 404", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "pin-usun");
    const child = await createChild(services, { displayName: "Ala", avatarKey: "fox" });
    const origin = { origin: BASE };

    // sesja przez route — cookie w pełni spójne z usługami route handlera
    const loginResponse = await login(jsonRequest("/api/v1/parent/login", "POST", { secret: "pin-usun" }, origin));
    expect(loginResponse.status).toBe(200);
    const cookie = sessionCookieFrom(loginResponse);

    // bez sesji — 401; z sesją, ale z obcym Origin — 403 (mutacja)
    const anonymous = await deleteChildRoute(
      jsonRequest(`/api/v1/parent/children/${child.id}`, "DELETE", undefined, origin),
      childRouteContext(child.id),
    );
    expect(anonymous.status).toBe(401);
    const crossOrigin = await deleteChildRoute(
      jsonRequest(`/api/v1/parent/children/${child.id}`, "DELETE", undefined, {
        cookie,
        origin: "https://evil.example",
      }),
      childRouteContext(child.id),
    );
    expect(crossOrigin.status).toBe(403);
    expect(await listChildren(services)).toHaveLength(1);

    // właściwe żądanie usuwa profil; powtórzone zwraca 404
    const ok = await deleteChildRoute(
      jsonRequest(`/api/v1/parent/children/${child.id}`, "DELETE", undefined, { cookie, ...origin }),
      childRouteContext(child.id),
    );
    expect(ok.status).toBe(204);
    const unknown = await deleteChildRoute(
      jsonRequest(`/api/v1/parent/children/${randomUUID()}`, "DELETE", undefined, { cookie, ...origin }),
      childRouteContext(randomUUID()),
    );
    expect(unknown.status).toBe(404);
    expect(await listChildren(services)).toEqual([]);
  });

  it("baza po ponownym otwarciu połączenia zachowuje profile", async () => {
    const { services } = buildTestServices();
    await createChild(services, { displayName: "Ala", avatarKey: "fox" });
    await createChild(services, { displayName: "Ola", avatarKey: "cat" });

    const restarted = openRestartedServices();
    try {
      const list = await listChildren(restarted.services);
      expect(list).toHaveLength(2);
    } finally {
      await restarted.dispose();
    }
  });

  describe("przepływ HTTP przez route handlery", () => {
    it("setup → login → children → create → delete → logout", async () => {
      const origin = { origin: BASE };

      const status0 = await loginStatus(jsonRequest("/api/v1/parent/login", "GET"));
      expect(status0.status).toBe(200);
      expect(await readBody(status0)).toEqual({ authenticated: false, setupRequired: true });

      const setupResponse = await setup(
        jsonRequest("/api/v1/parent/setup", "POST", { secret: "http-pin" }, origin),
      );
      expect(setupResponse.status).toBe(201);
      const setupAgain = await setup(
        jsonRequest("/api/v1/parent/setup", "POST", { secret: "inny" }, origin),
      );
      expect(setupAgain.status).toBe(409);

      const wrongLogin = await login(
        jsonRequest("/api/v1/parent/login", "POST", { secret: "zle" }, origin),
      );
      expect(wrongLogin.status).toBe(401);
      expect(wrongLogin.headers.getSetCookie()).toEqual([]);

      const loginResponse = await login(
        jsonRequest("/api/v1/parent/login", "POST", { secret: "http-pin" }, origin),
      );
      expect(loginResponse.status).toBe(200);
      const cookie = sessionCookieFrom(loginResponse);
      expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
      const setCookie = loginResponse.headers.getSetCookie().join("\n");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");

      const authHeaders = { cookie, ...origin };

      const emptyList = await listChildrenRoute(jsonRequest("/api/v1/parent/children", "GET", undefined, { cookie }));
      expect(emptyList.status).toBe(200);
      expect(await emptyList.json()).toEqual([]);

      const created = await createChildRoute(
        jsonRequest("/api/v1/parent/children", "POST", { displayName: "Ala", avatarKey: "fox" }, authHeaders),
      );
      expect(created.status).toBe(201);
      const child = (await readBody(created)) as { id: string; displayName: string };

      const invalid = await createChildRoute(
        jsonRequest(
          "/api/v1/parent/children",
          "POST",
          { displayName: "", avatarKey: "fox" },
          authHeaders,
        ),
      );
      expect(invalid.status).toBe(400);
      expect(await readBody(invalid)).toMatchObject({ code: "validation", retryable: false });

      const crossOrigin = await createChildRoute(
        jsonRequest(
          "/api/v1/parent/children",
          "POST",
          { displayName: "Nowe", avatarKey: "cat" },
          { cookie, origin: "https://evil.example" },
        ),
      );
      expect(crossOrigin.status).toBe(403);

      const deleted = await deleteChildRoute(
        jsonRequest(`/api/v1/parent/children/${child.id}`, "DELETE", undefined, authHeaders),
        childRouteContext(child.id),
      );
      expect(deleted.status).toBe(204);

      const logoutResponse = await logout(
        jsonRequest("/api/v1/parent/logout", "POST", undefined, authHeaders),
      );
      expect(logoutResponse.status).toBe(204);
      expect(logoutResponse.headers.getSetCookie().join("\n")).toContain("Max-Age=0");

      const afterLogout = await listChildrenRoute(
        jsonRequest("/api/v1/parent/children", "GET", undefined, { cookie }),
      );
      expect(afterLogout.status).toBe(401);
    });
  });
});
