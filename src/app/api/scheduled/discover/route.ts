import { NextResponse } from "next/server";
import { greenhouseBoardRepo } from "@/adapters/persistence/sqlite";
import { runDailyDiscovery } from "@/services/discovery/daily";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.SCHEDULE_SECRET;
  if (!secret) return NextResponse.json({ error: "Set SCHEDULE_SECRET to enable scheduled discovery." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await runDailyDiscovery(greenhouseBoardRepo.all());
  return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
}
