import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import { acceptedPraxistFindings } from "../src/lib/praxist/findings.ts";

test("Praxist handoff carries accepted substantive findings and rejects draft or path-injected entries", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "praxist-findings-test-"));
  try {
    assert.equal(await acceptedPraxistFindings(dir), "");
    await fs.mkdir(path.join(dir,"findings","legacy"),{recursive:true});
    await fs.mkdir(path.join(dir,"results","audit"),{recursive:true});
    await fs.writeFile(path.join(dir,"results","audit","result_summary.json"),JSON.stringify({checks:[{expression:"9 * 4",calculated:36,passed:true,basis:"Source and assumption"}]}));
    await fs.writeFile(path.join(dir,"findings","findings.jsonl"), [
      {finding_id:"f1",status:"accepted",claim:"The original calculation needs correction",provenance_quality:"agent"},
      {finding_id:"draft",status:"draft",claim:"Unreviewed claim"},
      {finding_id:"../../../outside",status:"accepted",claim:"Untrusted path"},
      {finding_id:"bad-reference",status:"accepted",claim:"Accepted record with an unsafe result reference"},
    ].map(JSON.stringify).join("\n"));
    await fs.writeFile(path.join(dir,"findings","legacy","f1.json"),JSON.stringify({legacy_finding:{content:"Checked 12 * 3 = 36, not 35",source:"https://example.test/source",limitation:"Assumed constant rate",source_result_path:"results/audit/result_summary.json"}}));
    await fs.writeFile(path.join(dir,"outside.json"),JSON.stringify({privateValue:"Must not read outside results"}));
    await fs.writeFile(path.join(dir,"findings","legacy","bad-reference.json"),JSON.stringify({legacy_finding:{source_result_path:"results/../outside.json"}}));
    const result = await acceptedPraxistFindings(dir);
    assert.match(result, /12 \* 3 = 36/);
    assert.match(result, /https:\/\/example.test\/source/);
    assert.match(result, /Assumed constant rate/);
    assert.match(result, /9 \* 4/);
    assert.match(result, /Source and assumption/);
    assert.doesNotMatch(result, /Must not read outside results/);
    assert.doesNotMatch(result, /Unreviewed claim|Untrusted path/);
  } finally {
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test("canonical artifact references deliver hash-verified finding payloads and their real receipts", async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"praxist-artifact-test-"));
  try {
    await fs.mkdir(path.join(dir,"findings"),{recursive:true});
    await fs.mkdir(path.join(dir,"artifacts","by_id","art_1"),{recursive:true});
    await fs.mkdir(path.join(dir,"results","audit"),{recursive:true});
    const payload=JSON.stringify({finding_id:"f1",legacy_finding:{content:"Actual checked finding",metrics:{source_result_path:"results/audit/result_summary.json"}}});
    const ref={artifact_type:"finding",run_id:"r1",payload_path:"artifacts/by_id/art_1/payload.json",content_hash:`sha256:${createHash("sha256").update(payload).digest("hex")}`};
    await fs.writeFile(path.join(dir,ref.payload_path),payload);
    await fs.writeFile(path.join(dir,"results/audit/result_summary.json"),JSON.stringify({checks:[{expression:"3 * 4",calculated:12}]}));
    await fs.writeFile(path.join(dir,"findings/findings.jsonl"),JSON.stringify({finding_id:"f1",run_id:"r1",status:"draft",evidence_refs:[ref]}));
    await fs.writeFile(path.join(dir,"findings/frontier.jsonl"),JSON.stringify({schema_version:"praxist.frontier.v1",finding_id:"f1",run_id:"r1",action:"promoted"}));
    const result=await acceptedPraxistFindings(dir);
    assert.match(result,/Actual checked finding/);
    assert.match(result,/3 \* 4/);
    await fs.writeFile(path.join(dir,ref.payload_path),payload.replace("Actual checked finding","Tampered finding"));
    assert.doesNotMatch(await acceptedPraxistFindings(dir),/Tampered finding/);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test("canonical workflow promotions accept legacy drafts only for the matching run and finding", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "praxist-promotion-test-"));
  try {
    await fs.mkdir(path.join(dir,"findings"),{recursive:true});
    const findings=["promoted","other-run","unpromoted","revoked","rejected"].map(id=>({
      run_id:"run-a",finding_id:id,status:id==="rejected"?"rejected":"draft",claim:`Claim ${id}`,
    }));
    await fs.writeFile(path.join(dir,"findings","findings.jsonl"),findings.map(JSON.stringify).join("\n"));
    const promotion=(id,run="run-a",action="promoted")=>({schema_version:"praxist.frontier.v1",run_id:run,finding_id:id,action});
    await fs.writeFile(path.join(dir,"findings","frontier.jsonl"),[
      promotion("promoted"),promotion("other-run","run-b"),promotion("revoked"),promotion("revoked","run-a","removed"),promotion("rejected"),
    ].map(JSON.stringify).join("\n"));
    const result=await acceptedPraxistFindings(dir);
    assert.match(result,/Claim promoted/);
    assert.match(result,/Canonical workflow frontier promotion/);
    assert.doesNotMatch(result,/Claim other-run|Claim unpromoted|Claim revoked|Claim rejected/);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
