"use client";
import { VerifiedImage } from "./VerifiedImage";
import { prepareClientImage, resolveImageResponse } from "@/lib/preparedImageClient";
import { readGenerationPayload } from "@/lib/generationResponse";

import { useEffect, useRef, useState } from "react";
import { prepareRecipeDownload } from "@/lib/recipeWebp";
import { OpenAIImageControls } from "./OpenAIImageControls";
import { ImageFilterStudio, type FilteredImage } from "./ImageFilterStudio";
import { DEFAULT_DESIGN_SETTINGS, CURATED_DESIGN_FAMILIES, avoidRecentRecipeLayout, recipeArtworkSize, recipeDesignAspect, selectRecipeStyle, validateDesignSettings, validateTemplateEdits, validateResearch, validateTitle, type DesignFamily, type DesignMode, type DesignPlan, type DesignSettings, type Research, type TemplateEdits } from "@/lib/recipeDesigns";
import { getRecipeStyle, RECIPE_STYLE_PRESETS, renderRecipeStylePrompt, validateRecipePromptCopy, type RecipePromptCopy } from "@/lib/recipeDesignStylePresets";
import { OPENAI_MODELS } from "@/lib/config";
import { OPENAI_IMAGE_MODEL_IDS, imageQualitiesFor, supportsImageComplexity } from "@/lib/openaiImageSettings";
import { estimateOpenAIImageOutput } from "@/lib/imagePricing";
import { analysisThumbnail, prepareLocalPhoto, type LocalPhoto } from "@/lib/recipeDesignPhoto";
import { recipeEditImage } from "@/lib/recipeDesignPhoto";
import { recipeDirectPrompt } from "@/lib/recipeDesignDirect";
import { INGREDIENT_CARD_STYLE_ID, validateRecipeIngredients } from "@/lib/recipeDesignIngredients";
import { recipeDesignPng, recipeDesignDimensions } from "@/lib/recipeDesignOutput";
import { renderIngredientsCard, renderProtectedDesign, recipeDesignLayout, type DesignQA } from "@/lib/recipeDesignRenderer";
import { referenceTemplate, TEMPLATE_COLORS } from "@/lib/recipeDesignScene";
import { listLocal, loadLocal, releasePaidJob, removeLocal, saveLocal } from "@/lib/recipeDesignStorage";

type Cost = { cost: number; textCost: number; imageCost: number | null; searchCost: number; costIncomplete: boolean };
type Result = { downloadFormat?: "png" | "webp"; outputWidth?: number; outputHeight?: number; id: string; sourceId: string; title: string; noText: boolean; createdAt: string; plan: DesignPlan; research: Research | null; researchStatus: string; artwork: Blob | null; image: Blob; qa: DesignQA; status: string; costs: Cost[]; ingredients?:string; evidence?: string; designSignature?:string; textModel?:string; imageModel?:string; artworkSize?:string; promptSnapshot?:string; filter?: Omit<FilteredImage, "blob"> & { parentId: string } };
function recipeResultFormat(result: Result): "png" | "webp" { return result.downloadFormat ?? (result.artworkSize === "1536x864" || (result.outputWidth === 1536 && result.outputHeight === 864) ? "webp" : "png"); }
type Job = { id: string; stage: string; createdAt: string; updatedAt?: string; revision?: number; status: "working" | "complete" | "unknown" | "failed"; costs: Cost[] };
type Preset = { name: string; version: number; savedAt: string; settings: DesignSettings };

const inputClass = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-600 disabled:opacity-50";
const buttonClass = "rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40";
const accentClass = "rounded-xl bg-gradient-to-r from-blue-600 to-blue-600 px-4 py-3 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
const labels: Record<DesignFamily, string> = { notebook:"Vintage Recipe Card", black_label:"Archival Black Label", farmhouse:"Farmhouse Index Card", retro_diner:"Retro Diner Sign", minimal:"Minimal Food Blog", heritage:"Botanical Folio", editorial:"Modern Editorial Food", mediterranean:"Mediterranean Market Print" };
const templatePlan: DesignPlan = { family:"notebook", palette:["#cdbb9d", "#f5ecd8", "#62352d"], typography:"Classic serif", layout:"Food-first notebook", decoration:"Quiet paper texture", referenceSummary:"", photoSummary:"", researchSummary:"" };
const researchKey = (title: string, direction: string) => `visual-v2|${title.toLocaleLowerCase().trim()}|${direction}`;

function mergeJob(jobs: Job[], next: Job): Job[] {
  const previous=jobs.find(job=>job.id===next.id);
  if(previous && (previous.revision || 0)>(next.revision || 0))return jobs;
  return [next,...jobs.filter(job=>job.id!==next.id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
function mergeHistory(history: Result[], next: Result): Result[] {
  return [next,...history.filter(item=>item.id!==next.id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
function recoverJob(job: Job): Job {
  const lastUpdate=Date.parse(job.updatedAt || job.createdAt);
  return job.status==="working" && Number.isFinite(lastUpdate) && Date.now()-lastUpdate>10*60_000 ? {...job,status:"unknown"} : job;
}

function ImageBlob({ blob, alt, className }: { blob: Blob; alt: string; className: string }) {
  const [url,setUrl] = useState("");
  useEffect(() => { const next=URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); },[blob]);
  // eslint-disable-next-line @next/next/no-img-element
  return <VerifiedImage source={blob} alt={alt} className={className} />;
}
function ReferenceDNA({plan}:{plan:DesignPlan}) {
  if(plan.evidenceMode!=="uploaded_reference" || !plan.styleDNA)return null;
  const rows:[string,string][]=[["Photo",plan.styleDNA.photoLayout],["Title",plan.styleDNA.titleHierarchy],["Palette",plan.styleDNA.palette],["Label and frame",plan.styleDNA.labelAndFrame],["Ornaments",plan.styleDNA.ornaments],["Mood",plan.styleDNA.mood]];
  return <details className="mt-2 text-xs text-gray-600"><summary className="cursor-pointer">Reference style DNA</summary>{rows.filter(([,v])=>v).map(([k,v])=><p key={k} className="mt-1"><strong>{k}:</strong> {v}</p>)}</details>;
}
function VisualInspiration({ result }: {result:Result}) {
  const research=result.research;
  if (!research) return result.plan.evidenceMode === "uploaded_reference" && result.plan.referenceSummary ? <div className="mt-4 text-xs text-gray-600"><p><strong>Uploaded style inspiration · performance unverified:</strong> {result.plan.referenceSummary}</p><ReferenceDNA plan={result.plan}/></div> : null;
  const examples=research.version===2 ? research.examples || [] : [];
  const verified=examples.filter(e=>e.inspection==="vision" && e.sourceStatus==="accessible");
  return <section className="mt-5 border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-600" aria-label="Visual Inspiration">
    <h3 className="text-sm font-semibold text-gray-900">Visual Inspiration</h3>
    <p className="mt-1">{result.researchStatus} · {new Date(research.date).toLocaleString()}</p>
    <p className="mt-2"><strong>Selected direction:</strong> {labels[result.plan.family]}{result.plan.whyFits ? <> · <strong>Why it fits:</strong> {result.plan.whyFits}</> : null}</p>
    {!verified.length && <p className="mt-2 text-blue-700">No public visual examples could be verified. {result.plan.evidenceMode==="uploaded_reference"?"The uploaded reference leads this design.":"This direction is knowledge-based."}</p>}
    {result.plan.evidenceMode==="uploaded_reference" && result.plan.referenceSummary && <p className="mt-2"><strong>Uploaded style reference · performance unverified:</strong> {result.plan.referenceSummary}</p>}
    <ReferenceDNA plan={result.plan}/>
    {examples.length>0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{examples.map(example=><article key={example.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}<img src={example.thumbnail} alt={example.caption || "Discovered recipe design inspiration"} className="h-28 w-full rounded object-contain"/>
      <p className="mt-2 font-medium text-gray-900">Visual inspiration only · no performance evidence</p>
      <p className="mt-1">{example.sourceStatus==="accessible"?"Source page accessible":"Source page unverified"} · {example.inspection==="vision"?"image inspected":"image not inspected"}</p>
      <p className="mt-1">Image reuse rights: not verified; check the source.</p>
      {example.observation && <p className="mt-1">{example.observation}</p>}
      <p className="mt-1">{[example.photoPlacement,example.typography,example.palette,example.label].filter(Boolean).join(" · ")}</p>
      <a href={example.sourceUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block break-all underline">Open source · {new URL(example.sourceUrl).hostname}</a>
      <p className="mt-1">Discovered {new Date(example.observedAt).toLocaleDateString()}{example.publishedAt?` · Published ${new Date(example.publishedAt).toLocaleDateString()}`:""}</p>
    </article>)}</div>}
    <details className="mt-3"><summary className="cursor-pointer">Sources &amp; limitations</summary><p className="mt-2">{research.summary}</p>{(research.limitations || []).map(v=><p key={v} className="mt-1">{v}</p>)}{research.version!==2 && <p className="mt-1">Earlier text research; no visual examples saved.</p>}
      <ul className="mt-2 space-y-1">{research.sources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener" className="break-all underline">{s.title || s.url}</a></li>)}</ul></details>
    {!!research.platformSources?.length && <details className="mt-2"><summary className="cursor-pointer">Platform guidance · not visual examples</summary><ul className="mt-2 space-y-1">{research.platformSources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener" className="break-all underline">{s.title || s.url}</a></li>)}</ul></details>}
  </section>;
}
class DesignRequestError extends Error {
  constructor(message: string, readonly outcome: "reported" | "unknown" | "not_dispatched", readonly usage?: Cost) { super(message); }
}
async function post(path: string, body: unknown, signal: AbortSignal) {
  const incoming = await fetch(path,{method:"POST",headers:{"content-type":"application/json",accept:"application/x-ndjson"},body:JSON.stringify(body),signal});
  const {response,data} = await readGenerationPayload(incoming);
  if (!response.ok && data.assetId && data.retryable) return resolveImageResponse(response, data);
  if (!response.ok) {
    const outcome = data.outcome === "reported" || data.outcome === "not_dispatched" ? data.outcome : "unknown";
    const usage = data.usage && Number.isFinite(data.usage.cost) && typeof data.usage.costIncomplete === "boolean" ? data.usage as Cost : undefined;
    throw new DesignRequestError([data.error || `Request failed (${response.status}).`,data.costStatus].filter(Boolean).join(" "),outcome,usage);
  }
  return data;
}
async function download(blob: Blob, name: string, format?: "png" | "webp") {
  const prepared = await prepareClientImage(blob, ["png", "webp"]);
  blob = format ? await (await fetch(prepared.variants[format])).blob() : prepared.blob;
  if (format) name = name.replace(/\.[^.]+$/, "." + format);
  const file=new File([blob],name,{type:blob.type || "image/png"});
  if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({files:[file]})) { await navigator.share({files:[file]}); return; }
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),30_000);
}

export function RecipeDesigns() {
  const [settings,setSettings]=useState<DesignSettings>({...DEFAULT_DESIGN_SETTINGS,model:"gpt-image-2.6-sunburst",artworkSize:"selected",styleId:"vintage_farmhouse_recipe",researchEnabled:false,photoAnalysis:false,image:{...DEFAULT_DESIGN_SETTINGS.image}});
  const [ready,setReady]=useState(false);
  const [title,setTitle]=useState(""); const [noText,setNoText]=useState(false); const [notes,setNotes]=useState(""); const [ingredients,setIngredients]=useState(""); const [evidence,setEvidence]=useState("");
  const [photo,setPhoto]=useState<LocalPhoto | null>(null); const [refs,setRefs]=useState<LocalPhoto[]>([]); const [uploadingPhoto,setUploadingPhoto]=useState(false);
  const [cache,setCache]=useState<Research | null>(null); const [refresh,setRefresh]=useState(false);
  const [history,setHistory]=useState<Result[]>([]); const [jobs,setJobs]=useState<Job[]>([]); const [selected,setSelected]=useState<Result | null>(null);
  const [stage,setStage]=useState(""); const [error,setError]=useState(""); const [notice,setNotice]=useState("");
  const [showHistory,setShowHistory]=useState(false); const [preset,setPreset]=useState<Preset | null>(null);
  const [promptCopies,setPromptCopies]=useState<Record<string,RecipePromptCopy>>({}); const [editingPrompt,setEditingPrompt]=useState(false); const [promptDraft,setPromptDraft]=useState("");
  const [paidLock,setPaidLock]=useState<{id:string;createdAt:string} | null>(null);
  const [compare,setCompare]=useState(false); const [selectedSource,setSelectedSource]=useState<LocalPhoto | null>(null); const [zoom,setZoom]=useState(false);
  const [filterTarget,setFilterTarget]=useState<Result | null>(null);
  const [templateEdits,setTemplateEdits]=useState<TemplateEdits>({}); const [editPlacement,setEditPlacement]=useState<"top"|"bottom">("top");
  const busy=useRef(false); const photoUploading=useRef(false); const referenceVersion=useRef(0); const abort=useRef<AbortController | null>(null); const photoInput=useRef<HTMLInputElement>(null); const refInput=useRef<HTMLInputElement>(null);
  const zoomDialog=useRef<HTMLDialogElement>(null); const updates=useRef<BroadcastChannel | null>(null);

  useEffect(()=>{ let active=true; void (async()=>{
    try {
      const [saved,oldHistory,oldJobs,savedPreset,activeLock,savedCopies]=await Promise.all([loadLocal<DesignSettings>("settings","current"),listLocal<Result>("history"),listLocal<Job>("jobs"),loadLocal<Preset>("settings","saved-preset"),loadLocal<{id:string;createdAt:string}>("locks","active"),loadLocal<Record<string,unknown>>("settings","prompt-copies")]);
      if(!active)return;
      if(saved) { try {const valid=validateDesignSettings(saved);setSettings({...valid,artworkSize:"selected",image:{...valid.image,size:"1024x1536",output_format:"png"},styleId:valid.styleId==="auto"?"vintage_farmhouse_recipe":valid.styleId,mode:"auto",researchEnabled:false,photoAnalysis:false});} catch { /* ignore stale local settings */ } }
      const sorted=oldHistory.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); setHistory(current=>sorted.reduce(mergeHistory,current));
      if(savedCopies){const valid:Record<string,RecipePromptCopy>={};for(const style of RECIPE_STYLE_PRESETS){try{const copy=validateRecipePromptCopy(savedCopies[style.id],style.id);if(copy)valid[style.id]=copy;}catch{/* ignore invalid local copy */}}setPromptCopies(valid);}
      setJobs(current=>oldJobs.map(recoverJob).reduce(mergeJob,current)); setPreset(savedPreset || null);setPaidLock(activeLock || null);
    } catch { if(active)setError("Workspace storage is unavailable. Check the connection and retry."); }
    finally {if(active)setReady(true);}
  })(); return ()=>{active=false;}; },[]);
  useEffect(()=>{
    let active=true; let channel:BroadcastChannel | null=null;
    try {
      if(typeof BroadcastChannel!=="undefined") {
        channel=new BroadcastChannel("horse-studio-recipe-design-updates"); updates.current=channel;
        channel.onmessage=event=>{
          const message=event.data as {kind?:string;id?:string};
          if(typeof message?.id!=="string")return;
          if(message.kind==="job") void loadLocal<Job>("jobs",message.id).then(job=>{if(active && job)setJobs(current=>mergeJob(current,recoverJob(job)));}).catch(()=>{});
          if(message.kind==="history") void loadLocal<Result>("history",message.id).then(result=>{if(active && result)setHistory(current=>mergeHistory(current,result));}).catch(()=>{});
        };
      }
    } catch { /* Focus refresh below is the fallback when channels are unavailable. */ }
    const refresh=()=>{void Promise.all([listLocal<Job>("jobs"),listLocal<Result>("history")]).then(([savedJobs,savedHistory])=>{
      if(!active)return;
      setJobs(current=>savedJobs.map(recoverJob).reduce(mergeJob,current));
      setHistory(current=>savedHistory.reduce(mergeHistory,current));
    }).catch(()=>{});};
    window.addEventListener("focus",refresh);
    return ()=>{active=false;window.removeEventListener("focus",refresh);if(updates.current===channel)updates.current=null;channel?.close();};
  },[]);
  useEffect(()=>{ if(ready) void saveLocal("settings","current",settings).catch(()=>setError("Could not save settings in your workspace.")); },[settings,ready]);
  useEffect(()=>{ let active=true; setCache(null); setRefresh(false);
    if(settings.researchEnabled || settings.styleId==="auto") void loadLocal<Research>("research",researchKey(title,settings.styleId)).then(v=>{if(active)setCache(validateResearch(v));}).catch(()=>{});
    return ()=>{active=false;};
  },[title,settings.styleId,settings.researchEnabled]);
  useEffect(()=>{ if(zoom) zoomDialog.current?.showModal(); else zoomDialog.current?.close(); },[zoom]);
  useEffect(()=>{ let active=true; setCompare(false);setSelectedSource(null); if(selected) void loadLocal<LocalPhoto>("assets",selected.sourceId).then(v=>{if(active)setSelectedSource(v || null);}).catch(()=>{}); return ()=>{active=false;}; },[selected]);
  useEffect(()=>{if(selected){setTemplateEdits(selected.plan.template || {});setEditPlacement(recipeDesignLayout(selected.plan.family,selected.plan.titlePlacement).placement);}},[selected]);

  const isBusy=!!stage || uploadingPhoto;
  const imageEstimate=estimateOpenAIImageOutput(settings.model,recipeArtworkSize(settings),settings.image.quality);
  const previewStyleId=selectRecipeStyle(settings.styleId,title,history.map(h=>h.plan.styleId || ""));
  const previewStyle=getRecipeStyle(previewStyleId)!;
  const activeCopy=promptCopies[previewStyleId];
  const currentCost=jobs.flatMap(j=>j.costs).reduce((sum,c)=>sum+(Number.isFinite(c.cost)?c.cost:0),0);
  const unknownCount=jobs.filter(j=>j.status==="unknown" || j.costs.some(c=>c.costIncomplete)).length;
  const pendingCount=jobs.filter(j=>j.status==="working").length;
  function announce(kind: "job" | "history", id: string) {try{updates.current?.postMessage({kind,id});}catch{/* Changes remain in local storage. */}}
  function update<K extends keyof DesignSettings>(key: K,value: DesignSettings[K]) {setSettings(s=>({...s,[key]:value}));}
  async function savePromptCopy(){try{const copy=validateRecipePromptCopy({baseStyleId:previewStyleId,version:(activeCopy?.version || 1)+1,template:promptDraft},previewStyleId)!;const next={...promptCopies,[previewStyleId]:copy};await saveLocal("settings","prompt-copies",next);setPromptCopies(next);setEditingPrompt(false);setNotice(`Saved ${previewStyle.name} prompt version ${copy.version}.`);}catch(e){setError(e instanceof Error?e.message:"Could not save prompt copy.");}}
  async function restoreCanonicalPrompt(){try{const next={...promptCopies};delete next[previewStyleId];await saveLocal("settings","prompt-copies",next);setPromptCopies(next);setEditingPrompt(false);setNotice(`Restored the complete built-in ${previewStyle.name} prompt.`);}catch{setError("Could not restore the built-in prompt.");}}
  function changeMode(mode: DesignMode) {setSettings(s=>({...s,mode,researchEnabled:mode!=="reference"}));}
  function changeModel(model: string) {
    const qualityChanged=!imageQualitiesFor(model).includes(settings.image.quality);
    const complexityChanged=!supportsImageComplexity(model) && !!settings.image.complexity && settings.image.complexity!=="default";
    if(qualityChanged || complexityChanged) setNotice(`${model} does not support the previous ${[qualityChanged?"quality":"",complexityChanged?"complexity":""].filter(Boolean).join(" and ")} selection. ${qualityChanged?"Quality changed to High. ":""}${complexityChanged?"Complexity changed to Default.":""}`);
    setSettings(s=>({...s,model,artworkSize:model==="gpt-image-2.5-sunburst"?s.artworkSize:"selected",image:{...s.image,quality:imageQualitiesFor(model).includes(s.image.quality)?s.image.quality:"medium",complexity:supportsImageComplexity(model)?s.image.complexity:"default"}}));
  }
  function clearRecipeInputs() {
    referenceVersion.current++;setTitle("");setIngredients("");setNotes("");setEvidence("");setRefs([]);setNoText(false);setSelected(null);setNotice("");
  }
  async function uploadPhoto(file?: File) {
    if(!file || isBusy || photoUploading.current)return;
    photoUploading.current=true;setUploadingPhoto(true);setError("");
    try {
      const prepared=await prepareLocalPhoto(file);await saveLocal("assets",prepared.id,prepared);
      if(photo)clearRecipeInputs();
      else {setSelected(null);setNotice("");}
      setPhoto(prepared);
    } catch(e){setError(e instanceof Error?e.message:"Could not read photo.");}
    finally {photoUploading.current=false;setUploadingPhoto(false);}
  }
  function removePhoto() {
    if(isBusy || photoUploading.current)return;
    setPhoto(null);clearRecipeInputs();setError("");
  }
  async function uploadReferences(files: File[]) {
    if(isBusy || !files.length)return; setError("");
    if(refs.length+files.length>3){setError("Use up to three style references.");return;}
    const version=referenceVersion.current;
    try { const prepared: LocalPhoto[]=[]; for(const file of files){const p=await prepareLocalPhoto(file); await saveLocal("assets",p.id,p); prepared.push(p);} if(version===referenceVersion.current)setRefs(old=>[...old,...prepared]); }
    catch(e){if(version===referenceVersion.current)setError(e instanceof Error?e.message:"Could not read reference.");}
  }
  async function removeReference(id: string) {
    try { await removeLocal("assets",id); setRefs(r=>r.filter(x=>x.id!==id)); }
    catch { setError("Could not remove that reference from your workspace."); }
  }
  function check() {
    if(photoUploading.current)throw new Error("Wait for the food photo to finish uploading.");
    if(!photo)throw new Error("Upload the original food photograph first.");
    validateTitle(title,noText); validateDesignSettings(settings);
    if(noText)throw new Error("Enter the exact recipe title for this design.");
    if(notes.length>1000)throw new Error("Notes must be at most 1000 characters.");
    if(previewStyleId===INGREDIENT_CARD_STYLE_ID)validateRecipeIngredients(ingredients);
  }
  async function record(result: Result) { setStage("Preparing image…"); const prepared = await prepareClientImage(result.image, ["png", "webp"], result.artwork || (result.sourceId === photo?.id ? photo.blob : undefined)); result = {...result, image: prepared.blob}; const saved={...result,designSignature:result.qa.designSignature};setSelected(saved); await saveLocal("history",saved.id,saved); setHistory(h=>mergeHistory(h,saved));announce("history",saved.id);}
  async function saveFilteredCopy(filtered: FilteredImage) {
    if (!filterTarget) throw new Error("The source design is no longer available.");
    const { blob, ...settings } = filtered;
    const outputSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))).map(value => value.toString(16).padStart(2, "0")).join("");
    const qa: DesignQA = { ...filterTarget.qa, outputSha256, pixelDifferences: -1,
      transformations: [...filterTarget.qa.transformations, `Filtered copy: ${settings.preset}`],
      visual: filterTarget.qa.visual ? { ...filterTarget.qa.visual, notes: [...filterTarget.qa.visual.notes, "Filtered copy: original photo pixels are not verified."] } : undefined };
    const saved: Result = { ...filterTarget, id: crypto.randomUUID(), createdAt: new Date().toISOString(), image: blob,
      artwork: null, qa, status: `Filtered copy · ${settings.preset}`, filter: { ...settings, parentId: filterTarget.id }, costs: [] };
    await saveLocal("history", saved.id, saved);
    setHistory(history => mergeHistory(history,saved)); announce("history",saved.id);
  }
  async function templatePreview() {
    try {check(); setError(""); setStage("Preparing local template preview…");
      const style=getRecipeStyle(selectRecipeStyle(settings.styleId,title,history.slice(0,3).map(h=>h.plan.styleId || "")))!;
      const plan={...templatePlan,family:style.family,styleId:style.id,stylePromptVersion:promptCopies[style.id]?.version || style.version};
      const rendered=await renderProtectedDesign({source:photo!,artwork:null,plan,title,noText,priority:settings.priority});
      const result:Result={id:crypto.randomUUID(),sourceId:photo!.id,title,noText,createdAt:new Date().toISOString(),plan,research:null,researchStatus:"Research Off",artwork:null,image:rendered.blob,qa:rendered.qa,status:"Local style preview · no AI artwork or research",costs:[],promptSnapshot:renderRecipeStylePrompt(style.id,title,noText,notes,promptCopies[style.id])};
      await record(result);setNotice("Local template preview created. No OpenAI request was sent.");
    }catch(e){setError(e instanceof Error?e.message:"Preview failed.");}finally{setStage("");}
  }
  async function runGeneration() {
    if(busy.current)return; busy.current=true; setError("");setNotice("");
    try {
      const controller=new AbortController();abort.current=controller;
      const job:Job={id:crypto.randomUUID(),stage:"preparing",createdAt:new Date().toISOString(),status:"working",costs:[]};
      let sent=false;
      const checkpoint=async(stageName:string)=>{job.stage=stageName;job.updatedAt=new Date().toISOString();job.revision=(job.revision || 0)+1;const snapshot={...job,costs:[...job.costs]};await saveLocal("jobs",job.id,snapshot);setJobs(j=>mergeJob(j,snapshot));announce("job",job.id);};
      try {
        check();
        setStage("Preparing your food photo for OpenAI…");await checkpoint("preparing");
        const source=photo!;
        const sourceImage=await recipeEditImage(source);
        const refImages=await Promise.all(refs.map(ref=>recipeEditImage(ref,true)));
        const promptCopy=promptCopies[previewStyleId];
        const ingredientText=previewStyleId===INGREDIENT_CARD_STYLE_ID?validateRecipeIngredients(ingredients):undefined;
        const promptSnapshot=recipeDirectPrompt(previewStyleId,title,notes,promptCopy,ingredientText,settings.image.size);
        for(let i=0;i<settings.count;i++) {
          await checkpoint(`image edit ${i+1} dispatched`);setStage(`OpenAI is designing image ${i+1} of ${settings.count}…`);sent=true;
          const art=await post("/api/recipe-designs/generate",{approved:true,settings,title,ingredients:ingredientText,notes,promptCopy,photo:sourceImage,references:refImages},controller.signal);
          job.costs.push(art);sent=false;await checkpoint(`artwork ${i+1} complete`);
          const artwork=await (await fetch(art.image)).blob();
          const dimensions = recipeDesignDimensions(settings.image.size);
          setStage(`Preparing ${dimensions.width} × ${dimensions.height} image ${i+1} of ${settings.count}…`);
          const image=await recipeDesignPng(art.image, settings.image.size);
          const plan:DesignPlan={...templatePlan,family:previewStyle.family,styleId:previewStyleId,stylePromptVersion:promptCopy?.version || previewStyle.version};
          const originalSha256=source.sha256;
          const outputSha256=await crypto.subtle.digest("SHA-256",await image.arrayBuffer()).then(bytes=>Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,"0")).join(""));
          const qa:DesignQA={originalSha256,workingSha256:originalSha256,outputSha256,photoRect:{x:0,y:0,width:0,height:0},pixelDifferences:-1,title,transformations:["Uploaded food photo sent to OpenAI image edits",`Final image fitted to ${dimensions.width} × ${dimensions.height} PNG master`],visual:{reviewRequired:true,font:"OpenAI image model",titleSize:null,artworkTexture:"none",notes:["Direct AI image edits cannot guarantee pixel-for-pixel preservation. Compare the result with the original before publishing."]}};
          await record({downloadFormat:settings.image.size === "1536x864" ? "webp" : "png",outputWidth:dimensions.width,outputHeight:dimensions.height,id:crypto.randomUUID(),sourceId:source.id,title,ingredients:ingredientText,noText:false,createdAt:new Date().toISOString(),plan,research:null,researchStatus:"Direct OpenAI image edit",artwork,image,qa,status:"OpenAI image edit",costs:[...job.costs],imageModel:settings.model,artworkSize:recipeArtworkSize(settings),promptSnapshot});
        }
        job.status="complete"; await checkpoint("complete");setNotice(previewStyleId===INGREDIENT_CARD_STYLE_ID?"OpenAI design complete. Check the title, ingredients and amounts against your input before publishing.":"OpenAI design complete. Compare it with your original photo before publishing.");
      } catch(e) {
        const providerError=e instanceof DesignRequestError ? e : null;
        if(providerError?.usage) job.costs.push(providerError.usage);
        const unknown=sent && (!providerError || providerError.outcome==="unknown");
        job.status=unknown?"unknown":"failed"; job.stage=unknown?"provider outcome unknown":"failed";
        await checkpoint(job.stage).catch(()=>{const snapshot={...job,costs:[...job.costs]};setJobs(j=>mergeJob(j,snapshot));});
        const message=e instanceof Error?e.message:"Design generation failed.";
        setError(message+(unknown && !/unknown/i.test(message)?" Provider usage may be unknown; check OpenAI usage before trying again.":""));
      } finally {
        abort.current=null;setStage("");
      }
    } catch(e) {setError(e instanceof Error?e.message:"Could not start job.");} finally {busy.current=false;}
  }
  async function redoLayout() {
    if(!selected)return;setError("");setStage("Reusing saved artwork locally…");
    try {
      validateTitle(title,noText);
      const source=await loadLocal<LocalPhoto>("assets",selected.sourceId);if(!source)throw new Error("The original photo is no longer available in your workspace.");
      const idx=CURATED_DESIGN_FAMILIES.indexOf(selected.plan.family);
      const family=selected.plan.styleId ? selected.plan.family : settings.direction==="auto"?CURATED_DESIGN_FAMILIES[(Math.max(0,idx)+1)%CURATED_DESIGN_FAMILIES.length]:settings.direction;
      const plan={...selected.plan,family,...(family!==selected.plan.family?{titlePlacement:undefined,typographyPair:undefined,template:undefined}:{})};const rendered=await renderProtectedDesign({source,artwork:selected.artwork,plan,title,noText,priority:settings.priority});
      await record({...selected,id:crypto.randomUUID(),title,noText,createdAt:new Date().toISOString(),plan,image:rendered.blob,qa:rendered.qa,status:selected.artwork?"Cached Artwork · local layout":"Template Preview · local layout",costs:[]});
      setNotice("Layout redone locally using the saved artwork. No OpenAI request was sent.");
    }catch(e){setError(e instanceof Error?e.message:"Could not redo layout.");}finally{setStage("");}
  }
  async function applyTemplateEdit(){
    if(!selected)return;setError("");setStage("Applying template changes locally…");
    try {const source=await loadLocal<LocalPhoto>("assets",selected.sourceId);if(!source)throw new Error("The original photo is no longer available in your workspace.");
      const plan:DesignPlan={...selected.plan,titlePlacement:editPlacement,template:validateTemplateEdits(templateEdits)};
      const rendered=await renderProtectedDesign({source,artwork:selected.artwork,plan,title:selected.title,noText:selected.noText,priority:settings.priority});
      await record({...selected,id:crypto.randomUUID(),createdAt:new Date().toISOString(),plan,image:rendered.blob,qa:rendered.qa,status:selected.artwork?"Cached Artwork · local template edit":"Template Preview · local template edit",costs:[]});
      setNotice("Template updated locally. No OpenAI request was sent.");
    }catch(e){setError(e instanceof Error?e.message:"Could not update the template.");}finally{setStage("");}
  }
  async function saveStyle(){const item:Preset={name:"Original Photo / Vintage Food Blog",version:(preset?.version || 0)+1,savedAt:new Date().toISOString(),settings};try{await saveLocal("settings","saved-preset",item);setPreset(item);setNotice(`Style version ${item.version} and model settings saved in your workspace.`);}catch{setError("Could not save style in your workspace.");}}
  async function clearPaidLock(){if(!paidLock || isBusy)return;try{await releasePaidJob(paidLock.id);setPaidLock(null);setNotice("Old reservation notice cleared. This does not cancel a request; check OpenAI billing for its final charge.");}catch{setError("Could not clear the old reservation notice.");}}
  async function ingredientCard(){try{validateTitle(title,noText);if(noText)throw new Error("Turn off NO TEXT to create an ingredients card.");const card=await renderIngredientsCard(title,ingredients);await download(card,"recipe-ingredients-card-1200x1500.png");setNotice("PNG ingredients card created locally with the text you supplied. No OpenAI request was sent.");}catch(e){setError(e instanceof Error?e.message:"Could not create the ingredients card.");}}

  return <div aria-label="Recipe Designs studio" className="space-y-4">
    <section className="studio-panel rounded-[28px] p-5 sm:p-6">
      <div className="mb-6"><h1 className="studio-title text-3xl">Recipe Designs</h1></div>
      {error && <div role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-950/30 p-4 text-sm text-red-700">{error}</div>}
      {notice && <p role="status" className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-950/20 p-3 text-sm text-green-700">{notice}</p>}
      {paidLock && !isBusy && <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-950/20 p-4 text-sm text-amber-700"><p>An earlier design request may still be running or its charge may be unknown. You can start another design; check OpenAI billing before repeating the earlier request.</p><button type="button" className={buttonClass+" mt-3"} onClick={()=>void clearPaidLock()}>Dismiss old reservation notice</button></div>}
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.75fr)]">
        <div className="space-y-5">
          <div className="grid gap-2"><label htmlFor="recipe-design-title" className="text-sm text-gray-900">Recipe title</label><input id="recipe-design-title" className={inputClass} value={title} maxLength={180} disabled={isBusy} onChange={e=>setTitle(e.target.value)} placeholder="Your exact recipe title"/></div>
          <div><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-medium">Original Food Photograph <span className="text-blue-700">· required</span></h2>{photo && <div className="flex gap-3"><button type="button" className="text-xs underline" disabled={isBusy} onClick={()=>photoInput.current?.click()}>Replace</button><button type="button" className="text-xs underline" disabled={isBusy} onClick={removePhoto}>Remove</button></div>}</div>
            <div role="button" tabIndex={isBusy?-1:0} aria-disabled={isBusy} aria-label="Drop an original food photo here or browse files" onKeyDown={e=>{if(!isBusy && (e.key==="Enter" || e.key===" ")){e.preventDefault();photoInput.current?.click();}}} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect=isBusy?"none":"copy";}} onDrop={e=>{e.preventDefault();void uploadPhoto(e.dataTransfer.files[0]);}} onClick={()=>{if(!isBusy)photoInput.current?.click();}} className="flex min-h-64 w-full cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed border-gray-200 bg-white/60 p-4 text-center text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f3e5d4]">{photo?<ImageBlob blob={photo.blob} alt="Original food photograph preview" className="max-h-72 w-full object-contain"/>:<><span className="text-lg font-medium">Drag your food photo here</span><span className="text-xs text-gray-600">JPG, PNG, static WebP · up to 25 MB</span></>}<button type="button" className={buttonClass} disabled={isBusy} onClick={e=>{e.stopPropagation();photoInput.current?.click();}}>Browse Files</button></div>
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Original Food Photograph" disabled={isBusy} onChange={e=>{const f=e.target.files?.[0];e.target.value="";void uploadPhoto(f);}}/>
            {photo && <p className="mt-2 break-all text-xs text-gray-600">{photo.name} · {photo.width}×{photo.height} · SHA-256 {photo.sha256.slice(0,16)}…</p>}
            {photo && <p className="mt-1 text-xs text-gray-600">Changing or removing this photo clears the title, ingredients, and optional reference inputs.</p>}
            {uploadingPhoto && <p role="status" className="mt-2 text-xs text-blue-700">Preparing photo…</p>}
          </div>
          <div className="space-y-2">
            <OpenAIImageControls recipePresets model={settings.model} value={settings.image} onChange={image=>setSettings(s=>({...s,image,artworkSize:"selected"}))} disabled={isBusy} quickSettingsOnly/>
            <p className="text-xs text-gray-600">These settings control the OpenAI request. Pinterest and Facebook download as PNG. WordPress uses high-quality WebP at 1536 × 864.</p>
          </div>
          <div className="grid gap-2"><label htmlFor="recipe-design-style" className="text-sm font-medium text-gray-900">Professional design style</label><select id="recipe-design-style" className={inputClass} value={settings.styleId} disabled={isBusy} onChange={e=>{update("styleId",e.target.value as DesignSettings["styleId"]);setError("");}}>{RECIPE_STYLE_PRESETS.map(style=><option key={style.id} value={style.id}>{style.name}</option>)}</select></div>
          {previewStyleId===INGREDIENT_CARD_STYLE_ID && <div className="grid gap-2"><label htmlFor="recipe-design-ingredients" className="text-sm font-medium text-gray-900">Ingredients <span className="text-blue-700">· required</span></label><textarea id="recipe-design-ingredients" className={inputClass} rows={7} maxLength={2000} disabled={isBusy} value={ingredients} onChange={e=>setIngredients(e.target.value)} placeholder={'Chicken breast (1 lb)\nBroccoli (2 cups)\nGarlic (3 cloves)'}/><p className="text-xs leading-relaxed text-gray-600">Enter one ingredient per line, including its amount. Up to 20 lines. Check the finished image for spelling and quantities.</p></div>}
          <button type="button" className={accentClass+" w-full"} disabled={!ready || isBusy} onClick={()=>{try{check();void runGeneration();}catch(e){setError(e instanceof Error?e.message:"Check your inputs.");}}}>Generate Design</button>
          <p className="text-xs leading-relaxed text-gray-600">Generate Design starts {settings.count} paid OpenAI image {settings.count===1?"edit":"edits"} without another confirmation. Image output estimate: {imageEstimate===null?"unavailable for these settings":`$${(imageEstimate*settings.count).toFixed(4)}`} · image input and prompt costs are additional.</p>
          {!!stage && <div role="status" aria-live="polite" className="rounded-xl border border-gray-200 p-3 text-sm">{stage} {abort.current && <><button type="button" className="ml-3 underline" onClick={()=>abort.current?.abort()}>Stop waiting</button><p className="mt-1 text-xs text-gray-600">Stopping cannot guarantee an already dispatched provider request is canceled or free.</p></>}</div>}
          <details className="rounded-xl border border-gray-200 p-4"><summary className="cursor-pointer text-sm font-medium">Optional style reference images</summary><div className="mt-4 space-y-4">
          <div onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void uploadReferences(Array.from(e.dataTransfer.files));}}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-medium">Style references</h2><button type="button" className={buttonClass} disabled={isBusy || refs.length>=3} onClick={()=>refInput.current?.click()}>Add reference</button></div><p className="mt-1 text-xs text-gray-600">Optional visual inspiration; these are sent after your food photo.</p>
            <input ref={refInput} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Design reference images" onChange={e=>{const files=Array.from(e.target.files || []);e.target.value="";void uploadReferences(files);}}/>
            {refs.length>0 && <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">{refs.map((ref,index)=><div key={ref.id} className="rounded-xl border border-gray-200 p-2"><ImageBlob blob={ref.blob} alt={`Style reference ${index+1}`} className="h-24 w-full rounded-lg object-contain"/><p className="mt-1 truncate text-xs">{index+1}. {ref.name}</p><div className="mt-2 flex flex-wrap gap-2 text-xs"><button disabled={isBusy || index===0} onClick={()=>setRefs(r=>{const next=[...r];[next[index-1],next[index]]=[next[index],next[index-1]];return next;})}>←</button><button disabled={isBusy || index===refs.length-1} onClick={()=>setRefs(r=>{const next=[...r];[next[index+1],next[index]]=[next[index],next[index+1]];return next;})}>→</button><button disabled={isBusy} onClick={()=>void removeReference(ref.id)}>Remove</button></div></div>)}</div>}
          </div>
          <label className="grid gap-2 text-sm text-gray-600">What do you like about these designs?<textarea className={inputClass} rows={3} maxLength={1000} disabled={isBusy} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional: colors, label shapes, typography, or layout"/></label>
          </div></details>
          <details className="rounded-xl border border-gray-200 p-4"><summary className="cursor-pointer text-sm font-medium">Advanced settings</summary><div className="mt-4 space-y-5">
          <div className="space-y-2"><p className="text-xs text-gray-600">Complete {previewStyle.name} prompt v{activeCopy?.version || previewStyle.version} goes directly to the image model.</p><details className="rounded-lg border border-gray-200 p-3 text-xs text-gray-600"><summary className="cursor-pointer">View the exact image prompt</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words">{recipeDirectPrompt(previewStyleId,title.trim() ? title : "{{TITLE}}",notes,activeCopy,ingredients,settings.image.size)}</pre></details></div>
          <div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-600"><p>Prompt version: {activeCopy?.version || previewStyle.version} · {activeCopy?"saved edited copy":"complete built-in preset"}</p>{editingPrompt?<><label className="mt-3 grid gap-2">Edit a copy of {previewStyle.name}<textarea className={inputClass} rows={12} maxLength={16000} value={promptDraft} onChange={e=>setPromptDraft(e.target.value)}/></label><div className="mt-3 flex gap-2"><button type="button" className={buttonClass} disabled={isBusy} onClick={()=>void savePromptCopy()}>Save prompt version</button><button type="button" className={buttonClass} onClick={()=>setEditingPrompt(false)}>Cancel</button></div></>:<div className="mt-3 flex gap-2"><button type="button" className={buttonClass} disabled={isBusy} onClick={()=>{if(settings.styleId==="auto")update("styleId",previewStyleId);setPromptDraft(activeCopy?.template || previewStyle.template);setEditingPrompt(true);}}>Duplicate and edit prompt</button>{activeCopy && <button type="button" className={buttonClass} disabled={isBusy} onClick={()=>void restoreCanonicalPrompt()}>Restore built-in</button>}</div>}</div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]"><label className="grid gap-2 text-sm text-gray-600">OpenAI image model<select className={inputClass} value={settings.model} disabled={isBusy} onChange={e=>changeModel(e.target.value)}>{OPENAI_IMAGE_MODEL_IDS.map(m=><option key={m} value={m}>{m}</option>)}</select></label><label className="grid gap-2 text-sm text-gray-600">Designs<input className={inputClass} type="number" min="1" max="3" value={settings.count} disabled={isBusy} onChange={e=>update("count",Number(e.target.value))}/></label></div>
          {settings.model==="gpt-image-2.5-sunburst" && <label className="grid gap-2 text-sm text-gray-600">Artwork request size<select className={inputClass} value={settings.artworkSize} disabled={isBusy} onChange={e=>update("artworkSize",e.target.value as DesignSettings["artworkSize"])}><option value="1280x1600">1280 × 1600 · 4:5 artwork</option><option value="selected">Use selected image size below</option></select></label>}
          <OpenAIImageControls recipePresets model={settings.model} value={settings.image} onChange={image=>setSettings(s=>({...s,image,artworkSize:"selected"}))} disabled={isBusy} hidePartialImages hideQuickSettings countDescription="WordPress exports at 1536 × 864. Other recipe designs retain the 1200 × 1500 layout. Pinterest and Facebook download as PNG; WordPress uses high-quality WebP."/>
          <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={isBusy} onClick={()=>void saveStyle()}>Save settings</button>{preset && <button type="button" className={buttonClass} disabled={isBusy} onClick={()=>{try{const valid=validateDesignSettings(preset.settings);setSettings({...valid,styleId:valid.styleId==="auto"?"vintage_farmhouse_recipe":valid.styleId,mode:"auto",researchEnabled:false,photoAnalysis:false});setNotice(`Restored ${preset.name}.`);}catch{setError("Saved settings are no longer compatible.");}}}>Load saved settings</button>}</div>
          </div></details>
        </div>
        <aside className="rounded-[22px] border border-gray-200 bg-white/60 p-4"><div className="flex items-center justify-between gap-2"><div><p className="text-xs uppercase tracking-[.18em] text-blue-700">Output preview</p><h2 className="studio-title mt-1 text-xl">{selected ? selected.outputWidth ?? 1200 : recipeDesignDimensions(settings.image.size).width} × {selected ? selected.outputHeight ?? 1500 : recipeDesignDimensions(settings.image.size).height} · {selected ? recipeResultFormat(selected).toUpperCase() : settings.image.size === "1536x864" ? "WEBP" : "PNG"} download</h2></div><button type="button" className={buttonClass} onClick={()=>setShowHistory(v=>!v)}>Design History ({history.length})</button></div>
          <div style={{aspectRatio:`${selected ? selected.outputWidth ?? 1200 : recipeDesignDimensions(settings.image.size).width} / ${selected ? selected.outputHeight ?? 1500 : recipeDesignDimensions(settings.image.size).height}`}} className="mt-4 flex items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white">{selected?<ImageBlob blob={compare && selectedSource?selectedSource.blob:selected.image} alt={compare?"Original food photograph":"Recipe design preview"} className="h-full w-full object-contain"/>:<p className="px-6 text-center text-sm text-gray-600">Your OpenAI design will appear here.</p>}</div>
          {selected?.ingredients && <details className="mt-3 rounded-xl border border-gray-200 p-3 text-xs text-blue-700"><summary className="cursor-pointer font-medium">Check the supplied ingredients</summary><p className="mt-2">Compare the generated words and amounts with this list before sharing.</p><pre className="mt-2 whitespace-pre-wrap break-words text-gray-900">{selected.ingredients}</pre></details>}
          {selected && <><p className="mt-3 text-sm font-medium text-blue-700">{selected.status}</p><p className="mt-1 text-xs text-gray-600">{selected.plan.styleId ? getRecipeStyle(selected.plan.styleId)?.name : labels[selected.plan.family]} · {selected.researchStatus}</p>{selected.filter?<p className="mt-2 text-xs text-blue-700">Filtered copy: the food photo pixels are not verified. The original design remains in history.</p>:selected.status==="OpenAI image edit"?<p className="mt-2 text-xs text-blue-700">The image model edits the food photo directly. Compare it with the original before publishing; exact photo pixels cannot be verified in an AI edit.</p>:<p className="mt-2 text-xs text-green-700">Protected photo: {selected.qa.pixelDifferences===0?"verified · zero pixel differences vs resized original":"failed"} · Visual quality: review required</p>}{selected.plan.paletteSource==="fallback" && <p className="mt-2 text-xs text-blue-700">Some colors were missing or invalid, so a compatible palette was completed locally.</p>}<div className="mt-4 flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={()=>void download(selected.image,`recipe-design-${selected.outputWidth ?? 1200}x${selected.outputHeight ?? 1500}.${recipeResultFormat(selected)}`,recipeResultFormat(selected)).catch(e=>setError(String(e)))}>{recipeResultFormat(selected) === "webp" ? "Download optimized WebP" : "Download PNG"}</button><button type="button" className={buttonClass} onClick={()=>setFilterTarget(selected)}>Add Filter</button>{selected.status==="OpenAI image edit" && selected.artwork && <button type="button" className={buttonClass} onClick={()=>void download(selected.artwork!,`recipe-design-openai-original.${selected.artwork!.type==="image/jpeg"?"jpg":selected.artwork!.type==="image/webp"?"webp":"png"}`).catch(e=>setError(String(e)))}>Download verified artwork</button>}{selected.status!=="OpenAI image edit" && !selected.filter && <button type="button" className={buttonClass} disabled={isBusy} onClick={()=>void redoLayout()}>Redo Design · free</button>}<button type="button" className={buttonClass} disabled={!selectedSource} onClick={()=>setCompare(v=>!v)}>{compare?"Show design":"Compare original"}</button><button type="button" className={buttonClass} onClick={()=>setZoom(true)}>Zoom</button></div>
            {selected.status!=="OpenAI image edit" && !selected.filter && <details className="mt-4 rounded-xl border border-gray-200 p-3 text-sm"><summary className="cursor-pointer font-medium">Advanced Edit · free</summary>
              <p className="mt-2 text-xs leading-relaxed text-gray-600">Adjust this template locally. Your original photograph stays protected, and no OpenAI request is sent.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-gray-600">Title font<select className={`${inputClass} mt-1`} value={templateEdits.font || ""} onChange={e=>setTemplateEdits(v=>({...v,font:(e.target.value || undefined) as TemplateEdits["font"]}))}><option value="">Template default</option><option value="heritage_slab">Heritage slab</option><option value="notebook_serif">Vintage typewriter</option><option value="diner_slab">Diner condensed</option><option value="editorial_serif">Editorial serif</option></select></label>
                <label className="text-xs text-gray-600">Title placement<select className={`${inputClass} mt-1`} value={editPlacement} onChange={e=>setEditPlacement(e.target.value as "top"|"bottom")}><option value="top">Above photo</option><option value="bottom">Below photo</option></select></label>
                <label className="text-xs text-gray-600">Title alignment<select className={`${inputClass} mt-1`} value={templateEdits.alignment || ""} onChange={e=>setTemplateEdits(v=>({...v,alignment:(e.target.value || undefined) as TemplateEdits["alignment"]}))}><option value="">Template default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
                <label className="text-xs text-gray-600">Title size · {Math.round((templateEdits.titleScale || 1)*100)}%<input className="mt-3 w-full" type="range" min="0.7" max="1.3" step="0.05" value={templateEdits.titleScale || 1} onChange={e=>setTemplateEdits(v=>({...v,titleScale:Number(e.target.value)}))}/></label>
                {([ ["background","Background"], ["panel","Title panel"], ["accent","Accent"], ["ink","Title color"] ] as const).map(([key,label])=><label key={key} className="flex items-center justify-between gap-2 text-xs text-gray-600">{label}<input aria-label={label} className="h-9 w-14 cursor-pointer rounded border border-gray-200 bg-transparent" type="color" value={templateEdits[key] || TEMPLATE_COLORS[selected.plan.family][key]} onChange={e=>setTemplateEdits(v=>({...v,[key]:e.target.value}))}/></label>)}
              </div><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={isBusy} onClick={()=>void applyTemplateEdit()}>Apply changes · free</button><button type="button" className={buttonClass} disabled={isBusy} onClick={()=>{setTemplateEdits({});setEditPlacement(recipeDesignLayout(selected.plan.family).placement);}}>Reset controls</button></div>
            </details>}
            <VisualInspiration result={selected}/>
            <details className="mt-4 text-xs leading-relaxed text-gray-600"><summary className="cursor-pointer">Design and photo verification</summary><p className="mt-2">Exact title: {selected.noText?"NO TEXT":selected.qa.title}</p><p className="mt-1 break-all">Original SHA-256: {selected.qa.originalSha256}</p>{selected.qa.visual && <><p className="mt-1">Typeface: {selected.qa.visual.font} · artwork texture: {selected.qa.visual.artworkTexture}</p>{selected.qa.visual.notes.map(note=><p className="mt-1" key={note}>{note}</p>)}</>}{selected.artwork && <p className="mt-2">Review artwork for stray text and unwanted details before publishing; it is not automatically checked with OCR.</p>}{selected.evidence && <p className="mt-2">User-reported performance (unverified): {selected.evidence}</p>}</details>
          </>}
          {showHistory && <div className="mt-5 border-t border-gray-200 pt-4"><h3 className="text-sm font-medium">Saved on this device</h3>{history.length===0?<p className="mt-2 text-xs text-gray-600">No designs yet.</p>:<div className="mt-2 space-y-2">{history.map(h=><button key={h.id} type="button" onClick={()=>setSelected(h)} className="block w-full rounded-lg border border-gray-200 p-2 text-left text-xs"><span className="block truncate">{h.noText?"NO TEXT":h.title}</span><span className="text-gray-600">{h.status} · {new Date(h.createdAt).toLocaleString()}</span></button>)}</div>}</div>}
          <details className="mt-5 border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-600"><summary className="cursor-pointer">Usage and storage</summary><p className="mt-2">Workspace usage ledger: ${currentCost.toFixed(5)} reported/estimated · {pendingCount} reserved/in progress · {unknownCount} with incomplete or unknown cost.</p><p className="mt-1">This is not a shared monthly cap. Check OpenAI billing for authoritative totals.</p><p className="mt-2">Originals and designs are retained in your workspace for history.</p></details>
        </aside>
      </div>
    </section>
    {filterTarget && <ImageFilterStudio webOptimized={recipeResultFormat(filterTarget) === "webp"} source={filterTarget.image} fileName={`recipe-design-${filterTarget.outputWidth ?? 1200}x${filterTarget.outputHeight ?? 1500}`} onClose={()=>setFilterTarget(null)} onSave={saveFilteredCopy} />}
    <dialog ref={zoomDialog} aria-label="Zoomed recipe design" onCancel={()=>setZoom(false)} className="max-h-[96vh] w-[min(95vw,1000px)] rounded-2xl border border-gray-200 bg-white p-4 text-gray-900 backdrop:bg-black/80"><div className="mb-2 flex justify-end"><button className={buttonClass} onClick={()=>setZoom(false)}>Close zoom</button></div>{selected && <ImageBlob blob={compare && selectedSource?selectedSource.blob:selected.image} alt={compare?"Original food photograph enlarged":"Recipe design enlarged"} className="max-h-[80vh] w-full object-contain"/>}</dialog>
  </div>;
}
