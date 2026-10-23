import { NextResponse } from "next/server";
import { jobRepo } from "@/adapters/persistence/sqlite";
import { jsonError, readJson, requireAuth } from "@/lib/http";
import type { ApplicationStatus } from "@/domain/types";

export const runtime="nodejs";
const statuses:ApplicationStatus[]=["discovered","interested","preparing","applied","interviewing","offer","rejected","archived"];
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}) {
  const denied=await requireAuth();if(denied)return denied;
  const body=await readJson(request);if(!body)return jsonError("Expected a JSON request body.",400);
  const patch:Record<string,unknown>={};
  if(typeof body.status==="string"&&statuses.includes(body.status as ApplicationStatus))patch.status=body.status;
  if(typeof body.notes==="string"&&body.notes.length<=10000)patch.notes=body.notes;
  if(body.eligibility==="supported"||body.eligibility==="contradicted"||body.eligibility==="unknown")patch.eligibility=body.eligibility;
  if(typeof body.eligibilityEvidence==="string"&&body.eligibilityEvidence.length<=3000)patch.eligibilityEvidence=body.eligibilityEvidence;
  const {id}=await context.params;const job=jobRepo.update(id,patch as never);return job?NextResponse.json({job}):jsonError("Job not found.",404);
}
export async function DELETE(_request:Request,context:{params:Promise<{id:string}>}){const denied=await requireAuth();if(denied)return denied;const {id}=await context.params;return jobRepo.delete(id)?NextResponse.json({ok:true}):jsonError("Job not found.",404);}
