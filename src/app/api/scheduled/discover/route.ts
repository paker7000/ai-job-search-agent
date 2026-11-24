import { NextResponse } from "next/server";
import { database } from "@/adapters/persistence/sqlite";
import { runDailyDiscovery } from "@/services/discovery/daily";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.SCHEDULE_SECRET;
  if (!secret) return NextResponse.json({ error: "Set SCHEDULE_SECRET to enable scheduled discovery." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = database.prepare("SELECT value FROM settings WHERE key='greenhouse-board-token'").get() as { value: string } | undefined;
  const result = await runDailyDiscovery(row?.value);
  return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
}
