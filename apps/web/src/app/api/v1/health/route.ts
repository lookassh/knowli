import { getServerServices } from "@/composition";

/**
 * Healthcheck dla orkiestratora (Compose/Coolify): potwierdza proces web
 * I połączenie do bazy. Publiczny, bez danych; treść stała "ok".
 *
 * Global setup E2E przekazuje procesowi losowy UMIEM_E2E_READY_TOKEN i czeka
 * na ten nagłówek: odpowiedź serwera równoległego przebiegu na tym samym
 * porcie nie może uchodzić za gotowość własnego. Poza E2E nagłówka nie ma.
 */
export async function GET(): Promise<Response> {
  try {
    const services = getServerServices();
    await services.db.$client.query("select 1");
    const readyToken = process.env.UMIEM_E2E_READY_TOKEN;
    return Response.json(
      { status: "ok" },
      readyToken ? { headers: { "x-umiem-e2e-ready": readyToken } } : undefined,
    );
  } catch (error) {
    console.error("[health] sprawdzenie nie powiodło się:", error);
    return Response.json({ status: "error" }, { status: 503 });
  }
}
