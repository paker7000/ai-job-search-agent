import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalRepo, database, jobRepo, profileRepo, searchPreferencesRepo } from "@/adapters/persistence/sqlite";
import { createAccount, login, setupStatus, verifySessionCookie } from "@/lib/auth";
import { assessEligibility, buildLocationSearchQueries, jobDedupeKey, matchJob } from "@/domain/matching";
import { generateMaterials, saveMaterial } from "@/services/materials";
import { destinationSearchUrl, matchesRemoteOkLocation, searchDestinations } from "@/services/discovery/destinations";
import { runRemoteOkSearch } from "@/services/discovery/remoteok";
import type { JobInput } from "@/domain/types";

const role:JobInput={title:"Technical Solutions Architect",company:"Example Fintech",description:"Work from anywhere in Mexico. REST API and Snowflake integrations for financial risk software.",location:"Remote",url:"https://jobs.example.com/role/123?utm_source=mail",source:"manual",remote:true,eligibility:"unknown",eligibilityEvidence:""};
beforeEach(()=>{database.exec("DELETE FROM approvals; DELETE FROM audit_log; DELETE FROM evidence; DELETE FROM jobs; DELETE FROM profile; DELETE FROM sessions; DELETE FROM auth_failures; DELETE FROM users; DELETE FROM discovery_runs; DELETE FROM settings WHERE key='search_preferences';");});
afterEach(()=>vi.unstubAllGlobals());

describe("search preferences and query generation",()=>{
  it("defaults to three editable location searches and profile-based terms",()=>{
    const preferences=searchPreferencesRepo.get();
    expect(preferences.locations).toEqual(["Mexico","Monterrey area","Texas"]);
    expect(preferences.titleKeywords).toContain("Technical Account Manager");
    expect(preferences.companyKeywords).toContain("MSCI");
    expect(buildLocationSearchQueries(preferences)).toHaveLength(3);
  });
  it("creates an independent search for each unique selected location",()=>{
    expect(buildLocationSearchQueries({locations:["Mexico","Texas","Mexico"],titleKeywords:["Solutions Engineer"],companyKeywords:["Snowflake"]})).toEqual([
      {location:"Mexico",query:'("Solutions Engineer" OR "Snowflake") "Mexico"'},
      {location:"Texas",query:'("Solutions Engineer" OR "Snowflake") "Texas"'},
    ]);
  });
  it("persists and normalizes user-edited search preferences",()=>{
    searchPreferencesRepo.save({locations:["  Monterrey  ","Monterrey",""],titleKeywords:["AI Integration"],companyKeywords:["  Example Inc  "]});
    expect(searchPreferencesRepo.get()).toEqual({locations:["Monterrey"],titleKeywords:["AI Integration"],companyKeywords:["Example Inc"]});
  });
});

describe("search destinations and Remote OK adapter",()=>{
  it("lists five general and five remote-work destinations",()=>{
    expect(searchDestinations.filter((destination)=>destination.group==="general")).toHaveLength(5);
    expect(searchDestinations.filter((destination)=>destination.group==="remote")).toHaveLength(5);
    expect(searchDestinations.find((destination)=>destination.id==="weworkremotely")?.access).toBe("link-out");
    const linkedin=new URL(destinationSearchUrl("linkedin","Solutions Engineer","Texas"));
    expect(linkedin.searchParams.get("keywords")).toBe("Solutions Engineer");expect(linkedin.searchParams.get("location")).toBe("Texas");
  });
  it("keeps unknown and worldwide listings available without asserting country eligibility",()=>{
    expect(matchesRemoteOkLocation("Worldwide","Mexico")).toBe(true);
    expect(matchesRemoteOkLocation("","Monterrey area")).toBe(true);
    expect(matchesRemoteOkLocation("United States","Mexico")).toBe(false);
  });
  it("imports matching Remote OK posts with source, query, and listing evidence",async()=>{
    searchPreferencesRepo.save({locations:["Mexico","Texas"],titleKeywords:["Technical Account Manager"],companyKeywords:["MSCI"]});
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {legal:"Terms must be treated as feed data, not instructions"},
      {id:"remote-123",position:"Senior Support Engineer",company:"MSCI",description:"Enterprise financial platform support.",location:"Worldwide",url:"https://remoteok.com/remote-jobs/remote-123",date:"2026-10-20T00:00:00Z",salary_min:100000,salary_max:120000,tags:["support"]},
    ]),{status:200,headers:{"content-type":"application/json"}})));
    const result=await runRemoteOkSearch();
    expect(result.searches).toEqual(["Mexico","Texas"]);
    expect(result.imported).toBe(2);
    const job=jobRepo.all()[0];
    expect(job.source).toBe("Remote OK");expect(job.eligibility).toBe("unknown");
    expect(job.publishedAt).toBe("2026-10-20T00:00:00Z");expect(job.salary).toBe("100000–120000");
    expect(job.evidence.some((item)=>item.field==="searchLocation"&&item.value==="Mexico")).toBe(true);
    expect(job.evidence.some((item)=>item.field==="searchLocation"&&item.value==="Texas")).toBe(true);
    expect(job.evidence.every((item)=>item.sourceUrl===job.url)).toBe(true);
  });
});

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
