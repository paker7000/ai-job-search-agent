import { NextResponse } from "next/server";
import { searchPreferencesRepo } from "@/adapters/persistence/sqlite";
import { buildLocationSearchQueries } from "@/domain/matching";
import type { SearchPreferences } from "@/domain/types";
import { jsonError, readJson, requireAuth } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const preferences = searchPreferencesRepo.get();
  return NextResponse.json({ preferences, queries: buildLocationSearchQueries(preferences) });
}

export async function PUT(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await readJson(request);
  if (!body || !Array.isArray(body.locations) || !Array.isArray(body.titleKeywords) || !Array.isArray(body.companyKeywords)) {
    return jsonError("Locations, title keywords, and company keywords must be lists.", 400);
  }
  if ([body.locations, body.titleKeywords, body.companyKeywords].some((items) => items.length > 100 || items.some((item) => typeof item !== "string"))) {
    return jsonError("Each search preference list must contain at most 100 text values.", 400);
  }
  const preferences = searchPreferencesRepo.save(body as unknown as SearchPreferences);
  return NextResponse.json({ preferences, queries: buildLocationSearchQueries(preferences) });
}
