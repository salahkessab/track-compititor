import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import sharp from "sharp";
import type { VisualCandidate } from "./recipeVisualResearch";

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as [string,number][]) blocked.addSubnet(address,prefix,"ipv4");
blocked.addSubnet("2001:db8::",32,"ipv6");
blocked.addSubnet("2001:10::",28,"ipv6");
blocked.addSubnet("2001::",32,"ipv6");
blocked.addSubnet("2002::",16,"ipv6");

function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address,"ipv4");
  if (family === 6) {
    // Accept only globally routed IPv6 unicast; excludes loopback, local,
    // link-local and IPv4-mapped addresses before pinning the DNS result.
    const first = parseInt(address.split(":")[0] || "0",16);
    return first >= 0x2000 && first <= 0x3fff && !blocked.check(address,"ipv6");
  }
  return false;
}

/** Bounded HTTPS request with DNS pinning and redirect revalidation. */
async function getPublic(urlText: string, method: "GET" | "HEAD", redirects = 0, page = false): Promise<{ status: number; bytes: Buffer; finalUrl:string; contentType:string }> {
  const url = new URL(urlText);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || redirects > 2) throw new Error("Unsupported public URL");
  const answers = await lookup(url.hostname,{all:true,verbatim:true});
  if (!answers.length || answers.some(a => !publicAddress(a.address))) throw new Error("Non-public destination");
  const chosen = answers[0];
  const result = await new Promise<{ status: number; bytes: Buffer; location?: string; contentType:string }>((resolve,reject) => {
    const req = request(url,{ method, family:chosen.family, headers:{"User-Agent":"RecipeDesignsVisualResearch/1.0",Accept:page ? "text/html,application/xhtml+xml" : "image/jpeg,image/png,image/webp"},
      lookup: (_hostname,_options,callback) => callback(null,chosen.address,chosen.family), timeout:8000 }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data",chunk => { size += chunk.length; if (size > 2_000_000) { req.destroy(new Error("Image too large")); return; } chunks.push(chunk); });
      res.on("end",() => resolve({status:res.statusCode || 0, bytes:Buffer.concat(chunks), location:res.headers.location,contentType:String(res.headers["content-type"] || "")}));
      res.on("error",reject);
    });
    req.on("timeout",() => req.destroy(new Error("Public image timed out")));
    req.on("error",reject); req.end();
  });
  if ([301,302,303,307,308].includes(result.status) && result.location) return getPublic(new URL(result.location,url).href,method,redirects+1,page);
  return {...result,finalUrl:url.href};
}

function accessiblePage(original:string, imageUrls:string[], source:{status:number;bytes:Buffer;finalUrl:string;contentType:string} | null):boolean {
  if (!source || source.status<200 || source.status>=300 || !/text\/html|application\/xhtml\+xml/i.test(source.contentType) || source.bytes.length<200) return false;
  const before=new URL(original),after=new URL(source.finalUrl);
  const domain=(s:string)=>s.toLowerCase().replace(/^www\./,"");
  const path=(s:string)=>s.replace(/\/+$/,"").toLowerCase();
  if(domain(before.hostname)!==domain(after.hostname) || path(before.pathname)!==path(after.pathname)) return false;
  const html=source.bytes.toString("utf8");
  if (/<title[^>]*>[^<]*(log\s*in|sign\s*in|login|required authentication|just a moment|access denied)/i.test(html)
    || /<form[^>]*(?:action|id|class)=["'][^"']*(?:login|signin|sign-in)/i.test(html)
    || /verify you are human|checking your browser|cf-browser-verification/i.test(html)) return false;
  // Do not treat a generic page or a sign-in/consent redirect as evidence for
  // an unrelated image. Some sites render images client-side: those remain
  // unverified rather than being counted as confirmed examples.
  return imageUrls.some(imageUrl=>{
    const path=new URL(imageUrl).pathname;
    const rawName=path.split("/").pop() || "";
    let name=rawName; try { name=decodeURIComponent(rawName); } catch { /* keep the raw path */ }
    return html.includes(imageUrl) || (name.length>=12 && html.includes(name));
  });
}

export type FetchedVisual = VisualCandidate & { thumbnail: string; sourceStatus: "accessible" | "unverified" };
/** Only decoded, bounded thumbnails are sent to vision; original bytes aren't used in exports. */
export async function fetchVisualCandidates(candidates: VisualCandidate[]): Promise<FetchedVisual[]> {
  const found = await Promise.all(candidates.slice(0,8).map(async candidate => {
    try {
      const [image,source] = await Promise.all([
        (async()=>{ const thumb=await getPublic(candidate.thumbnailUrl,"GET").catch(()=>null); return thumb && thumb.status>=200 && thumb.status<300 ? thumb : getPublic(candidate.imageUrl,"GET"); })(),
        getPublic(candidate.sourceUrl,"GET",0,true).catch(() => null),
      ]);
      if (image.status < 200 || image.status >= 300) return null;
      const pipeline = sharp(image.bytes,{limitInputPixels:20_000_000,animated:false});
      const meta = await pipeline.metadata();
      if (!["jpeg","png","webp"].includes(meta.format || "")) return null;
      const bytes = await pipeline.resize({width:480,height:480,fit:"inside",withoutEnlargement:true}).jpeg({quality:68}).toBuffer();
      if (bytes.length > 130_000) return null;
      return {...candidate,thumbnail:`data:image/jpeg;base64,${bytes.toString("base64")}`,
        sourceStatus:accessiblePage(candidate.sourceUrl,[candidate.imageUrl,candidate.thumbnailUrl],source) ? "accessible" as const : "unverified" as const};
    } catch { return null; }
  }));
  return found.filter((v): v is FetchedVisual => v !== null);
}
