import { getServerServices } from "@/composition";

/**
 * Healthcheck dla orkiestratora (Compose/Coolify): potwierdza proces web
 * I połączenie do bazy. Publiczny, bez danych; treść stała "ok".
 */
export async function GET(): Promise<Response> {
  try {
    const services = getServerServices();
    await services.db.$client.query("select 1");
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("[health] sprawdzenie nie powiodło się:", error);
    return Response.json({ status: "error" }, { status: 503 });
  }
}
