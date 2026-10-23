import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.DATABASE_PATH = join(tmpdir(), `job-agent-test-${randomUUID()}.sqlite`);
