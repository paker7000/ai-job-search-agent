import { randomUUID } from "node:crypto";
import { database, jobRepo } from "@/adapters/persistence/sqlite";

async function readBoundedBody(response:Response,maxBytes:number){
  if(Number(response.headers.get("content-length")??0)>maxBytes)throw new Error("Source response exceeded the 4 MB limit.");
  if(!response.body)throw new Error("Source response has no body.");
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new Error("Source response exceeded the 4 MB limit.");}chunks.push(value);}
  return Buffer.concat(chunks).toString("utf8");
}

export async function runGreenhouseDiscovery(token: string) {
  const startedAt=new Date().toISOString();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,{signal:controller.signal,headers:{accept:"application/json"},cache:"no-store"});
    if(!response.ok)throw new Error(`Greenhouse returned HTTP ${response.status}.`);
    const text=await readBoundedBody(response,4_000_000);
    const data=JSON.parse(text) as {jobs?:Array<{id?:number,title?:string,absolute_url?:string,location?:{name?:string},content?:string}>};
    const retrievedAt=new Date().toISOString();let imported=0;
    for(const item of (data.jobs??[]).slice(0,200)){
      if(!item.title||!item.absolute_url)continue;
      try { const postedUrl=new URL(item.absolute_url);if(postedUrl.protocol!=="https:"||postedUrl.username||postedUrl.password)continue; } catch { continue; }
      const location=item.location?.name??"Not specified";const description=(item.content??"").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").slice(0,50000);
      const joined=`${location} ${description}`.toLowerCase();const eligibilityEvidence=(joined.match(/(?:remote(?:ly)?\s+(?:from|in|anywhere in)\s+mexico|(?:hiring|hire|open to candidates|accepting candidates)\s+(?:in|from|located in)\s+mexico|mexico[- ]based employees)/gi)??[]).join("; ");
      const eligibility=eligibilityEvidence?"supported":"unknown";
      jobRepo.upsert({title:item.title,company:token,description,location,url:item.absolute_url,source:`Greenhouse:${token}`,remote:/remote/i.test(joined),eligibility,eligibilityEvidence:eligibilityEvidence?`Posting text explicitly states: ${eligibilityEvidence}`:"No explicit work-location eligibility for Mexico was found; eligibility remains unknown."},retrievedAt);imported++;
    }
    database.prepare("INSERT INTO discovery_runs (id,source,started_at,finished_at,status,imported,error) VALUES (?,?,?,?,?,?,?)").run(randomUUID(),`Greenhouse:${token}`,startedAt,new Date().toISOString(),"success",imported,"");
    return {imported,retrievedAt};
  }catch(error){database.prepare("INSERT INTO discovery_runs (id,source,started_at,finished_at,status,imported,error) VALUES (?,?,?,?,?,?,?)").run(randomUUID(),`Greenhouse:${token}`,startedAt,new Date().toISOString(),"failed",0,error instanceof Error?error.message:"Unknown discovery failure");throw error;
  }finally{clearTimeout(timer);}
}
