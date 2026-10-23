import { NextResponse } from "next/server";
import { jobRepo } from "@/adapters/persistence/sqlite";
import { jsonError, readJson, requireAuth } from "@/lib/http";
import type { JobInput } from "@/domain/types";

export const runtime = "nodejs";
export async function GET() { const denied=await requireAuth(); if(denied)return denied; return NextResponse.json({jobs:jobRepo.all()}); }
export async function POST(request: Request) {
  const denied=await requireAuth(); if(denied)return denied;
  const body=await readJson(request); if(!body)return jsonError("Expected a JSON request body under 100 KB.",400);
  const url=String(body.url??""); let parsed:URL;
  try { parsed=new URL(url); } catch { return jsonError("Enter a valid job URL.",400); }
  if(parsed.protocol!=="https:" || parsed.username || parsed.password) return jsonError("Job links must use HTTPS and cannot contain credentials.",400);
  const input:JobInput={title:String(body.title??"").trim(),company:String(body.company??"").trim(),description:String(body.description??""),location:String(body.location??"Unknown"),url:parsed.toString(),source:String(body.source??"manual"),remote:Boolean(body.remote),eligibility:body.eligibility==="supported"||body.eligibility==="contradicted"?body.eligibility:"unknown",eligibilityEvidence:String(body.eligibilityEvidence??"")};
  if(!input.title||!input.company||input.title.length>240||input.company.length>240||input.description.length>50000)return jsonError("Title and company are required; posting fields exceed the allowed size.",400);
  return NextResponse.json({job:jobRepo.upsert(input)},{status:201});
}
