import { getServerServices } from "@/composition";
import { handleLearningOverviewRequest } from "@/integrations/learning-overview-orpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint raportu rodzinnego dla Hermesa na procedurze oRPC (zadanie 14
// migracji v2): kontrakt + Bearer + rate limit w `learning-overview-orpc.ts`.
// Ścieżka, autoryzacja i semantyka odpowiedzi bez zmian; metody inne niż GET
// kończą się kopertą not_found jak dotychczas.
const dispatch = (request: Request) => handleLearningOverviewRequest(request, getServerServices());

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
