"use client";
/* eslint-disable @next/next/no-img-element -- previews and generated data URLs are runtime images. */

import { useRef, useState } from "react";
import { compressRecipeWebp } from "@/lib/recipeWebp";
import { OpenAIImageControls } from "./OpenAIImageControls";
import { ImageFilterStudio } from "./ImageFilterStudio";
import { OPENAI_IMAGE_MODEL_IDS, imageQualitiesFor, supportsImageComplexity, type OpenAIImageSettings } from "@/lib/openaiImageSettings";
import { readGenerationResponse } from "@/lib/generationResponse";
import { prepareFoodPhoto, type FoodPhoto } from "@/lib/recipeFoodPhoto";
import { MAX_EXTRA_INSTRUCTIONS, MAX_TWO_IN_ONE_PHOTO_LENGTH, RECIPE_IMAGE_TO_IMAGE_MODEL, RECIPE_IMAGE_TO_IMAGE_SETTINGS } from "@/lib/recipeImageToImageSettings";

type CombinedResult = { imageUrl: string; imageModel: string; imageSettings: OpenAIImageSettings; cost: number; imageCost: number | null; costIncomplete: boolean };

const inputClass = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:opacity-50";
const secondaryClass = "rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50";

function FoodPhotoSlot({ index, photo, disabled, onFiles, onRemove }: {
  index: number; photo: FoodPhoto | null; disabled: boolean;
  onFiles: (index: number, files: File[]) => void; onRemove: (index: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const label = `food photo ${index + 1}`;
  return <div className="min-w-0">
    <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-sm font-medium text-gray-900">Photo {index + 1}</h2>
      {photo && <button type="button" className="text-xs text-gray-600 underline underline-offset-4 disabled:opacity-50" disabled={disabled} onClick={() => onRemove(index)}>Remove</button>}
    </div>
    <div role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={`Drop ${label} here or click to browse`}
      onClick={() => { if (!disabled) input.current?.click(); }}
      onKeyDown={event => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); input.current?.click(); } }}
      onDragEnter={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) { depth.current++; setDragging(true); } }}
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
      onDragLeave={event => { event.preventDefault(); event.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false); if (!disabled) onFiles(index, Array.from(event.dataTransfer.files)); }}
      className={`flex min-h-[220px] items-center justify-center overflow-hidden rounded-2xl border border-dashed transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f3e5d4] ${dragging ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/40" : "border-gray-200 bg-white/60"} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      {photo ? <img src={photo.dataUrl} alt={`Original food photo ${index + 1}`} draggable={false} className="max-h-[300px] w-full object-contain" /> :
        <div className="px-4 py-8 text-center"><div aria-hidden="true" className="mb-3 text-3xl text-blue-700">＋</div><p className="text-sm text-gray-900">Drag photo {index + 1} here</p><p className="mt-2 text-xs text-gray-600">or click to browse</p></div>}
    </div>
    <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label={`Upload ${label}`} className="sr-only" disabled={disabled}
      onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; if (files.length) onFiles(index, files); }} />
    <div className="mt-2 flex min-w-0 items-center gap-2"><button type="button" className={secondaryClass} disabled={disabled} aria-label={`Browse for ${label}`} onClick={() => input.current?.click()}>{photo ? "Change photo" : "Browse files"}</button>
      {photo && <p className="min-w-0 truncate text-xs text-gray-600" title={photo.name}>{photo.name}</p>}</div>
  </div>;
}

export function RecipeTwoInOne() {
  const [photos, setPhotos] = useState<[FoodPhoto | null, FoodPhoto | null]>([null, null]);
  const [extraInstructions, setExtraInstructions] = useState("");
  const [model, setModel] = useState<string>(RECIPE_IMAGE_TO_IMAGE_MODEL);
  const [settings, setSettings] = useState<OpenAIImageSettings>({ ...RECIPE_IMAGE_TO_IMAGE_SETTINGS });
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [partial, setPartial] = useState<string | null>(null);
  const [result, setResult] = useState<CombinedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [filterTarget, setFilterTarget] = useState<string | null>(null);
  const busy = useRef(false);
  const preparing = useRef(false);

  function changeModel(next: string) {
    setModel(next);
    setSettings(current => ({ ...current, quality: imageQualitiesFor(next).includes(current.quality) ? current.quality : "high", complexity: supportsImageComplexity(next) ? current.complexity : "default" }));
  }

  async function addPhotos(index: number, files: File[]) {
    if (busy.current || preparing.current) return;
    if (!files.length) { setError("Drop one or two JPG, PNG, or WebP image files from your computer."); return; }
    if (files.length > 2) { setError("Choose exactly two photos, or add one photo to each box."); return; }
    preparing.current = true;
    setUploading(true); setError(null);
    try {
      const prepared: FoodPhoto[] = [];
      for (const file of files) prepared.push(await prepareFoodPhoto(file, MAX_TWO_IN_ONE_PHOTO_LENGTH));
      const replacing = prepared.length === 2 ? photos.some(Boolean) : !!photos[index];
      if (replacing) setExtraInstructions("");
      setPhotos(current => {
        const next: [FoodPhoto | null, FoodPhoto | null] = [...current];
        if (prepared.length === 2) return [prepared[0], prepared[1]];
        next[index] = prepared[0]; return next;
      });
      setResult(null); setPartial(null);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not read the food photos."); }
    finally { preparing.current = false; setUploading(false); }
  }

  function removePhoto(index: number) {
    if (busy.current || preparing.current) return;
    setPhotos(current => { const next: [FoodPhoto | null, FoodPhoto | null] = [...current]; next[index] = null; return next; });
    setExtraInstructions(""); setResult(null); setPartial(null); setError(null);
  }

  async function generate() {
    if (busy.current || preparing.current) return;
    if (!photos[0] || !photos[1]) { setError("Upload both food photos first."); return; }
    busy.current = true; setLoading(true); setError(null); setResult(null); setPartial(null);
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ contentType: "recipes", recipeWorkflow: "twoInOne", references: [photos[0].dataUrl, photos[1].dataUrl], extraInstructions, imageModel: model, imageSettings: settings }) });
      const generated = await readGenerationResponse(response, setPartial);
      if (typeof generated.imageUrl !== "string" || !generated.imageUrl) throw new Error("No finished image was returned.");
      setResult(generated);
    } catch (error) { setError(error instanceof Error ? error.message : "Image generation failed. Please try again."); }
    finally { busy.current = false; setLoading(false); setPartial(null); }
  }

  async function download() {
    if (!result) return;
    setDownloading(true);
    try {
      const url = result.imageUrl.startsWith("data:") ? result.imageUrl : "/api/download?url=" + encodeURIComponent(result.imageUrl);
      const response = await fetch(url); if (!response.ok) throw new Error("Could not download the image.");
      const original = await response.blob();
      const blob = result.imageSettings.output_format === "webp" ? await compressRecipeWebp(original) : original;
      const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
      const file = new File([blob], `two-in-one-food.${extension}`, { type: blob.type });
      if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      const objectUrl = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = objectUrl; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setError(error instanceof Error ? error.message : "Download failed."); }
    finally { setDownloading(false); }
  }

  return <div aria-label="2 in one image workspace">
    <section className="studio-panel mb-4 rounded-[28px] p-5 sm:p-6">
      <div className="mb-6">
        <h1 className="studio-title text-3xl text-gray-900">2 in one image</h1>
      </div>
      {error && <div role="alert" className="mb-4 rounded-xl border border-red-400/25 bg-red-950/30 p-4 text-sm text-red-700">{error}</div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <div><p className="mb-3 text-sm font-medium text-gray-900">Original food photos · both required</p>
          <div className="grid gap-4 sm:grid-cols-2">{photos.map((photo, index) => <FoodPhotoSlot key={index} index={index} photo={photo} disabled={loading || uploading} onFiles={(slot, files) => void addPhotos(slot, files)} onRemove={removePhoto} />)}</div>
          <p className="mt-3 text-xs leading-relaxed text-gray-600">Drop one photo in each box, or select two together. JPG, PNG, or WebP · up to 25 MB each.</p>
          {photos.some(Boolean) && <p className="mt-1 text-xs text-gray-600">Changing or removing an existing photo clears the extra instructions and current result.</p>}
          {uploading && <p role="status" className="mt-2 text-xs text-blue-700">Preparing photos…</p>}
          <div className="mt-4"><OpenAIImageControls recipePresets model={model} value={settings} onChange={setSettings} disabled={loading} quickSettingsOnly /></div>
        </div>
        <div className="flex flex-col"><label className="grid gap-2 text-sm text-gray-600">Extra instructions <span className="sr-only">(optional)</span>
          <textarea className={inputClass + " min-h-[152px] resize-y"} rows={5} value={extraInstructions} maxLength={MAX_EXTRA_INSTRUCTIONS} disabled={loading || uploading} placeholder="Optional: describe how the foods should be arranged, or name any ingredients that must be visible." onChange={event => setExtraInstructions(event.target.value)} /></label>
          <label className="mt-5 grid gap-2 text-sm text-gray-600">Image model<select className={inputClass} value={model} disabled={loading} onChange={event => changeModel(event.target.value)}>{[RECIPE_IMAGE_TO_IMAGE_MODEL, ...OPENAI_IMAGE_MODEL_IDS.filter(id => id !== RECIPE_IMAGE_TO_IMAGE_MODEL)].map(id => <option key={id} value={id}>{id}</option>)}</select></label>
          <div className="mt-auto pt-6"><button type="button" onClick={() => void generate()} disabled={!photos[0] || !photos[1] || loading || uploading} className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{loading ? "Generating one image…" : "Generate one image"}</button>
            <p className="mt-3 text-xs leading-relaxed text-gray-600">One image request is billed by OpenAI; both photos are sent as references. Download the result before refreshing.</p></div>
        </div>
      </div>
    </section>
    <OpenAIImageControls recipePresets model={model} value={settings} onChange={setSettings} disabled={loading} hideQuickSettings countDescription="Both original food photos are used as references for one image. Partial images show progress before the finished image." />
    {loading && <p role="status" aria-live="polite" className="mb-4 text-sm text-gray-600">Creating one food photo from both references…</p>}
    {partial && <div className="studio-panel mb-4 rounded-2xl p-4"><p className="mb-3 text-sm text-gray-600">Preview · still generating</p><img src={partial} alt="Combined food photo in progress" className="max-h-[440px] w-full rounded-xl object-contain" /></div>}
    {result && <section aria-label="Combined food photo" className="studio-panel mt-6 overflow-hidden rounded-[24px] p-4"><h2 className="studio-title mb-4 text-2xl">Your combined image</h2>
      <img src={result.imageUrl} alt="Food photo combining both references" className="max-h-[600px] w-full rounded-xl bg-white object-contain" />
      <p className="mt-3 text-xs text-gray-600">{result.imageModel} · {result.imageCost === null ? "Cost unavailable from provider usage" : "$" + result.cost.toFixed(5) + (result.costIncomplete ? " · partial estimate" : " · recorded usage")}</p>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={secondaryClass} disabled={downloading} onClick={() => void download()}>{downloading ? "Downloading…" : (result.imageSettings.output_format === "webp" ? "Download optimized WebP" : "Download Original · " + result.imageSettings.output_format.toUpperCase())}</button>
      <button type="button" className={secondaryClass} onClick={() => setFilterTarget(result.imageUrl)}>Add Filter</button></div></section>}
    {filterTarget && <ImageFilterStudio webOptimized={result?.imageSettings.output_format === "webp"} source={filterTarget} fileName="two-in-one-food" onClose={() => setFilterTarget(null)} />}
  </div>;
}
