import { NextResponse } from "next/server";
import { greenhouseBoardRepo, searchPreferencesRepo } from "@/adapters/persistence/sqlite";
import { jsonError, readJson, requireAuth } from "@/lib/http";
import { getGreenhouseDirectory, refreshGreenhouseDirectory, searchGreenhouseDirectory, GREENHOUSE_DIRECTORY_PAGE } from "@/services/discovery/greenhouse-directory";
import { previewGreenhouseBoard } from "@/services/discovery/greenhouse";

export const runtime = "nodejs";
const MAX_SELECTED_BOARDS = 25;

export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const query = new URL(request.url).searchParams.get("q")?.slice(0, 120) ?? "";
  try {
    const result = await searchGreenhouseDirectory(query);
    return NextResponse.json({ ...result, boards: greenhouseBoardRepo.all(), sourceUrl: GREENHOUSE_DIRECTORY_PAGE });
  } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not load the Greenhouse board directory.", 502); }
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await readJson(request);
  if (!body || typeof body.action !== "string") return jsonError("Provide a board-directory action.", 400);

  if (body.action === "refresh") {
    try {
      const snapshot = await refreshGreenhouseDirectory();
      return NextResponse.json({ retrievedAt: snapshot.retrievedAt, directoryCount: snapshot.boards.length, boards: greenhouseBoardRepo.all(), sourceUrl: GREENHOUSE_DIRECTORY_PAGE });
    } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not refresh the Greenhouse directory.", 502); }
  }

  if (body.action === "remove") {
    const token = String(body.token ?? "");
    if (!/^[A-Za-z0-9_-]{2,100}$/.test(token)) return jsonError("Invalid Greenhouse board token.", 400);
    greenhouseBoardRepo.remove(token);
    return NextResponse.json({ boards: greenhouseBoardRepo.all() });
  }

  if (body.action === "preview") {
    const token = String(body.token ?? "");
    const company = String(body.company ?? token).trim().slice(0, 240);
    if (!/^[A-Za-z0-9_-]{2,100}$/.test(token) || !company) return jsonError("Provide a valid board token and company name.", 400);
    try {
      const preview = await previewGreenhouseBoard(token, company, searchPreferencesRepo.get());
      return NextResponse.json({ preview });
    } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not verify this Greenhouse board.", 502); }
  }
  if (body.action === "add") {
    const token = String(body.token ?? "");
    if (!/^[A-Za-z0-9_-]{2,100}$/.test(token)) return jsonError("Provide a valid Greenhouse board token.", 400);
    try {
      const directory = await getGreenhouseDirectory();
      const candidate = directory.boards.find((board) => board.slug.toLowerCase() === token.toLowerCase());
      if (!candidate) return jsonError("This board is not in the refreshed directory. Refresh it or add the board through the regular Greenhouse importer.", 404);
      const existing = greenhouseBoardRepo.all();
      if (!existing.some((board) => board.token === token) && existing.length >= MAX_SELECTED_BOARDS) return jsonError(`You can select up to ${MAX_SELECTED_BOARDS} boards. Remove one before adding another.`, 400);
      const board = greenhouseBoardRepo.add({ token, company: candidate.companyName, boardUrl: candidate.boardUrl, openJobsSnapshot: candidate.openJobs });
      return NextResponse.json({ board, boards: greenhouseBoardRepo.all() });
    } catch (error) { return jsonError(error instanceof Error ? error.message : "Could not add this Greenhouse board.", 502); }
  }
  return jsonError("Unknown board-directory action.", 400);
}
