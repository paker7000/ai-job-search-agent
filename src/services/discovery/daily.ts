import { runGreenhouseDiscovery } from "./greenhouse";
import { runRemoteOkSearch } from "./remoteok";
import type { GreenhouseDiscoveryResult } from "./greenhouse";

export interface DailyDiscoverySourceResult {
  source: "Greenhouse" | "Remote OK";
  status: "success" | "partial" | "failed" | "skipped";
  fetched: number;
  matched: number;
  imported: number;
  error: string;
  boards?: Array<{ token: string; company: string; status: "success" | "failed"; fetched: number; matched: number; imported: number; error: string }>;
}

export interface DailyDiscoveryResult {
  status: "success" | "partial" | "failed";
  imported: number;
  sources: DailyDiscoverySourceResult[];
}

export async function runDailyDiscovery(
  greenhouseBoards: Array<{ token: string; company: string }>,
  adapters: { greenhouse: (token: string, company: string) => Promise<GreenhouseDiscoveryResult>; remoteOk: typeof runRemoteOkSearch } = { greenhouse: runGreenhouseDiscovery, remoteOk: runRemoteOkSearch },
): Promise<DailyDiscoveryResult> {
  const sources: DailyDiscoverySourceResult[] = [];
  if (greenhouseBoards.length) {
    const boardResults: NonNullable<DailyDiscoverySourceResult["boards"]> = [];
    for (const [index, board] of greenhouseBoards.slice(0, 25).entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const result = await adapters.greenhouse(board.token, board.company);
        boardResults.push({ token: board.token, company: board.company, status: "success", fetched: result.fetched, matched: result.matched, imported: result.imported, error: "" });
      } catch (error) {
        boardResults.push({ token: board.token, company: board.company, status: "failed", fetched: 0, matched: 0, imported: 0, error: error instanceof Error ? error.message : "Discovery failed." });
      }
    }
    const succeeded = boardResults.filter((board) => board.status === "success").length;
    const status = succeeded === boardResults.length ? "success" : succeeded > 0 ? "partial" : "failed";
    sources.push({ source: "Greenhouse", status, fetched: boardResults.reduce((sum, board) => sum + board.fetched, 0), matched: boardResults.reduce((sum, board) => sum + board.matched, 0), imported: boardResults.reduce((sum, board) => sum + board.imported, 0), error: "", boards: boardResults });
  } else {
    sources.push({ source: "Greenhouse", status: "skipped", fetched: 0, matched: 0, imported: 0, error: "No Greenhouse boards are selected." });
  }

  try {
    const result = await adapters.remoteOk();
    sources.push({ source: "Remote OK", status: "success", fetched: result.fetched, matched: result.matched, imported: result.imported, error: "" });
  } catch (error) {
    sources.push({ source: "Remote OK", status: "failed", fetched: 0, matched: 0, imported: 0, error: error instanceof Error ? error.message : "Discovery failed." });
  }

  const attempted = sources.filter((source) => source.status !== "skipped");
  const succeeded = attempted.filter((source) => source.status === "success").length;
  const hadSuccess = attempted.some((source) => source.status === "success" || source.status === "partial");
  const status = succeeded === attempted.length ? "success" : hadSuccess ? "partial" : "failed";
  return { status, imported: sources.reduce((sum, source) => sum + source.imported, 0), sources };
}
