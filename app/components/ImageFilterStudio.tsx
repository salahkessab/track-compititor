"use client";

import { useEffect, useRef, useState } from "react";
import { applyImageAdjustments, IMAGE_FILTER_PRESETS, ORIGINAL_ADJUSTMENTS, type ImageAdjustments, type ImageFilterPreset } from "@/lib/imageFilters";

export type FilteredImage = { blob: Blob; preset: ImageFilterPreset; adjustments: ImageAdjustments; format: "png" | "jpeg" };

type Props = {
  source: Blob | string;
  fileName: string;
  onClose: () => void;
  onSave?: (image: FilteredImage) => Promise<void>;
};

const buttonClass = "rounded-xl border border-[#604a36] px-3 py-2 text-sm text-[#ead9c7] transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
const ranges: { key: keyof ImageAdjustments; label: string; min: number; max: number }[] = [
  { key: "brightness", label: "Brightness", min: -40, max: 40 },
  { key: "contrast", label: "Contrast", min: -40, max: 40 },
  { key: "saturation", label: "Saturation", min: -40, max: 40 },
  { key: "warmth", label: "Warmth", min: -40, max: 40 },
  { key: "grain", label: "Grain", min: 0, max: 30 },
];

function drawFiltered(canvas: HTMLCanvasElement, image: HTMLImageElement, adjustments: ImageAdjustments) {
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) throw new Error("Could not prepare the image for filtering.");
  ctx.drawImage(image, 0, 0);
  if (Object.values(adjustments).some(value => value !== 0)) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyImageAdjustments(pixels.data, canvas.width, adjustments);
    ctx.putImageData(pixels, 0, 0);
  }
}

async function encodeFiltered(image: HTMLImageElement, adjustments: ImageAdjustments, format: "png" | "jpeg"): Promise<Blob> {
  const canvas = document.createElement("canvas");
  drawFiltered(canvas, image, adjustments);
  if (format === "jpeg") {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the JPEG.");
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
  }
  return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not export the filtered image.")), `image/${format}`, 0.92));
}

async function downloadFiltered(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type });
  if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (error) { if (error instanceof Error && error.name === "AbortError") throw error; }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ImageFilterStudio({ source, fileName, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const lastSaved = useRef("");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [preset, setPreset] = useState<ImageFilterPreset>("original");
  const [adjustments, setAdjustments] = useState<ImageAdjustments>({ ...ORIGINAL_ADJUSTMENTS });
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true, objectUrl = "";
    const controller = new AbortController();
    void (async () => {
      try {
        const url = typeof source === "string" && !source.startsWith("data:") && !source.startsWith("blob:")
          ? `/api/download?url=${encodeURIComponent(source)}` : source;
        const blob = typeof url === "string" ? await fetch(url, { signal: controller.signal }).then(response => {
          if (!response.ok) throw new Error("Could not load this image for filtering.");
          return response.blob();
        }) : url;
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        const loaded = new Image();
        loaded.onload = () => { if (active) { setImage(loaded); setOriginalUrl(objectUrl); } };
        loaded.onerror = () => { if (active) setError("Could not read this image for filtering."); };
        loaded.src = objectUrl;
      } catch (reason) {
        if (active && !(reason instanceof Error && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Could not load this image.");
      }
    })();
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source]);
  useEffect(() => {
    if (!image || !canvas.current) return;
    const timer = window.setTimeout(() => {
      try { if (canvas.current) drawFiltered(canvas.current, image, adjustments); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview this filter."); }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [image, adjustments]);

  function choosePreset(id: ImageFilterPreset) {
    const next = IMAGE_FILTER_PRESETS.find(item => item.id === id)!;
    setPreset(id); setAdjustments({ ...next.adjustments }); setCompare(false); setError(""); setNotice("");
  }

  async function exportImage(download: boolean) {
    if (!image || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const blob = await encodeFiltered(image, adjustments, format);
      const signature = JSON.stringify({ preset, adjustments, format });
      let saved = false;
      if (onSave && signature !== lastSaved.current) {
        try { await onSave({ blob, preset, adjustments: { ...adjustments }, format }); lastSaved.current = signature; saved = true; }
        catch { setError("Could not save this copy to Design History. Your original is unchanged."); }
      } else if (onSave) saved = true;
      if (download) await downloadFiltered(blob, `${fileName}-filtered.${format === "jpeg" ? "jpg" : "png"}`);
      if (saved) setNotice("Filtered copy saved in Design History. Your original is unchanged.");
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Could not export the filtered image.");
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} aria-label="Image Filter Studio" onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="max-h-[94dvh] w-[min(96vw,1120px)] overflow-y-auto rounded-[24px] border border-[#604a36] bg-[#17120f] p-0 text-[#f3e5d4] shadow-2xl backdrop:bg-black/80">
    <header className="flex items-center justify-between gap-3 border-b border-[#514131] px-5 py-4">
      <div><h2 className="studio-title text-2xl">Image Filter Studio</h2><p className="mt-1 text-xs text-[#b9aa98]">Preview a new look. Your original stays unchanged.</p></div>
      <div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => choosePreset("original")}>Reset</button><button type="button" className={buttonClass} onClick={onClose}>Close</button></div>
    </header>
    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <div className="flex min-h-[200px] items-center justify-center overflow-hidden rounded-xl border border-[#514131] bg-[#0d0a08] p-2">
          {!image && !error && <p role="status" className="text-sm text-[#b9aa98]">Loading image…</p>}
          {originalUrl && compare && <img src={originalUrl} alt="Original generated image" className="max-h-[64vh] max-w-full object-contain" />}
          <canvas ref={canvas} role="img" aria-label="Filtered image preview" hidden={!image || compare} className="max-h-[64vh] max-w-full object-contain" />
        </div>
        <button type="button" aria-pressed={compare} className={buttonClass + " mt-3"} disabled={!image} onClick={() => setCompare(value => !value)}>{compare ? "Show filtered image" : "Compare with original"}</button>
      </div>
      <div className="min-w-0">
        <h3 className="text-xs font-semibold uppercase tracking-[.16em] text-[#d2a273]">Filters</h3>
        <div className="mt-3 grid grid-cols-3 gap-2">{IMAGE_FILTER_PRESETS.map(item => <button key={item.id} type="button" aria-pressed={preset === item.id}
          onClick={() => choosePreset(item.id)} className={"min-h-[64px] rounded-xl border p-2 text-left text-xs font-medium transition " + (preset === item.id ? "border-[#c97a3d] bg-[#c97a3d]/15 text-[#fff1e1]" : "border-[#514131] bg-[#201914] text-[#d7c5b3] hover:border-[#a97c54]")}>
          <span aria-hidden="true" className="mb-1 block text-base text-[#d2a273]">{item.icon}</span>{item.label}</button>)}</div>
        <h3 className="mt-5 border-t border-[#514131] pt-4 text-xs font-semibold uppercase tracking-[.16em] text-[#d2a273]">Fine-tune</h3>
        <div className="mt-3 space-y-3">{ranges.map(range => <label key={range.key} className="block text-xs text-[#d7c5b3]"><span className="flex justify-between"><span>{range.label}</span><span>{adjustments[range.key]}</span></span>
          <input type="range" min={range.min} max={range.max} value={adjustments[range.key]} onChange={event => { setAdjustments(current => ({ ...current, [range.key]: Number(event.target.value) })); setNotice(""); }} className="mt-2 w-full accent-[#c97a3d]" /></label>)}</div>
        <label className="mt-5 block text-xs text-[#d7c5b3]">Download format<select aria-label="Download format" value={format} onChange={event => setFormat(event.target.value as "png" | "jpeg")} className="mt-2 w-full rounded-xl border border-[#514131] bg-[#1d1611] px-3 py-2.5 text-sm text-[#f3e5d4]"><option value="png">PNG</option><option value="jpeg">JPEG · high quality</option></select></label>
        {format === "jpeg" && <p className="mt-2 text-xs text-[#b9aa98]">JPEG uses a white background for transparent areas.</p>}
        {onSave && <p className="mt-3 text-xs leading-relaxed text-[#b9aa98]">Downloading also saves a separate copy in Design History.</p>}
        {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}{notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}
        <button type="button" disabled={!image || busy} onClick={() => void exportImage(true)} className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#f3e5d4] to-[#c97a3d] px-4 py-3 text-sm font-semibold text-[#221912] hover:brightness-110 disabled:opacity-40">{busy ? "Preparing image…" : `Download filtered ${format.toUpperCase()}`}</button>
        {onSave && <button type="button" disabled={!image || busy} onClick={() => void exportImage(false)} className={buttonClass + " mt-2 w-full"}>Save to Design History</button>}
        <p className="mt-3 text-xs leading-relaxed text-[#b9aa98]">Filters change appearance but cannot guarantee AI detection results.</p>
      </div>
    </div>
  </dialog>;
}
