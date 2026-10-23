export type Eligibility = "supported" | "contradicted" | "unknown";
export type ApplicationStatus = "discovered" | "interested" | "preparing" | "applied" | "interviewing" | "offer" | "rejected" | "archived";

export interface CandidateProfile {
  summary: string;
  roles: string[];
  regions: string[];
  qualifications: string[];
  reviewFlags: string[];
}

export interface JobInput {
  title: string;
  company: string;
  description: string;
  location: string;
  url: string;
  source: string;
  remote: boolean;
  eligibility: Eligibility;
  eligibilityEvidence: string;
}

export interface Job extends JobInput {
  id: string;
  dedupeKey: string;
  status: ApplicationStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  evidence: Evidence[];
  match: MatchResult;
}

export interface Evidence {
  field: string;
  value: string;
  sourceUrl: string;
  retrievedAt: string;
}

export interface MatchResult {
  score: number;
  components: Record<string, number>;
  matched: string[];
  missing: string[];
  explanation: string;
}

export interface Approval {
  id: string;
  jobId: string;
  action: string;
  payload: string;
  payloadHash: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
}
