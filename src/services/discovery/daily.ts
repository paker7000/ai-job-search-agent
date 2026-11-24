import { runGreenhouseDiscovery } from "./greenhouse";
import { runRemoteOkSearch } from "./remoteok";

export interface DailyDiscoverySourceResult {
  source: "Greenhouse" | "Remote OK";
  status: "success" | "failed" | "skipped";
  imported: number;
  error: string;
}

export interface DailyDiscoveryResult {
  status: "success" | "partial" | "failed";
  imported: number;
  sources: DailyDiscoverySourceResult[];
}

export async function runDailyDiscovery(
  greenhouseToken: string | undefined,
  adapters: { greenhouse: typeof runGreenhouseDiscovery; remoteOk: typeof runRemoteOkSearch } = { greenhouse: runGreenhouseDiscovery, remoteOk: runRemoteOkSearch },
): Promise<DailyDiscoveryResult> {
  const sources: DailyDiscoverySourceResult[] = [];
  if (greenhouseToken) {
    try {
      const result = await adapters.greenhouse(greenhouseToken);
      sources.push({ source: "Greenhouse", status: "success", imported: result.imported, error: "" });
    } catch (error) {
      sources.push({ source: "Greenhouse", status: "failed", imported: 0, error: error instanceof Error ? error.message : "Discovery failed." });
    }
  } else {
    sources.push({ source: "Greenhouse", status: "skipped", imported: 0, error: "No Greenhouse board token is configured." });
  }

  try {
    const result = await adapters.remoteOk();
    sources.push({ source: "Remote OK", status: "success", imported: result.imported, error: "" });
  } catch (error) {
    sources.push({ source: "Remote OK", status: "failed", imported: 0, error: error instanceof Error ? error.message : "Discovery failed." });
  }

  const attempted = sources.filter((source) => source.status !== "skipped");
  const succeeded = attempted.filter((source) => source.status === "success").length;
  const status = succeeded === attempted.length ? "success" : succeeded > 0 ? "partial" : "failed";
  return { status, imported: sources.reduce((sum, source) => sum + source.imported, 0), sources };
}
