import type { Job } from "@/domain/types";

export interface JobSearchFilters {
  keyword: string;
  queryLocation: string;
  status: string;
  postedWithinDays: number | null;
  workMode: "all" | "remote" | "non-remote" | "unknown";
  salary: "all" | "listed" | "unlisted";
  employmentType: string;
}

export type JobSort = "fit" | "newest" | "role" | "company";

export function filterAndSortJobs(jobs: Job[], filters: JobSearchFilters, sort: JobSort, now = Date.now()): Job[] {
  const keyword = filters.keyword.trim().toLocaleLowerCase();
  const filtered = jobs.filter((job) => {
    if (filters.status !== "all" && job.status !== filters.status) return false;
    if (keyword && !`${job.title} ${job.company} ${job.description}`.toLocaleLowerCase().includes(keyword)) return false;
    if (filters.queryLocation && !job.evidence.some((item) => item.field === "searchLocation" && item.value === filters.queryLocation)) return false;
    if (filters.postedWithinDays !== null) {
      const posted = job.publishedAt ? Date.parse(job.publishedAt) : Number.NaN;
      if (!Number.isFinite(posted) || posted < now - filters.postedWithinDays * 86_400_000 || posted > now) return false;
    }
    const isRemote = Boolean(job.workType?.toLocaleLowerCase().includes("remote") || job.remote);
    const isKnownNonRemote = Boolean(job.workType && !isRemote);
    if (filters.workMode === "remote" && !isRemote) return false;
    if (filters.workMode === "non-remote" && !isKnownNonRemote) return false;
    if (filters.workMode === "unknown" && (isRemote || isKnownNonRemote)) return false;
    const salaryListed = Boolean(job.salary?.trim());
    if (filters.salary === "listed" && !salaryListed) return false;
    if (filters.salary === "unlisted" && salaryListed) return false;
    if (filters.employmentType && (job.employmentType ?? "") !== filters.employmentType) return false;
    return true;
  });
  const byDate = (job: Job) => {
    const parsed = job.publishedAt ? Date.parse(job.publishedAt) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  return filtered.sort((a, b) => {
    if (sort === "newest") return byDate(b) - byDate(a) || b.match.score - a.match.score;
    if (sort === "role") return a.title.localeCompare(b.title) || b.match.score - a.match.score;
    if (sort === "company") return a.company.localeCompare(b.company) || b.match.score - a.match.score;
    return b.match.score - a.match.score || byDate(b) - byDate(a);
  });
}
