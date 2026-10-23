import { randomUUID } from "node:crypto";
import { database, jobRepo, profileRepo } from "@/adapters/persistence/sqlite";

export type Material={id:string;jobId:string;kind:"cover_letter"|"resume_highlights";content:string;createdAt:string;updatedAt:string};
export function materialsForJob(jobId:string):Material[]{return database.prepare("SELECT id,job_id as jobId,kind,content,created_at as createdAt,updated_at as updatedAt FROM application_materials WHERE job_id=? ORDER BY updated_at DESC").all(jobId) as unknown as Material[];}
export function generateMaterials(jobId:string):Material[]{
  const job=jobRepo.all().find(j=>j.id===jobId);if(!job)throw new Error("Job not found.");
  const profile=profileRepo.get();const words=new Set(`${job.title} ${job.description}`.toLowerCase().split(/[^a-z0-9+#]+/).filter(w=>w.length>3));
  const highlights=profile.qualifications.map((claim,index)=>({claim,index,score:claim.toLowerCase().split(/[^a-z0-9+#]+/).filter(w=>w.length>3&&words.has(w)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,6).map(x=>`- ${x.claim}`).join("\n")||"- [Add a relevant, evidence-backed accomplishment from your experience]";
  const drafts:[Material["kind"],string][]=[
    ["cover_letter",`[Your name]\n[Your contact information]\n\n[Date]\n\nHiring team\n${job.company}\n\nRe: ${job.title}\n\nDear Hiring Team,\n\nI am interested in the ${job.title} opportunity. My background includes ${profile.summary}\n\nRelevant experience to consider:\n${highlights}\n\nI would welcome a conversation about how this experience could support your team. I have kept this draft to the candidate-provided profile; please verify every statement and add your contact details before using it.\n\nSincerely,\n[Your name]`],
    ["resume_highlights",`TAILORED EXPERIENCE HIGHLIGHTS — ${job.title} at ${job.company}\n\n${highlights}\n\nCandidate profile summary (review for accuracy):\n${profile.summary}\n\nSource job: ${job.url}\n\nReview flags: This draft only uses candidate-provided profile text. Verify dates, metrics, qualifications, and relevance before use; add no unsupported claims.`],
  ];
  const now=new Date().toISOString();const insert=database.prepare("INSERT INTO application_materials (id,job_id,kind,content,created_at,updated_at) VALUES (?,?,?,?,?,?)");
  return drafts.map(([kind,content])=>{const previous=database.prepare("SELECT id FROM application_materials WHERE job_id=? AND kind=? ORDER BY updated_at DESC LIMIT 1").get(jobId,kind) as {id:string}|undefined;const id=previous?.id??randomUUID();if(previous)database.prepare("UPDATE application_materials SET content=?,updated_at=? WHERE id=?").run(content,now,id);else insert.run(id,jobId,kind,content,now,now);return {id,jobId,kind,content,createdAt:previous?String((database.prepare("SELECT created_at FROM application_materials WHERE id=?").get(id) as {created_at:string}).created_at):now,updatedAt:now};});
}
export function saveMaterial(id:string,content:string){if(content.length>40000)throw new Error("Draft is too long.");const now=new Date().toISOString();const result=database.prepare("UPDATE application_materials SET content=?,updated_at=? WHERE id=?").run(content,now,id);return result.changes?database.prepare("SELECT id,job_id as jobId,kind,content,created_at as createdAt,updated_at as updatedAt FROM application_materials WHERE id=?").get(id) as Material:null;}
