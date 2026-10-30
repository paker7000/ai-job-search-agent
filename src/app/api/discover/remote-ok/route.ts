import { NextResponse } from "next/server";
import { database } from "@/adapters/persistence/sqlite";
import { runRemoteOkSearch } from "@/services/discovery/remoteok";
import { jsonError, requireAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const runs = database.prepare("SELECT id,source,started_at as startedAt,finished_at as finishedAt,status,imported,error FROM discovery_runs WHERE source='Remote OK' ORDER BY started_at DESC LIMIT 10").all();
  return NextResponse.json({ runs });
}

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;
  try { return NextResponse.json(await runRemoteOkSearch()); }
  catch (error) { return jsonError(error instanceof Error ? error.message : "Could not read the Remote OK public feed.", 502); }
}
