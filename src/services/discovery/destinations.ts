import type { SearchDestination } from "@/domain/types";

export const searchDestinations: SearchDestination[] = [
  { id: "linkedin", label: "LinkedIn Jobs", group: "general", url: "https://www.linkedin.com/jobs/search/", access: "direct-search", note: "Opens LinkedIn search with keywords and location; automated collection requires authorized API access." },
  { id: "indeed", label: "Indeed", group: "general", url: "https://www.indeed.com/jobs", access: "direct-search", note: "Opens Indeed search with keywords and location; no scraping." },
  { id: "glassdoor", label: "Glassdoor", group: "general", url: "https://www.glassdoor.com/Job/jobs.htm", access: "direct-search", note: "Opens Glassdoor search; automated collection needs authorized access." },
  { id: "occ", label: "OCC Mundial", group: "general", url: "https://www.occ.com.mx/empleos/", access: "link-out", note: "Open the Mexico job board and enter the generated query." },
  { id: "wellfound", label: "Wellfound", group: "general", url: "https://wellfound.com/jobs", access: "link-out", note: "Open the startup job board and enter the generated query." },
  { id: "remoteok", label: "Remote OK", group: "remote", url: "https://remoteok.com/remote-jobs", access: "public-feed", note: "Public JSON feed; listings show Remote OK attribution and link directly to the original post." },
  { id: "remotive", label: "Remotive", group: "remote", url: "https://remotive.com/remote-jobs", access: "link-out", note: "Direct search link. Public API/RSS has attribution and signup-display restrictions; not imported." },
  { id: "weworkremotely", label: "We Work Remotely", group: "remote", url: "https://weworkremotely.com/remote-jobs", access: "link-out", note: "Direct search link. Terms restrict using its data in a job-search service; not imported." },
  { id: "remoteco", label: "Remote.co", group: "remote", url: "https://remote.co/remote-jobs", access: "link-out", note: "Open the remote jobs page and enter the generated query." },
  { id: "workingnomads", label: "Working Nomads", group: "remote", url: "https://www.workingnomads.com/jobs", access: "link-out", note: "Open the remote jobs page and enter the generated query." },
];

export function destinationSearchUrl(destinationId: string, query: string, location: string): string {
  const destination = searchDestinations.find((item) => item.id === destinationId);
  if (!destination) throw new Error("Unknown search destination.");
  const url = new URL(destination.url);
  if (destinationId === "linkedin") {
    url.searchParams.set("keywords", query);
    url.searchParams.set("location", location);
  } else if (destinationId === "indeed") {
    url.searchParams.set("q", query);
    url.searchParams.set("l", location);
  } else if (destinationId === "glassdoor") {
    url.searchParams.set("sc.keyword", `${query} ${location}`.trim());
  }
  return url.toString();
}

export function matchesRemoteOkLocation(listingLocation: string, queryLocation: string): boolean {
  const listing = listingLocation.toLocaleLowerCase();
  const query = queryLocation.toLocaleLowerCase();
  if (!listing.trim()) return true; // Preserve remote listings with unknown location; eligibility remains unknown.
  if (/worldwide|anywhere|global|remote globally|all countries|international/.test(listing)) return true;
  if (query.includes("texas")) return /texas|\btx\b|united states|\busa\b|\bu\.s\.\b/.test(listing);
  if (query.includes("monterrey") || query.includes("mexico")) return /mexico|\bmx\b|latin america|\blatam\b|monterrey|nuevo le[oó]n/.test(listing);
  return listing.includes(query);
}
