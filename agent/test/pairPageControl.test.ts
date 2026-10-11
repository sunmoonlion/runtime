import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe,it,expect} from "vitest";
import {readPageDiscovery,publishPageDiscovery} from "../src/pairPageControl.js";
import {createPairPage} from "../src/pairPage.js";

describe("protected page discovery",()=>{
  it("publishes only pid/url, cleans its own record, leaves a newer page untouched",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"sunmoon-page-discovery-")),file=path.join(root,"pair-page.json");
    const page=await createPairPage({refresh:async()=>{},cancel:async()=>{},done:async()=>{}});
    try{
      expect(readPageDiscovery(file)).toBeNull();
      const cleanup=publishPageDiscovery(page,file);
      expect(Object.keys(JSON.parse(fs.readFileSync(file,"utf8"))).sort()).toEqual(["pid","url"]);
      expect(readPageDiscovery(file)?.url).toBe(page.url);
      expect(()=>publishPageDiscovery(page,file)).toThrow(/已经打开/);
      cleanup();expect(fs.existsSync(file)).toBe(false);
      const cleanup2=publishPageDiscovery(page,file);
      fs.writeFileSync(file,JSON.stringify({pid:process.pid,url:page.url.replace(/.$/,page.url.endsWith("a")?"b":"a")}));
      cleanup2();expect(fs.existsSync(file)).toBe(true);
    }finally{await page.close();fs.rmSync(root,{recursive:true,force:true});}
  });
  it("refuses links, non-local URLs, malformed records and dead PIDs",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"sunmoon-page-discovery-")),file=path.join(root,"pair-page.json");
    try{
      const valid={pid:process.pid,url:"http://127.0.0.1:42000/setup/"+"a".repeat(64)};
      for(const bad of [{...valid,url:"http://localhost:42000/setup/"+"a".repeat(64)},{...valid,url:valid.url+"?token=fake"},{...valid,pid:-1},{...valid,token:"no"},{...valid,url:valid.url.replace(":42000",":65536")}]){
        fs.writeFileSync(file,JSON.stringify(bad));expect(()=>readPageDiscovery(file)).toThrow(/Invalid/);
      }
      fs.writeFileSync(file,JSON.stringify(valid));expect(readPageDiscovery(file,()=>false)).toBeNull();
      fs.unlinkSync(file);const target=path.join(root,"target");fs.mkdirSync(target);fs.symlinkSync(target,file,process.platform==="win32"?"junction":undefined);
      expect(()=>readPageDiscovery(file)).toThrow(/Unsafe/);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
});
