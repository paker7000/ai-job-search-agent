import { NextResponse } from "next/server";
import { isAuthenticated } from "./auth";

export async function requireAuth() {
  if (!(await isAuthenticated())) return NextResponse.json({error:"Authentication required"},{status:401});
  return null;
}
export function jsonError(message: string, status: number) { return NextResponse.json({error:message},{status}); }
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;
  const text = await request.text(); if (text.length > 100_000) return null;
  try { const value: unknown = JSON.parse(text); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : null; } catch { return null; }
}
