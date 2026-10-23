import { NextResponse } from "next/server";
import { profileRepo } from "@/adapters/persistence/sqlite";
import { jsonError, readJson, requireAuth } from "@/lib/http";
export const runtime="nodejs";
export async function GET(){const denied=await requireAuth();if(denied)return denied;return NextResponse.json({profile:profileRepo.get()});}
export async function PUT(request:Request){const denied=await requireAuth();if(denied)return denied;const body=await readJson(request);if(!body)return jsonError("Expected a JSON request body.",400);try{return NextResponse.json({profile:profileRepo.save(body as never)});}catch{return jsonError("Invalid profile.",400);}}
