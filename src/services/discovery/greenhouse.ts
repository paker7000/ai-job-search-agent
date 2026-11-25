import { randomUUID } from "node:crypto";
import { database, jobRepo, searchPreferencesRepo } from "@/adapters/persistence/sqlite";
import type { SearchPreferences } from "@/domain/types";
import { buildLocationSearchQueries } from "@/domain/matching";

type GreenhousePost = { id?: number; title?: string; absolute_url?: string; location?: { name?: string }; content?: string };
type NormalizedPost = { title: string; url: string; location: string; description: string; matchedLocations: string[] };
export interface GreenhouseDiscoveryResult { token: string; company: string; fetched: number; matched: number; imported: number; retrievedAt: string; matches: Array<{ title: string; location: string; url: string }> }

async function readBoundedBody(response: Response, maxBytes: number) {
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new Error("Greenhouse response exceeded the 4 MB limit.");
  if (!response.body) throw new Error("Greenhouse response has no body.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error("Greenhouse response exceeded the 4 MB limit."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function cleanText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

export function matchesGreenhouseLocation(listingLocation: string, queryLocation: string): boolean {
  const listing = listingLocation.toLocaleLowerCase().trim();
  const query = queryLocation.toLocaleLowerCase().trim();
  if (!listing || /worldwide|anywhere|global|remote|distributed/.test(listing)) return true;
  if (query.includes("texas")) return /texas|\btx\b|united states|\busa\b|u\.s\./.test(listing);
  if (query.includes("mexico") || query.includes("monterrey")) return /mexico|\bmx\b|latin america|\blatam\b|monterrey|nuevo le[oó]n/.test(listing);
  return listing.includes(query);
}

function matchingLocations(post: GreenhousePost, preferences: SearchPreferences) {
  const location = post.location?.name ?? "";
  return buildLocationSearchQueries(preferences).filter((query) => matchesGreenhouseLocation(location, query.location)).map((query) => query.location);
}

function keywordMatches(post: GreenhousePost, company: string, preferences: SearchPreferences) {
  const searchable = `${post.title ?? ""} ${cleanText(post.content ?? "")}`.toLocaleLowerCase();
  const titleMatch = preferences.titleKeywords.some((term) => searchable.includes(term.toLocaleLowerCase()));
  const companyMatch = preferences.companyKeywords.some((term) => company.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  return titleMatch || companyMatch;
}

async function fetchGreenhousePosts(token: string, fetcher: typeof fetch = fetch): Promise<GreenhousePost[]> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(token)) throw new Error("Invalid Greenhouse board token.");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`, { signal: controller.signal, headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`Greenhouse returned HTTP ${response.status}.`);
    const data = JSON.parse(await readBoundedBody(response, 4_000_000)) as { jobs?: GreenhousePost[] };
    if (!Array.isArray(data.jobs)) throw new Error("Greenhouse returned an unexpected board format.");
    return data.jobs;
  } finally { clearTimeout(timer); }
}

function filterPosts(posts: GreenhousePost[], company: string, preferences: SearchPreferences): NormalizedPost[] {
  return posts.flatMap((post) => {
    if (!post.title || !post.absolute_url || !keywordMatches(post, company, preferences)) return [];
    let url: URL;
    try { url = new URL(post.absolute_url); } catch { return []; }
    if (url.protocol !== "https:" || url.username || url.password) return [];
    const matchedLocations = matchingLocations(post, preferences);
    if (!matchedLocations.length) return [];
    return [{ title: post.title.slice(0, 240), url: url.toString(), location: (post.location?.name ?? "Not specified").slice(0, 500), description: cleanText(post.content ?? "").slice(0, 50_000), matchedLocations }];
  });
}

export async function previewGreenhouseBoard(token: string, company: string, preferences = searchPreferencesRepo.get(), fetcher: typeof fetch = fetch): Promise<GreenhouseDiscoveryResult> {
  if (!preferences.locations.length) throw new Error("Add at least one search location before previewing this board.");
  if (!preferences.titleKeywords.length && !preferences.companyKeywords.length) throw new Error("Add job-title or company keywords before previewing this board.");
  const posts = await fetchGreenhousePosts(token, fetcher);
  const filtered = filterPosts(posts, company, preferences);
  return { token, company, fetched: posts.length, matched: filtered.length, imported: 0, retrievedAt: new Date().toISOString(), matches: filtered.slice(0, 8).map(({ title, location, url }) => ({ title, location, url })) };
}

export async function runGreenhouseDiscovery(token: string, company = token, preferences = searchPreferencesRepo.get(), fetcher: typeof fetch = fetch): Promise<GreenhouseDiscoveryResult> {
  const startedAt = new Date().toISOString();
  try {
    const posts = await fetchGreenhousePosts(token, fetcher);
    const filtered = filterPosts(posts, company, preferences);
    const retrievedAt = new Date().toISOString();
    let imported = 0;
    for (const post of filtered) {
      for (const location of post.matchedLocations) {
        const query = buildLocationSearchQueries(preferences).find((item) => item.location === location)!;
        const text = `${post.location} ${post.description}`.toLocaleLowerCase();
        const eligibilityEvidence = (text.match(/(?:remote(?:ly)?\s+(?:from|in|anywhere in)\s+mexico|(?:hiring|hire|open to candidates|accepting candidates)\s+(?:in|from|located in)\s+mexico|mexico[- ]based employees)/gi) ?? []).join("; ");
        jobRepo.upsert({ title: post.title, company, description: post.description, location: post.location, url: post.url, source: `Greenhouse:${token}`, remote: /remote/i.test(text), eligibility: eligibilityEvidence ? "supported" : "unknown", eligibilityEvidence: eligibilityEvidence ? `Posting text explicitly states: ${eligibilityEvidence}` : "No explicit work-location eligibility for Mexico was found; eligibility remains unknown.", searchLocation: location, searchQuery: query.query }, retrievedAt);
        imported++;
      }
    }
    database.prepare("INSERT INTO discovery_runs (id,source,started_at,finished_at,status,fetched,matched,imported,error) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), `Greenhouse:${token}`, startedAt, retrievedAt, "success", posts.length, filtered.length, imported, "");
    return { token, company, fetched: posts.length, matched: filtered.length, imported, retrievedAt, matches: filtered.slice(0, 8).map(({ title, location, url }) => ({ title, location, url })) };
  } catch (error) {
    database.prepare("INSERT INTO discovery_runs (id,source,started_at,finished_at,status,fetched,matched,imported,error) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), `Greenhouse:${token}`, startedAt, new Date().toISOString(), "failed", 0, 0, 0, error instanceof Error ? error.message : "Unknown discovery failure");
    throw error;
  }
}
