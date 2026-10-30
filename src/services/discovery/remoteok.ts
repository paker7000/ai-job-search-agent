import { randomUUID } from "node:crypto";
import { database, jobRepo, searchPreferencesRepo } from "@/adapters/persistence/sqlite";
import { buildLocationSearchQueries } from "@/domain/matching";
import { matchesRemoteOkLocation } from "./destinations";

type RemoteOkJob = {
  id?: string | number;
  position?: string;
  company?: string;
  description?: string;
  location?: string;
  url?: string;
  date?: string;
  salary?: string;
  salary_min?: number | string;
  salary_max?: number | string;
  tags?: string[];
  apply_url?: string;
};

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new Error("Remote OK response exceeded the 4 MB limit.");
  if (!response.body) throw new Error("Remote OK response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error("Remote OK response exceeded the 4 MB limit."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function safeRemoteOkUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && url.hostname.toLowerCase() === "remoteok.com" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function text(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function matchesTerms(job: RemoteOkJob, titleTerms: string[], companyTerms: string[]): boolean {
  const searchable = `${job.position ?? ""} ${job.tags?.join(" ") ?? ""} ${text(job.description ?? "")}`.toLocaleLowerCase();
  const company = (job.company ?? "").toLocaleLowerCase();
  return titleTerms.some((term) => searchable.includes(term.toLocaleLowerCase())) || companyTerms.some((term) => company.includes(term.toLocaleLowerCase()));
}

function eligibilityEvidence(job: RemoteOkJob): string {
  const relevant = `${job.location ?? ""} ${text(job.description ?? "")}`;
  const matches = relevant.match(/(?:remote(?:ly)?\s+(?:from|in|anywhere in)\s+mexico|(?:hiring|hire|open to candidates|accepting candidates)\s+(?:in|from|located in)\s+mexico|mexico[- ]based employees)/gi) ?? [];
  return matches.length ? `Posting text explicitly states: ${[...new Set(matches)].join("; ")}` : "No explicit work-location eligibility for Mexico was found; eligibility remains unknown.";
}

export async function runRemoteOkSearch() {
  const preferences = searchPreferencesRepo.get();
  const queries = buildLocationSearchQueries(preferences);
  if (!queries.length) throw new Error("Add at least one location before searching.");
  if (!preferences.titleKeywords.length && !preferences.companyKeywords.length) throw new Error("Add at least one job-title or company keyword before searching.");
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://remoteok.com/api", { signal: controller.signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Remote OK returned HTTP ${response.status}.`);
    const raw: unknown = JSON.parse(await readBoundedBody(response, 4_000_000));
    if (!Array.isArray(raw)) throw new Error("Remote OK returned an unexpected feed format.");
    const postings = raw.filter((entry): entry is RemoteOkJob => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
      .slice(0, 250).filter((entry) => typeof entry.position === "string" && typeof entry.company === "string");
    const retrievedAt = new Date().toISOString();
    let imported = 0;
    for (const posting of postings) {
      const url = safeRemoteOkUrl(posting.url);
      if (!url || !matchesTerms(posting, preferences.titleKeywords, preferences.companyKeywords)) continue;
      const description = text(posting.description ?? "").slice(0, 50_000);
      const location = (posting.location ?? "Not specified").slice(0, 500);
      for (const query of queries) {
        if (!matchesRemoteOkLocation(location, query.location)) continue;
        const evidence = eligibilityEvidence(posting);
        const min = Number(posting.salary_min ?? 0), max = Number(posting.salary_max ?? 0);
        const salary = posting.salary?.slice(0, 240) || (min || max ? [min || "", max || ""].filter(Boolean).join("–") : undefined);
        jobRepo.upsert({
          title: posting.position!.slice(0, 240), company: posting.company!.slice(0, 240), description, location,
          url, source: "Remote OK", remote: true, eligibility: evidence.startsWith("Posting text") ? "supported" : "unknown",
          eligibilityEvidence: evidence, publishedAt: posting.date?.slice(0, 80), salary,
          employmentType: undefined, workType: "Remote", searchLocation: query.location, searchQuery: query.query,
        }, retrievedAt);
        imported++;
      }
    }
    database.prepare("INSERT INTO discovery_runs (id,source,started_at,finished_at,status,imported,error) VALUES (?,?,?,?,?,?,?)")
      .run(randomUUID(), "Remote OK", startedAt, new Date().toISOString(), "success", imported, "");
    return { imported, retrievedAt, searches: queries.map((query) => query.location), source: "Remote OK" };
  } catch (error) {
    database.prepare("INSERT INTO discovery_runs (id,source,started_at,finished_at,status,imported,error) VALUES (?,?,?,?,?,?,?)")
      .run(randomUUID(), "Remote OK", startedAt, new Date().toISOString(), "failed", 0, error instanceof Error ? error.message : "Unknown discovery failure");
    throw error;
  } finally { clearTimeout(timer); }
}
