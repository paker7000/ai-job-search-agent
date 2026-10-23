import { beforeEach, describe, expect, it } from "vitest";
import { approvalRepo, database, jobRepo, profileRepo } from "@/adapters/persistence/sqlite";
import { createAccount, login, setupStatus, verifySessionCookie } from "@/lib/auth";
import { assessEligibility, jobDedupeKey, matchJob } from "@/domain/matching";
import { generateMaterials, saveMaterial } from "@/services/materials";
import type { JobInput } from "@/domain/types";

const role:JobInput={title:"Technical Solutions Architect",company:"Example Fintech",description:"Work from anywhere in Mexico. REST API and Snowflake integrations for financial risk software.",location:"Remote",url:"https://jobs.example.com/role/123?utm_source=mail",source:"manual",remote:true,eligibility:"unknown",eligibilityEvidence:""};
beforeEach(()=>{database.exec("DELETE FROM approvals; DELETE FROM audit_log; DELETE FROM evidence; DELETE FROM jobs; DELETE FROM profile; DELETE FROM sessions; DELETE FROM auth_failures; DELETE FROM users;");});

describe("job evidence and matching",()=>{
  it("deduplicates tracking parameters but keeps functional job identifiers",()=>{
    expect(jobDedupeKey(role.url)).toBe("https://jobs.example.com/role/123");
    expect(jobDedupeKey("https://jobs.example.com/role?id=1")).not.toBe(jobDedupeKey("https://jobs.example.com/role?id=2"));
  });
  it("updates a deduplicated job while preserving changed field evidence",()=>{
    const first=jobRepo.upsert(role,"2026-10-01T00:00:00.000Z");
    const second=jobRepo.upsert({...role,title:"Senior Technical Solutions Architect",url:"https://jobs.example.com/role/123?utm_source=other"},"2026-10-02T00:00:00.000Z");
    expect(second.id).toBe(first.id);expect(jobRepo.all()).toHaveLength(1);
    const titleEvidence=second.evidence.filter(e=>e.field==="title");
    expect(titleEvidence.map(e=>e.value)).toEqual([role.title,"Senior Technical Solutions Architect"]);
    expect(titleEvidence.map(e=>e.retrievedAt)).toEqual(["2026-10-01T00:00:00.000Z","2026-10-02T00:00:00.000Z"]);
  });
  it("keeps missing work location eligibility unknown",()=>{
    expect(assessEligibility({eligibility:"supported",eligibilityEvidence:""}).status).toBe("unknown");
    const result=matchJob(role,profileRepo.get());
    expect(result.components.eligibilityEvidence).toBe(25);expect(result.missing).toContain("Work-location eligibility is unknown");
  });
  it("requires a saved evidence note before marking eligibility supported",()=>{
    const job=jobRepo.upsert({...role,eligibility:"supported",eligibilityEvidence:""});expect(job.eligibility).toBe("unknown");
    expect(jobRepo.update(job.id,{eligibility:"supported"})?.eligibility).toBe("unknown");
    const verified=jobRepo.update(job.id,{eligibility:"supported",eligibilityEvidence:"Posting states remote work from Mexico is accepted."})!;
    expect(verified.eligibility).toBe("supported");expect(verified.evidence.filter(e=>e.field==="eligibilityEvidence")).toHaveLength(2);
  });
  it("uses the editable candidate region preferences in the match",()=>{
    const profile=profileRepo.get();const preferred=matchJob(role,profile).components.locationPreference;const elsewhere=matchJob(role,{...profile,regions:["Oslo"]}).components.locationPreference;
    expect(preferred).toBeGreaterThan(elsewhere);
  });
});

describe("authentication and authorization",()=>{
  it("requires initial account setup and rejects invalid credentials and sessions",()=>{
    expect(setupStatus()).toBe(true);expect(verifySessionCookie(undefined)).toBe(false);
    createAccount("candidate@example.com","local-password-is-long");expect(setupStatus()).toBe(false);
    expect(login("candidate@example.com","wrong-password")).toBeNull();
    const cookie=login("candidate@example.com","local-password-is-long");expect(cookie).toBeTruthy();expect(verifySessionCookie(cookie!)).toBe(true);expect(verifySessionCookie("forged.value")).toBe(false);
  });
  it("permits a single initial account only",()=>{
    createAccount("candidate@example.com","local-password-is-long");expect(()=>createAccount("second@example.com","another-long-password")).toThrow();
  });
  it("temporarily rate limits repeated failed sign-in attempts",()=>{
    createAccount("candidate@example.com","local-password-is-long");
    for(let attempt=0;attempt<5;attempt++)expect(login("candidate@example.com","wrong-password")).toBeNull();
    expect(database.prepare("SELECT attempts,locked_until FROM auth_failures").get()).toMatchObject({attempts:5});
    expect(login("candidate@example.com","local-password-is-long")).toBeNull();
  });
});

describe("approval enforcement",()=>{
  it("records a payload-bound decision, rejects repeat approval, and executes nothing",()=>{
    const job=jobRepo.upsert(role);const request=approvalRepo.create(job.id,"application_submission","Submit to example only",new Date("2026-10-01T00:00:00.000Z"));
    expect(request.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    const approved=approvalRepo.decide(request.id,"approved",new Date("2026-10-01T00:01:00.000Z"));
    expect(approved?.status).toBe("approved");expect(approvalRepo.decide(request.id,"approved",new Date("2026-10-01T00:02:00.000Z"))).toBeNull();
    expect(database.prepare("SELECT detail FROM audit_log WHERE approval_id=? AND event='approval_approved'").get(request.id)).toBeTruthy();
  });
  it("denies expired approvals",()=>{
    const job=jobRepo.upsert(role);const request=approvalRepo.create(job.id,"email","Exact draft",new Date("2026-10-01T00:00:00.000Z"));
    expect(approvalRepo.decide(request.id,"approved",new Date("2026-10-03T00:00:00.000Z"))).toBeNull();
  });
  it("denies a request whose exact payload changed after it was created",()=>{
    const job=jobRepo.upsert(role);const request=approvalRepo.create(job.id,"recruiter_message","Reviewed message",new Date("2026-10-01T00:00:00.000Z"));
    database.prepare("UPDATE approvals SET payload='changed message' WHERE id=?").run(request.id);
    expect(approvalRepo.decide(request.id,"approved",new Date("2026-10-01T00:01:00.000Z"))).toBeNull();
  });
});

describe("application-material drafts",()=>{
  it("generates editable drafts from provided profile claims only",()=>{
    const job=jobRepo.upsert(role);const drafts=generateMaterials(job.id);expect(drafts).toHaveLength(2);
    const cover=drafts.find(d=>d.kind==="cover_letter")!;expect(cover.content).toContain("REST/SOAP APIs");expect(cover.content).toContain("[Your name]");expect(cover.content).not.toContain("production-grade machine-learning engineering");
    expect(saveMaterial(cover.id,`${cover.content}\nReviewed` )?.content).toContain("Reviewed");
  });
});
