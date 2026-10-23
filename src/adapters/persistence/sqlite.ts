import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Approval, CandidateProfile, Evidence, Job, JobInput } from "@/domain/types";
import { assessEligibility, jobDedupeKey, matchJob } from "@/domain/matching";
import type { ApprovalRepository, JobRepository, ProfileRepository } from "./repository";

export const defaultProfile: CandidateProfile = {
  summary: "Former MSCI Inc. Vice President (October 2009–April 2024), supporting financial software, enterprise SaaS, client technology, and technical operations. Technical Support and Product Management Lead at Code2Trust since May 2024, including AI and e-commerce consulting.",
  roles: ["Technical Solutions Architect", "AI Solutions Architect", "Solutions Engineer", "Sales Engineer", "Technical Account Manager", "Technical Customer Success", "Customer Success Engineering", "AI integration", "API integration", "Technical Product Owner", "Technical Product Manager", "Technical Operations", "Business Systems", "Implementation Consultant", "fintech", "financial software", "risk technology", "data platforms", "identity security"],
  regions: ["Remote jobs eligible from Mexico", "Texas", "Monterrey area"],
  qualifications: ["Financial risk and analytics platforms", "REST/SOAP APIs", "SFTP", "Snowflake", "Salesforce", "Jira", "Client support and troubleshooting", "Pre-sales, RFPs, proofs of concept, managed services", "Reported 5/5 CSAT", "Reported 300+ cases/year", "Reported support for 600+ clients", "LLM APIs and prompt engineering", "AI recommendations and chatbots", "Google Ads automation", "Supervised machine-learning prototypes", "MBA in Accounting and Finance", "Bachelor's in Electronics and Communications Engineering", "SailPoint Identity Security Leader", "Professional Scrum Master I", "Python/AI training"],
  reviewFlags: ["Candidate facts and metrics are user-provided and not independently verified.", "Earlier software consulting and engineering experience needs employer, role, and dates.", "Degree institutions, graduation dates, and certification dates were not provided.", "Visa or work authorization is unknown; do not infer it.", "Production-grade ML engineering, advanced quantitative research, and additional certifications are not confirmed."],
};

const dbPath = process.env.DATABASE_PATH ?? join(process.cwd(), "data", "agent.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
export const database = new DatabaseSync(dbPath);
database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
database.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, company TEXT NOT NULL,
  description TEXT NOT NULL, location TEXT NOT NULL, url TEXT NOT NULL, source TEXT NOT NULL,
  remote INTEGER NOT NULL, eligibility TEXT NOT NULL, eligibility_evidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  field TEXT NOT NULL, value TEXT NOT NULL, source_url TEXT NOT NULL, retrieved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id = 1), body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, action TEXT NOT NULL,
  payload TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, approval_id TEXT, event TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS discovery_runs (id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, status TEXT NOT NULL, imported INTEGER NOT NULL, error TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS application_materials (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`);

function hydrate(row: Record<string, unknown>): Job {
  const evidence = database.prepare("SELECT field, value, source_url as sourceUrl, retrieved_at as retrievedAt FROM evidence WHERE job_id = ? ORDER BY id").all(String(row.id)) as unknown as Evidence[];
  const input: JobInput = {
    title: String(row.title), company: String(row.company), description: String(row.description), location: String(row.location), url: String(row.url), source: String(row.source), remote: Boolean(row.remote), eligibility: row.eligibility as JobInput["eligibility"], eligibilityEvidence: String(row.eligibility_evidence),
  };
  return { ...input, id: String(row.id), dedupeKey: String(row.dedupe_key), status: row.status as Job["status"], notes: String(row.notes), createdAt: String(row.created_at), updatedAt: String(row.updated_at), evidence, match: matchJob(input, profileRepo.get()) };
}

export const jobRepo: JobRepository = {
  all() { return (database.prepare("SELECT * FROM jobs ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(hydrate); },
  upsert(input, retrievedAt = new Date().toISOString()) {
    const eligibility=assessEligibility(input);
    input={...input,eligibility:eligibility.status,eligibilityEvidence:eligibility.explanation};
    const key = jobDedupeKey(input.url);
    const existing = database.prepare("SELECT id FROM jobs WHERE dedupe_key = ?").get(key) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO jobs (id,dedupe_key,title,company,description,location,url,source,remote,eligibility,eligibility_evidence,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO UPDATE SET title=excluded.title,company=excluded.company,description=excluded.description,location=excluded.location,url=excluded.url,source=excluded.source,remote=excluded.remote,eligibility=excluded.eligibility,eligibility_evidence=excluded.eligibility_evidence,updated_at=excluded.updated_at`)
      .run(id,key,input.title.slice(0,240),input.company.slice(0,240),input.description.slice(0,50000),input.location.slice(0,500),input.url,input.source.slice(0,120),input.remote?1:0,input.eligibility,input.eligibilityEvidence.slice(0,3000),now,now);
    const evidence = database.prepare("INSERT INTO evidence (job_id,field,value,source_url,retrieved_at) VALUES (?,?,?,?,?)");
    for (const field of ["title", "company", "description", "location", "remote", "eligibility", "eligibilityEvidence"] as const) {
      const value = String(input[field]);
      const previous = database.prepare("SELECT value FROM evidence WHERE job_id=? AND field=? ORDER BY id DESC LIMIT 1").get(id, field) as { value: string } | undefined;
      if (!previous || previous.value !== value) evidence.run(id,field,value,input.url,retrievedAt);
    }
    const row = database.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Record<string, unknown>;
    return hydrate(row);
  },
  update(id, patch) {
    const allowed = ["status", "notes", "eligibility", "eligibilityEvidence"] as const;
    const current=database.prepare("SELECT eligibility,eligibility_evidence,url FROM jobs WHERE id=?").get(id) as {eligibility:string,eligibility_evidence:string,url:string}|undefined;
    if(!current)return null;
    const nextEvidence=patch.eligibilityEvidence??current.eligibility_evidence;
    const requestedEligibility=patch.eligibility??current.eligibility;
    const explicitEvidence=patch.eligibilityEvidence!==undefined?Boolean(patch.eligibilityEvidence.trim()):current.eligibility==="supported"||current.eligibility==="contradicted";
    const effective={...patch,eligibility:nextEvidence.trim()&&explicitEvidence?requestedEligibility:"unknown"};
    const entries = Object.entries(effective).filter(([key]) => allowed.includes(key as typeof allowed[number]));
    if (entries.length) {
      const sets = entries.map(([key]) => `${key === "eligibilityEvidence" ? "eligibility_evidence" : key}=?`).join(",");
      database.prepare(`UPDATE jobs SET ${sets},updated_at=? WHERE id=?`).run(...entries.map(([,v])=>v),new Date().toISOString(),id);
    }
    const evidence=database.prepare("INSERT INTO evidence (job_id,field,value,source_url,retrieved_at) VALUES (?,?,?,?,?)");const retrievedAt=new Date().toISOString();
    for(const [field,value] of [["eligibility",effective.eligibility],["eligibilityEvidence",effective.eligibilityEvidence]] as const){if(value===undefined)continue;const previous=database.prepare("SELECT value FROM evidence WHERE job_id=? AND field=? ORDER BY id DESC LIMIT 1").get(id,field) as {value:string}|undefined;if(!previous||previous.value!==String(value))evidence.run(id,field,String(value),current.url,retrievedAt);}
    const row = database.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? hydrate(row) : null;
  },
  delete(id) { return database.prepare("DELETE FROM jobs WHERE id=?").run(id).changes > 0; },
};

export const profileRepo: ProfileRepository = {
  get() {
    const row = database.prepare("SELECT body FROM profile WHERE id=1").get() as { body: string } | undefined;
    if (!row) { database.prepare("INSERT INTO profile (id,body) VALUES (1,?)").run(JSON.stringify(defaultProfile)); return defaultProfile; }
    return JSON.parse(row.body) as CandidateProfile;
  },
  save(profile) {
    const cleaned = { summary: profile.summary.slice(0,10000), roles: profile.roles.slice(0,80).map((x)=>x.slice(0,160)), regions: profile.regions.slice(0,30).map((x)=>x.slice(0,160)), qualifications: profile.qualifications.slice(0,100).map((x)=>x.slice(0,300)), reviewFlags: profile.reviewFlags.slice(0,30).map((x)=>x.slice(0,500)) };
    database.prepare("INSERT INTO profile (id,body,version) VALUES (1,?,1) ON CONFLICT(id) DO UPDATE SET body=excluded.body,version=profile.version+1").run(JSON.stringify(cleaned));
    return cleaned;
  },
};

export const approvalRepo: ApprovalRepository = {
  create(jobId, action, payload, now = new Date()) {
    const id = randomUUID(); const createdAt = now.toISOString(); const expiresAt = new Date(now.getTime() + 24*60*60*1000).toISOString(); const payloadHash = createHash("sha256").update(payload).digest("hex");
    database.prepare("INSERT INTO approvals (id,job_id,action,payload,payload_hash,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)").run(id,jobId,action,payload,payloadHash,"pending",createdAt,expiresAt);
    database.prepare("INSERT INTO audit_log (approval_id,event,detail,created_at) VALUES (?,?,?,?)").run(id,"approval_requested",JSON.stringify({action,payloadHash}),createdAt);
    return {id,jobId,action,payload,payloadHash,status:"pending",createdAt,expiresAt,decidedAt:null};
  },
  decide(id, status, now = new Date()) {
    const approval = database.prepare("SELECT * FROM approvals WHERE id=?").get(id) as Record<string, unknown> | undefined;
    const nowIso = now.toISOString();
    if (!approval || approval.status !== "pending" || String(approval.expires_at) <= nowIso || createHash("sha256").update(String(approval.payload)).digest("hex") !== approval.payload_hash) {
      database.prepare("INSERT INTO audit_log (approval_id,event,detail,created_at) VALUES (?,?,?,?)").run(id,"approval_denied","missing, expired, already decided, or payload hash mismatch",nowIso);
      return null;
    }
    database.prepare("UPDATE approvals SET status=?,decided_at=? WHERE id=? AND status='pending'").run(status,nowIso,id);
    database.prepare("INSERT INTO audit_log (approval_id,event,detail,created_at) VALUES (?,?,?,?)").run(id,`approval_${status}`,"User decision recorded; no external action executed",nowIso);
    return { id, jobId:String(approval.job_id), action:String(approval.action), payload:String(approval.payload), payloadHash:String(approval.payload_hash), status, createdAt:String(approval.created_at), expiresAt:String(approval.expires_at), decidedAt:nowIso };
  },
  all() { return (database.prepare("SELECT * FROM approvals ORDER BY created_at DESC").all() as Record<string,unknown>[]).map((r)=>({id:String(r.id),jobId:String(r.job_id),action:String(r.action),payload:String(r.payload),payloadHash:String(r.payload_hash),status:r.status as Approval["status"],createdAt:String(r.created_at),expiresAt:String(r.expires_at),decidedAt:r.decided_at ? String(r.decided_at) : null})); },
};
