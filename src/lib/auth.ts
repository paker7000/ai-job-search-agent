import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { database } from "@/adapters/persistence/sqlite";

const cookieName = "job-agent-session";
function signingSecret() {
  const value=process.env.SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "local-development-only-change-before-deployment");
  if (!value) throw new Error("SESSION_SECRET must be set at runtime in production.");
  return value;
}

database.exec("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL);");
database.exec("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);");
database.exec("CREATE TABLE IF NOT EXISTS auth_failures (subject_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_started_at TEXT NOT NULL, locked_until TEXT NOT NULL);");

export function setupStatus() { return (database.prepare("SELECT COUNT(*) as count FROM users").get() as {count:number}).count === 0; }
function passwordRecord(password: string, salt = randomBytes(16).toString("hex")) { return { salt, hash: scryptSync(password, salt, 64).toString("hex") }; }
export function createAccount(email: string, password: string) {
  if (!setupStatus()) throw new Error("Account setup is already complete.");
  if (password.length < 12 || password.length > 200) throw new Error("Use a password between 12 and 200 characters.");
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error("Enter a valid email address.");
  const {salt,hash} = passwordRecord(password);
  database.prepare("INSERT INTO users (id,email,password_hash,salt,created_at) VALUES (?,?,?,?,?)").run(randomBytes(16).toString("hex"),normalized,hash,salt,new Date().toISOString());
  return normalized;
}
function issueSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const secret=signingSecret();
  database.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  const signed = `${token}.${createHmac("sha256",secret).update(token).digest("base64url")}`;
  database.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(createHmac("sha256",secret).update(token).digest("hex"),userId,new Date(Date.now()+7*86400000).toISOString());
  return signed;
}
export function login(email: string, password: string) {
  if(password.length>200)return null;
  const normalized=email.trim().toLowerCase();const subjectHash=createHmac("sha256",signingSecret()).update(normalized).digest("hex");const now=new Date();
  const failure=database.prepare("SELECT attempts,window_started_at,locked_until FROM auth_failures WHERE subject_hash=?").get(subjectHash) as {attempts:number,window_started_at:string,locked_until:string}|undefined;
  if(failure&&failure.locked_until>now.toISOString())return null;
  const user = database.prepare("SELECT id,password_hash,salt FROM users WHERE email=?").get(normalized) as {id:string,password_hash:string,salt:string}|undefined;
  if (!user) { recordFailure(subjectHash,now,failure);scryptSync(password.slice(0,200),"unknown-account-salt",64);return null; }
  const derived = Buffer.from(passwordRecord(password,user.salt).hash,"hex"); const expected = Buffer.from(user.password_hash,"hex");
  if(derived.length===expected.length&&timingSafeEqual(derived,expected)){database.prepare("DELETE FROM auth_failures WHERE subject_hash=?").run(subjectHash);return issueSession(user.id);}
  recordFailure(subjectHash,now,failure);return null;
}
function recordFailure(subjectHash:string,now:Date,previous:{attempts:number,window_started_at:string,locked_until:string}|undefined){
  const windowLive=Boolean(previous&&now.getTime()-Date.parse(previous.window_started_at)<15*60*1000);const attempts=windowLive?(previous?.attempts??0)+1:1;const windowStarted=windowLive?previous!.window_started_at:now.toISOString();const lockedUntil=attempts>=5?new Date(now.getTime()+15*60*1000).toISOString():"";
  database.prepare("INSERT INTO auth_failures (subject_hash,attempts,window_started_at,locked_until) VALUES (?,?,?,?) ON CONFLICT(subject_hash) DO UPDATE SET attempts=excluded.attempts,window_started_at=excluded.window_started_at,locked_until=excluded.locked_until").run(subjectHash,attempts,windowStarted,lockedUntil);
}
export function verifySessionCookie(value: string | undefined) {
  if (!value) return false;
  const secret=signingSecret();
  const [token,signature] = value.split("."); if (!token || !signature) return false;
  const expected = createHmac("sha256",secret).update(token).digest(); let supplied:Buffer;
  try { supplied = Buffer.from(signature,"base64url"); } catch { return false; }
  if (expected.length !== supplied.length || !timingSafeEqual(expected,supplied)) return false;
  const session = database.prepare("SELECT expires_at FROM sessions WHERE token_hash=?").get(createHmac("sha256",secret).update(token).digest("hex")) as {expires_at:string}|undefined;
  return Boolean(session && session.expires_at > new Date().toISOString());
}
export async function isAuthenticated() { const jar = await cookies(); return verifySessionCookie(jar.get(cookieName)?.value); }
export const sessionCookieName = cookieName;
