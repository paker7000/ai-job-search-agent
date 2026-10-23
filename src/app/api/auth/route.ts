import { NextResponse } from "next/server";
import { createAccount, login, sessionCookieName, setupStatus } from "@/lib/auth";
import { jsonError, readJson } from "@/lib/http";

export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ setupRequired: setupStatus() }); }
export async function POST(request: Request) {
  const body = await readJson(request); if (!body) return jsonError("Expected a JSON request body.",400);
  const action = body.action;
  try {
    if (action === "setup") {
      createAccount(String(body.email ?? ""),String(body.password ?? ""));
      const token = login(String(body.email),String(body.password));
      if (!token) return jsonError("Account created; sign in to continue.",200);
      const response = NextResponse.json({ok:true}); response.cookies.set(sessionCookieName,token,{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV === "production",path:"/",maxAge:604800}); return response;
    }
    if (action === "login") {
      const token = login(String(body.email ?? ""),String(body.password ?? ""));
      if (!token) return jsonError("Invalid email or password.",401);
      const response = NextResponse.json({ok:true}); response.cookies.set(sessionCookieName,token,{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV === "production",path:"/",maxAge:604800}); return response;
    }
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Unable to create account.",400); }
  return jsonError("Unknown authentication action.",400);
}
export async function DELETE() { const response=NextResponse.json({ok:true}); response.cookies.delete(sessionCookieName); return response; }
