import type { CandidateProfile, JobInput, MatchResult } from "./types";

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");

export function assessEligibility(job: Pick<JobInput, "eligibility" | "eligibilityEvidence">) {
  if (job.eligibility !== "unknown" && job.eligibilityEvidence.trim().length > 0) {
    return { status: job.eligibility, explanation: job.eligibilityEvidence.trim() };
  }
  return { status: "unknown" as const, explanation: "The posting does not provide verified work-location eligibility evidence." };
}

export function matchJob(job: Pick<JobInput, "title" | "company" | "description" | "location" | "remote" | "eligibility" | "eligibilityEvidence">, profile: CandidateProfile): MatchResult {
  const text = normalize(`${job.title} ${job.description} ${job.company}`);
  const roleHits = profile.roles.filter((role) => text.includes(normalize(role).trim()));
  const stopWords=new Set(["experience","experienced","skills","skill","including","with","from","into","using","supporting","support","technology","platform","platforms","software","systems","and","the","for","managed","services","reported","training","professional","leader"]);
  const skillTerms=[...new Set(profile.qualifications.flatMap((claim)=>normalize(claim).split(/\s+/)).filter((term)=>term.length>3&&!stopWords.has(term)))];
  const skillHits = skillTerms.filter((term) => text.includes(term));
  const regionStopWords=new Set(["jobs","eligible","from","area","the","for","and","work"]);
  const regionTerms=[...new Set(profile.regions.flatMap((region)=>normalize(region).split(/\s+/)).filter((term)=>term.length>2&&!regionStopWords.has(term)))];
  const regionHits = regionTerms.filter((term) => normalize(`${job.location} ${job.description}`).includes(term));
  const eligibility = assessEligibility(job);
  const components = {
    roleAlignment: Math.min(100, Math.round((roleHits.length / Math.max(1, Math.min(profile.roles.length, 3))) * 100)),
    experienceOverlap: Math.min(100, Math.round((skillHits.length / 6) * 100)),
    locationPreference: Math.min(100, regionHits.length ? 75 + Math.min(25, regionHits.length * 8) : 20),
    eligibilityEvidence: eligibility.status === "supported" ? 100 : eligibility.status === "contradicted" ? 0 : 25,
  };
  const score = Math.round(components.roleAlignment * 0.35 + components.experienceOverlap * 0.3 + components.locationPreference * 0.2 + components.eligibilityEvidence * 0.15);
  const matched = [...roleHits.map((hit) => `Role: ${hit}`), ...skillHits.slice(0, 8).map((hit) => `Experience term: ${hit}`)];
  const missing = [
    ...(roleHits.length ? [] : ["No exact target-role phrase found"]),
    ...(regionHits.length ? [] : ["Location preference not evident in posting"]),
    ...(eligibility.status === "unknown" ? ["Work-location eligibility is unknown"] : []),
  ];
  return {
    score,
    components,
    matched,
    missing,
    explanation: `${score}/100 based on role wording (${components.roleAlignment}), experience terms (${components.experienceOverlap}), location clues (${components.locationPreference}), and explicit eligibility evidence (${components.eligibilityEvidence}). ${eligibility.explanation}`,
  };
}

export function jobDedupeKey(url: string) {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) if (/^(utm_.+|ref|source|trackingid)$/i.test(key)) parsed.searchParams.delete(key);
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return parsed.toString().replace(/\/$/, "").toLowerCase();
}
