import { getServerServices } from "@/composition";
import { handleLearningOverviewRequest, learningOverviewLimiter } from "@/integrations/learning-overview-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dispatch = (request: Request) => handleLearningOverviewRequest(request, getServerServices(), learningOverviewLimiter);

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
