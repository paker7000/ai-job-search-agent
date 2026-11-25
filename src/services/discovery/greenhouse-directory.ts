import { greenhouseBoardRepo, searchPreferencesRepo } from "@/adapters/persistence/sqlite";
import type { GreenhouseDirectoryBoard } from "@/domain/types";

export const GREENHOUSE_DIRECTORY_URL = "https://huggingface.co/datasets/storesignalhq/ats-job-boards/resolve/main/boards.csv";
export const GREENHOUSE_DIRECTORY_PAGE = "https://huggingface.co/datasets/storesignalhq/ats-job-boards";
const MAX_DIRECTORY_BYTES = 5_000_000;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field); field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseDirectory(csv: string): GreenhouseDirectoryBoard[] {
  const rows = parseCsv(csv);
  const headers = rows.shift()?.map((value) => value.replace(/^\uFEFF/, "").trim().toLowerCase()) ?? [];
  const column = (name: string) => headers.indexOf(name);
  const atsIndex = column("ats"), slugIndex = column("slug"), companyIndex = column("company_name"), jobsIndex = column("open_jobs");
  if ([atsIndex, slugIndex, companyIndex, jobsIndex].some((index) => index < 0)) throw new Error("The board directory CSV is missing required columns.");
  return rows.flatMap((values) => {
    const slug = (values[slugIndex] ?? "").trim();
    if ((values[atsIndex] ?? "").trim().toLowerCase() !== "greenhouse" || !/^[A-Za-z0-9_-]{2,100}$/.test(slug)) return [];
    const companyName = (values[companyIndex] ?? "").trim().slice(0, 240) || slug;
    const openJobs = Math.max(0, Number.parseInt(values[jobsIndex] ?? "0", 10) || 0);
    return [{ slug, companyName, openJobs, boardUrl: `https://boards.greenhouse.io/${slug}` }];
  });
}

export async function refreshGreenhouseDirectory(fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(GREENHOUSE_DIRECTORY_URL, { signal: controller.signal, cache: "no-store", headers: { accept: "text/csv" } });
    if (!response.ok) throw new Error(`Board directory returned HTTP ${response.status}.`);
    if (Number(response.headers.get("content-length") ?? 0) > MAX_DIRECTORY_BYTES) throw new Error("Board directory exceeded the 5 MB limit.");
    if (!response.body) throw new Error("Board directory response has no body.");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DIRECTORY_BYTES) { await reader.cancel(); throw new Error("Board directory exceeded the 5 MB limit."); }
      chunks.push(value);
    }
    const csv = Buffer.concat(chunks).toString("utf8");
    const boards = parseDirectory(csv);
    if (!boards.length) throw new Error("The board directory contained no Greenhouse boards.");
    const snapshot = { retrievedAt: new Date().toISOString(), boards };
    greenhouseBoardRepo.saveDirectorySnapshot(snapshot);
    return snapshot;
  } finally { clearTimeout(timer); }
}

export async function getGreenhouseDirectory(fetcher: typeof fetch = fetch) {
  return greenhouseBoardRepo.directorySnapshot() ?? refreshGreenhouseDirectory(fetcher);
}

export async function searchGreenhouseDirectory(query: string, fetcher: typeof fetch = fetch) {
  const snapshot = await getGreenhouseDirectory(fetcher);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const companyKeywords = searchPreferencesRepo.get().companyKeywords.map((value) => value.toLocaleLowerCase());
  const results = snapshot.boards.filter((board) => normalizedQuery
    ? `${board.companyName} ${board.slug}`.toLocaleLowerCase().includes(normalizedQuery)
    : companyKeywords.some((term) => board.companyName.toLocaleLowerCase().includes(term) || board.slug.toLocaleLowerCase().includes(term)));
  results.sort((a, b) => b.openJobs - a.openJobs || a.companyName.localeCompare(b.companyName));
  return { retrievedAt: snapshot.retrievedAt, directoryCount: snapshot.boards.length, candidates: results.slice(0, 100) };
}
