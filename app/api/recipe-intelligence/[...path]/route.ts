import { handleIntelligence } from "@/lib/recipe-intelligence/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleIntelligence;
export const POST = handleIntelligence;
export const PATCH = handleIntelligence;
export const DELETE = handleIntelligence;
