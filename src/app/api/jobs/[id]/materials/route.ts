import { NextResponse } from "next/server";
import { requireAuth, jsonError, readJson } from "@/lib/http";
import { generateMaterials, materialsForJob, saveMaterial } from "@/services/materials";
export const runtime="nodejs";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){const denied=await requireAuth();if(denied)return denied;const {id}=await context.params;return NextResponse.json({materials:materialsForJob(id)});}
export async function POST(_request:Request,context:{params:Promise<{id:string}>}){const denied=await requireAuth();if(denied)return denied;const {id}=await context.params;try{return NextResponse.json({materials:generateMaterials(id)});}catch(error){return jsonError(error instanceof Error?error.message:"Could not prepare drafts.",404);}}
export async function PATCH(request:Request){const denied=await requireAuth();if(denied)return denied;const body=await readJson(request);if(!body||typeof body.id!=="string"||typeof body.content!=="string")return jsonError("Provide a material ID and content.",400);try{const material=saveMaterial(body.id,body.content);return material?NextResponse.json({material}):jsonError("Draft not found.",404);}catch(error){return jsonError(error instanceof Error?error.message:"Could not save draft.",400);}}
