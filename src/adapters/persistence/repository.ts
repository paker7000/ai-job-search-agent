import type { Approval, CandidateProfile, Job, JobInput, SearchPreferences } from "@/domain/types";

export interface JobRepository {
  all(): Job[];
  upsert(input: JobInput, retrievedAt?: string): Job;
  update(id: string, update: Partial<Pick<Job, "status" | "notes" | "eligibility" | "eligibilityEvidence">>): Job | null;
  delete(id: string): boolean;
}

export interface ProfileRepository {
  get(): CandidateProfile;
  save(profile: CandidateProfile): CandidateProfile;
}

export interface SearchPreferencesRepository {
  get(): SearchPreferences;
  save(preferences: SearchPreferences): SearchPreferences;
}

export interface ApprovalRepository {
  create(jobId: string, action: string, payload: string, now?: Date): Approval;
  decide(id: string, status: "approved" | "rejected", now?: Date): Approval | null;
  all(): Approval[];
}
