"use client";

import { useEffect, useRef, useState } from "react";
import { compressRecipeWebp } from "@/lib/recipeWebp";
import { OpenAIImageControls } from "./OpenAIImageControls";
import { ImageFilterStudio } from "./ImageFilterStudio";
import { OPENAI_IMAGE_MODEL_IDS, imageQualitiesFor, supportsImageComplexity, type OpenAIImageSettings } from "@/lib/openaiImageSettings";
import { readGenerationResponse } from "@/lib/generationResponse";
import { prepareFoodPhoto, type FoodPhoto } from "@/lib/recipeFoodPhoto";
import {
  RECIPE_IMAGE_TO_IMAGE_MODEL, RECIPE_IMAGE_TO_IMAGE_SETTINGS,
  MAX_EXTRA_INSTRUCTIONS, MAX_RECIPE_VARIATIONS,
} from "@/lib/recipeImageToImageSettings";

type Variation = {
  id: string; imageUrl: string; imageModel: string; imageSettings: OpenAIImageSettings;
  cost: number; imageCost: number | null; costIncomplete: boolean;
};

const inputClass = "w-full rounded-xl border border-[#4a3b2c] bg-[#1a1511] px-3 py-2.5 text-sm text-neutral-100 outline-none focus:border-[#c97a3d] focus:ring-2 focus:ring-[#c97a3d]/20 disabled:opacity-50";
const secondaryClass = "rounded-xl border border-[#5a4634] px-4 py-2.5 text-sm text-[#f3e5d4] transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50";

export function RecipeImageToImage() {
  const [photo, setPhoto] = useState<FoodPhoto | null>(null);
  const [extraInstructions, setExtraInstructions] = useState("");
  const [model, setModel] = useState<string>(RECIPE_IMAGE_TO_IMAGE_MODEL);
  const [settings, setSettings] = useState<OpenAIImageSettings>({ ...RECIPE_IMAGE_TO_IMAGE_SETTINGS });
  const [count, setCount] = useState("1");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [results, setResults] = useState<Variation[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [partial, setPartial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [preview, setPreview] = useState<Variation | null>(null);
  const [filterTarget, setFilterTarget] = useState<{ result: Variation; index: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const dragDepth = useRef(0);
  const uploadVersion = useRef(0);
  const numberOfImages = Number(count);
  const validCount = Number.isInteger(numberOfImages) && numberOfImages >= 1 && numberOfImages <= MAX_RECIPE_VARIATIONS;
  const selectedResult = results[selectedIndex] || results[0];
  useEffect(() => {
    if (preview) dialog.current?.showModal();
    else dialog.current?.close();
  }, [preview]);

  function changeModel(next: string) {
    setModel(next);
    setSettings((current) => ({
      ...current,
      quality: imageQualitiesFor(next).includes(current.quality) ? current.quality : "high",
      complexity: supportsImageComplexity(next) ? current.complexity : "default",
    }));
  }

  async function addPhoto(file?: File) {
    if (!file || busy.current) return;
    const version = ++uploadVersion.current;
    setUploading(true);
    setError(null);
    try {
      const prepared = await prepareFoodPhoto(file);
      if (version !== uploadVersion.current) return;
      if (photo) setExtraInstructions("");
      setPhoto(prepared);
      setResults([]);
      setSelectedIndex(0);
      setCompleted(0);
    } catch (error) {
      if (version === uploadVersion.current) setError(error instanceof Error ? error.message : "Could not read this photo.");
    } finally {
      if (version === uploadVersion.current) setUploading(false);
    }
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (loading || uploading) return;
    dragDepth.current++;
    setDragging(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = loading || uploading ? "none" : "copy";
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    if (loading || uploading || busy.current) return;
    if (event.dataTransfer.files.length !== 1) {
      setError("Drop one JPG, PNG, or WebP food photo at a time.");
      return;
    }
    void addPhoto(event.dataTransfer.files[0]);
  }

  async function generate() {
    if (busy.current || uploading) return;
    if (!photo) { setError("Upload a food photo first."); return; }
    if (!validCount) { setError("Choose between 1 and 10 images."); return; }
    busy.current = true;
    setLoading(true);
    setError(null);
    setResults([]);
    setSelectedIndex(0);
    setPreview(null);
    setCompleted(0);
    setPartial(null);
    try {
      // Each variation uses the original food photo, never the previous output.
      // Failed paid requests are not retried automatically.
      for (let i = 0; i < numberOfImages; i++) {
        setPartial(null);
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/x-ndjson" },
          body: JSON.stringify({
            contentType: "recipes", recipeWorkflow: "imageToImage",
            references: [photo.dataUrl], extraInstructions,
            imageModel: model, imageSettings: settings,
          }),
        });
        const result = await readGenerationResponse(response, setPartial);
        if (typeof result.imageUrl !== "string" || !result.imageUrl) throw new Error("No finished image was returned.");
        setResults((current) => [...current, { ...result, id: String(Date.now()) + "-" + i }]);
        setCompleted(i + 1);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Image generation failed. Please try again.");
    } finally {
      busy.current = false;
      setLoading(false);
      setPartial(null);
    }
  }

  async function download(result: Variation, index: number) {
    setDownloading(result.id);
    try {
      const url = result.imageUrl.startsWith("data:") ? result.imageUrl : "/api/download?url=" + encodeURIComponent(result.imageUrl);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not download the image.");
      const original = await response.blob();
      const blob = result.imageSettings.output_format === "webp" ? await compressRecipeWebp(original) : original;
      const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
      const file = new File([blob], "recipe-variation-" + (index + 1) + "." + extension, { type: blob.type });
      if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) setError(error instanceof Error ? error.message : "Download failed.");
    } finally { setDownloading(null); }
  }

  return (
    <div aria-label="Recipe image to image workspace">
      <section className="studio-panel mb-4 rounded-[28px] p-5 sm:p-6">
        <div className="mb-6">
          <h1 className="studio-title text-3xl text-[#f7efe5]">Image to Image</h1>
        </div>
        {error && <div role="alert" className="mb-4 rounded-xl border border-red-400/25 bg-red-950/30 p-4 text-sm text-red-200">{error}</div>}
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.75fr)]">
          <div className="grid content-start gap-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-[#f3e5d4]">Original food photo</h2>
              {photo && <button type="button" className="text-xs text-[#cbb8a2] underline underline-offset-4 disabled:opacity-50"
                disabled={loading || uploading} onClick={() => { uploadVersion.current++; setPhoto(null); setExtraInstructions(""); setError(null); setResults([]); setSelectedIndex(0); }}>Remove photo</button>}
            </div>
            <div role="button" tabIndex={loading || uploading ? -1 : 0} aria-disabled={loading || uploading}
              aria-label={photo ? "Drop a food photo here to replace it, or click to browse" : "Drop a food photo here, or click to browse"}
              onClick={() => { if (!loading && !uploading) input.current?.click(); }}
              onKeyDown={(event) => { if (!loading && !uploading && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); input.current?.click(); } }}
              onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
              className={`flex min-h-[260px] items-center justify-center overflow-hidden rounded-2xl border border-dashed transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f3e5d4] ${dragging ? "border-[#d2a273] bg-[#4a2e1d]/60 ring-2 ring-[#d2a273]/40" : "border-[#6b5037] bg-[#120f0d]/60"} ${loading || uploading ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.dataUrl} alt="Original uploaded food" draggable={false} className="max-h-[360px] w-full object-contain" />
              ) : (
                <div className="px-6 py-10 text-center">
                  <div aria-hidden="true" className="mb-3 text-3xl text-[#d2a273]">＋</div>
                  <p className="text-sm text-[#f3e5d4]">Drag a food photo here or click to browse</p>
                  <p className="mt-2 text-xs text-[#b9aa98]">JPG, PNG, or WebP · up to 25 MB</p>
                </div>
              )}
            </div>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload food photo"
              className="sr-only" disabled={loading || uploading}
              onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void addPhoto(file); }} />
            <div className="mt-3 flex min-w-0 items-center gap-3">
              <button type="button" className={secondaryClass} disabled={loading || uploading} onClick={() => input.current?.click()}>
                {uploading ? "Preparing photo…" : photo ? "Change photo" : "Upload food photo"}
              </button>
              {photo && <p className="min-w-0 truncate text-xs text-[#b9aa98]" title={photo.name}>{photo.name}</p>}
            </div>
            {photo && <p className="mt-2 text-xs text-[#b9aa98]">Changing or removing this photo clears the extra instructions and current result.</p>}
            <div className="mt-4">
              <OpenAIImageControls recipePresets model={model} value={settings} onChange={setSettings} disabled={loading} quickSettingsOnly />
            </div>
          </div>
          <div className="flex flex-col">
            <label className="grid gap-2 text-sm text-[#cbb8a2]">
              Extra instructions <span className="sr-only">(optional)</span>
              <textarea className={inputClass + " min-h-[152px] resize-y"} rows={5} value={extraInstructions}
                maxLength={MAX_EXTRA_INSTRUCTIONS} disabled={loading || uploading}
                placeholder="Optional: a cream ceramic bowl on a wooden kitchen table, with soft window light."
                onChange={(event) => setExtraInstructions(event.target.value)} />
            </label>
            <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
              <label className="grid min-w-0 gap-2 text-sm text-[#cbb8a2]">
                Image model
                <select className={inputClass} value={model} onChange={(event) => changeModel(event.target.value)} disabled={loading}>
                  {[RECIPE_IMAGE_TO_IMAGE_MODEL, ...OPENAI_IMAGE_MODEL_IDS.filter((id) => id !== RECIPE_IMAGE_TO_IMAGE_MODEL)].map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </label>
              <label className="grid gap-2 text-sm text-[#cbb8a2]">
                Number of images
                <input className={inputClass} type="number" min={1} max={MAX_RECIPE_VARIATIONS} step={1}
                  value={count} disabled={loading} onChange={(event) => setCount(event.target.value)} />
              </label>
            </div>
            <div className="mt-auto pt-6">
              <button type="button" onClick={() => void generate()} disabled={!photo || loading || uploading || !validCount}
                className="w-full rounded-xl bg-gradient-to-r from-[#f3e5d4] to-[#c97a3d] px-5 py-3 text-sm font-semibold text-[#221912] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                {loading ? "Generating " + (completed + 1) + " of " + numberOfImages + "…" : "Generate"}
              </button>
              <p className="mt-3 text-xs leading-relaxed text-[#b9aa98]">OpenAI usage is billed per image. Download results before refreshing this page.</p>
            </div>
          </div>
          </div>
          <aside aria-label="Food photo variations" className="self-start rounded-[22px] border border-[#514131] bg-[#100d0b]/60 p-4">
            <p className="text-xs uppercase tracking-[.18em] text-[#d2a273]">Output preview</p>
            <h2 className="studio-title mt-1 text-xl">{selectedResult ? `Variation ${selectedIndex + 1}` : "Your variation"}</h2>
            <div className="mt-4 flex aspect-[4/5] items-center justify-center overflow-hidden rounded-xl border border-[#514131] bg-[#211912]">
              {selectedResult ? <button type="button" className="block h-full w-full" onClick={() => setPreview(selectedResult)} aria-label={`Open variation ${selectedIndex + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedResult.imageUrl} alt={`Realistic variation ${selectedIndex + 1} of the uploaded dish`} className="h-full w-full object-contain" />
              </button> : partial ?
                // eslint-disable-next-line @next/next/no-img-element
                <img src={partial} alt="Food variation in progress" className="h-full w-full object-contain" /> :
                <p className="px-6 text-center text-sm text-[#b9aa98]">Your generated image will appear here.</p>}
            </div>
            {loading && <p role="status" aria-live="polite" className="mt-3 text-sm text-[#cbb8a2]">
              {completed + " of " + numberOfImages + " variations ready. Creating a new setting for your dish…"}
            </p>}
            {!selectedResult && partial && <p className="mt-2 text-xs text-[#b9aa98]">Preview · still generating</p>}
            {selectedResult && <div className="mt-4">
              <p className="break-words text-xs text-[#b9aa98]">{selectedResult.imageModel}</p>
              <p className="mt-2 text-xs text-[#b9aa98]">{selectedResult.imageCost === null ? "Cost unavailable from provider usage" : "$" + selectedResult.cost.toFixed(5) + (selectedResult.costIncomplete ? " · partial estimate" : " · recorded usage")}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className={secondaryClass} disabled={downloading !== null} onClick={() => void download(selectedResult, selectedIndex)}>
                  {downloading === selectedResult.id ? "Downloading…" : (selectedResult.imageSettings.output_format === "webp" ? "Download optimized WebP" : "Download Original · " + selectedResult.imageSettings.output_format.toUpperCase())}
                </button>
                <button type="button" className={secondaryClass} onClick={() => setFilterTarget({ result: selectedResult, index: selectedIndex })}>Add Filter</button>
              </div>
            </div>}
            {results.length > 1 && <div className="mt-5">
              <p className="mb-2 text-sm font-medium text-[#e8d9c8]">Choose a variation</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {results.map((result, index) => <button key={result.id} type="button" aria-label={`Select variation ${index + 1}`} aria-pressed={selectedIndex === index} onClick={() => setSelectedIndex(index)}
                  className={`overflow-hidden rounded-lg border p-1 text-xs ${selectedIndex === index ? "border-[#d9965e] bg-[#50301f] text-[#fff3e5]" : "border-[#514131] text-[#cbb8a2]"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.imageUrl} alt="" className="aspect-square w-full rounded object-cover" />
                  <span className="block py-1">{index + 1}</span>
                </button>)}
              </div>
            </div>}
            {selectedResult && partial && <div className="mt-4 rounded-xl border border-[#514131] p-2">
              <p className="mb-2 text-xs text-[#b9aa98]">Next variation · still generating</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={partial} alt="Food variation in progress" className="max-h-40 w-full object-contain" />
            </div>}
          </aside>
        </div>
      </section>

      <OpenAIImageControls recipePresets model={model} value={settings} onChange={setSettings} disabled={loading} hideQuickSettings
        countDescription="Each variation uses your original food photo. Partial images show progress before each finished image." />

      <dialog ref={dialog} aria-label="Food variation preview" onCancel={() => setPreview(null)}
        onClick={(event) => { if (event.target === event.currentTarget) setPreview(null); }}
        className="max-h-[95vh] w-[min(95vw,1000px)] rounded-2xl border border-[#4a3b2c] bg-[#120f0d] p-4 text-[#f3e5d4] backdrop:bg-black/80">
        <div className="mb-3 flex justify-end">
          <button type="button" autoFocus className={secondaryClass} onClick={() => setPreview(null)}>Close image preview</button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img src={preview.imageUrl} alt="Enlarged food photo variation" className="max-h-[78vh] w-full object-contain" />}
      </dialog>
      {filterTarget && <ImageFilterStudio webOptimized={filterTarget.result.imageSettings.output_format === "webp"} source={filterTarget.result.imageUrl} fileName={`recipe-variation-${filterTarget.index + 1}`} onClose={() => setFilterTarget(null)} />}
    </div>
  );
}
