import { getServerServices } from "@/composition";
import { createLearningMcpDependencies, handleLearningMcpRequest, readMcpAllowedOrigins } from "@/integrations/learning-mcp-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedOrigins = readMcpAllowedOrigins(process.env);

export async function GET(request: Request) { return handleLearningMcpRequest(request, createLearningMcpDependencies(getServerServices(), allowedOrigins)); }
export async function HEAD(request: Request) { return handleLearningMcpRequest(request, createLearningMcpDependencies(getServerServices(), allowedOrigins)); }
export async function POST(request: Request) { return handleLearningMcpRequest(request, createLearningMcpDependencies(getServerServices(), allowedOrigins)); }
export async function PUT(request: Request) { return handleLearningMcpRequest(request, createLearningMcpDependencies(getServerServices(), allowedOrigins)); }
export async function PATCH(request: Request) { return handleLearningMcpRequest(request, createLearningMcpDependencies(getServerServices(), allowedOrigins)); }
export async function DELETE(request: Request) { return handleLearningMcpRequest(request, createLearningMcpDependencies(getServerServices(), allowedOrigins)); }
export async function OPTIONS(request: Request) { return handleLearningMcpRequest(request, createLearningMcpDependencies(getServerServices(), allowedOrigins)); }
