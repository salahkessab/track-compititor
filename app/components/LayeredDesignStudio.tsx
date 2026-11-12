"use client";

import { useEffect, useRef, useState } from "react";
import { LayeredDesignEditor, type LayeredOutput, type LayerProject } from "./LayeredDesignEditor";
import { ImageFilterStudio, type FilteredImage } from "./ImageFilterStudio";
import { getRecipeStyle, RECIPE_STYLE_PRESETS, type RecipeStyleId } from "@/lib/recipeDesignStylePresets";
import { INGREDIENT_CARD_STYLE_ID, validateRecipeIngredients } from "@/lib/recipeDesignIngredients";
import { validateTitle, type DesignFamily } from "@/lib/recipeDesigns";
import { prepareLocalPhoto, type LocalPhoto } from "@/lib/recipeDesignPhoto";
import { listLocal } from "@/lib/recipeDesignStorage";
import { listLayeredDesigns, saveLayeredDesign } from "@/lib/layeredDesignStorage";

type LayeredRecord = { id: string; title: string; ingredients?: string; createdAt: string; image: Blob; family: DesignFamily; styleId: RecipeStyleId; project?: LayerProject; filtered?: boolean };
type LegacyRecord = { id: string; title: string; ingredients?: string; createdAt: string; image: Blob; layerProject?: LayerProject; plan?: { family?: DesignFamily; styleId?: string } };
type EditorTarget = { photo?: LocalPhoto; title: string; ingredients?: string; family: DesignFamily; styleId: RecipeStyleId; project?: LayerProject };

const inputClass = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-600 disabled:opacity-50";
const buttonClass = "rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40";
const accentClass = "rounded-xl bg-gradient-to-r from-blue-600 to-blue-600 px-4 py-3 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";

function ImageBlob({ blob, alt, className }: { blob: Blob; alt: string; className: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => { const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={alt} className={className} /> : null;
}

async function download(blob: Blob) {
  const ext = blob.type === "image/jpeg" ? "jpg" : "png";
  const file = new File([blob], `layered-design-1200x1500.${ext}`, { type: blob.type });
  if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function LayeredDesignStudio({ active }: { active: boolean }) {
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [styleId, setStyleId] = useState<RecipeStyleId>("vintage_farmhouse_recipe");
  const [photo, setPhoto] = useState<LocalPhoto | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [history, setHistory] = useState<LayeredRecord[]>([]);
  const [selected, setSelected] = useState<LayeredRecord | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [filterTarget, setFilterTarget] = useState<LayeredRecord | null>(null);
  const loaded = useRef(false), input = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
  const style = getRecipeStyle(styleId)!;

  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    let alive = true, completed = false;
    void (async () => {
      try {
        const [saved, oldHistory] = await Promise.all([
          listLayeredDesigns<LayeredRecord>(),
          // Preserve layered projects briefly saved by the earlier version, without changing the old history.
          listLocal<LegacyRecord>("history").catch(() => []),
        ]);
        const ids = new Set(saved.map(item => item.id));
        const migrated = oldHistory.filter(item => item.layerProject && !ids.has(item.id)).map(item => {
          const savedStyle = getRecipeStyle(item.plan?.styleId || "") || getRecipeStyle("vintage_farmhouse_recipe")!;
          return { id: item.id, title: item.title, ingredients: item.ingredients, createdAt: item.createdAt, image: item.image,
            family: item.plan?.family || savedStyle.family, styleId: savedStyle.id, project: item.layerProject } as LayeredRecord;
        });
        for (const item of migrated) await saveLayeredDesign(item);
        if (!alive) return;
        const all = [...saved, ...migrated].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setHistory(all); setSelected(all[0] || null); completed = true;
      } catch { if (alive) { setError("Could not load local design history. You can still create and download a design."); completed = true; } }
    })();
    return () => { alive = false; if (!completed) loaded.current = false; };
  }, [active]);

  async function upload(file?: File) {
    if (!file || uploading) return;
    setUploading(true); setError("");
    try { setPhoto(await prepareLocalPhoto(file)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read that photo."); }
    finally { setUploading(false); }
  }

  function createDesign() {
    try {
      if (!photo) throw new Error("Upload a food photo first.");
      const validated = validateTitle(title, false);
      const ingredientText = styleId === INGREDIENT_CARD_STYLE_ID ? validateRecipeIngredients(ingredients) : undefined;
      setError(""); setEditor({ photo, title: validated.title, ingredients: ingredientText, family: style.family, styleId });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Check your inputs."); }
  }

  async function saveDesign(output: LayeredOutput) {
    if (!editor) throw new Error("The editor is no longer open.");
    const saved: LayeredRecord = { id: crypto.randomUUID(), title: output.title, ingredients: output.ingredients,
      createdAt: new Date().toISOString(), image: output.blob, family: editor.family, styleId: editor.styleId, project: output.project };
    await saveLayeredDesign(saved); setHistory(items => [saved, ...items]); setSelected(saved);
  }

  async function saveFiltered(output: FilteredImage) {
    if (!filterTarget) throw new Error("The original design is no longer available.");
    const saved: LayeredRecord = { ...filterTarget, id: crypto.randomUUID(), createdAt: new Date().toISOString(), image: output.blob, project: undefined, filtered: true };
    await saveLayeredDesign(saved); setHistory(items => [saved, ...items]);
  }

  return <div aria-label="Layered Designs workspace" className="space-y-4">
    <section className="studio-panel rounded-[28px] p-5 sm:p-6">
      <div className="mb-6"><p className="text-xs uppercase tracking-[.2em] text-blue-700">Recipes · Editable layers</p><h1 className="studio-title mt-2 text-3xl">Layered Designs</h1><p className="mt-2 max-w-3xl text-sm text-gray-600">Create a design with separate photo, title, and decoration layers. Choose a free built-in decoration or upload your own in the editor.</p></div>
      {error && <div role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-950/30 p-4 text-sm text-red-700">{error}</div>}
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.75fr)]">
        <div className="space-y-5">
          <label className="grid gap-2 text-sm text-gray-900">Recipe title<input className={inputClass} value={title} maxLength={180} placeholder="Your exact recipe title" onChange={event => setTitle(event.target.value)} /></label>
          <div><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-medium">Food photo <span className="text-blue-700">· required</span></h2>{photo && <button type="button" className="text-xs underline" onClick={() => setPhoto(null)}>Remove</button>}</div>
            <div role="button" tabIndex={0} aria-label="Drop a food photo here or browse files" onClick={() => input.current?.click()} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.current?.click(); } }}
              onDragEnter={event => { event.preventDefault(); dragDepth.current++; setDragging(true); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
              onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
              onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void upload(event.dataTransfer.files[0]); }}
              className={`flex min-h-64 w-full cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed bg-white/60 p-4 text-center text-blue-700 ${dragging ? "border-blue-600 ring-2 ring-blue-600/40" : "border-gray-200"}`}>
              {photo ? <ImageBlob blob={photo.blob} alt="Uploaded food photo" className="max-h-72 w-full object-contain" /> : <><span className="text-lg font-medium">Drag your food photo here</span><span className="text-xs text-gray-600">JPG, PNG, static WebP · up to 25 MB</span></>}
              <button type="button" className={buttonClass} onClick={event => { event.stopPropagation(); input.current?.click(); }}>{photo ? "Replace photo" : "Browse Files"}</button>
            </div><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload food photo for layered design" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void upload(file); }} />
            {photo && <p className="mt-2 break-all text-xs text-gray-600">{photo.name} · {photo.width}×{photo.height}</p>}{uploading && <p role="status" className="mt-2 text-xs text-gray-600">Preparing photo…</p>}
          </div>
          <label className="grid gap-2 text-sm text-gray-900">Decoration style<select className={inputClass} value={styleId} onChange={event => setStyleId(event.target.value as RecipeStyleId)}>{RECIPE_STYLE_PRESETS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {styleId === INGREDIENT_CARD_STYLE_ID && <label className="grid gap-2 text-sm text-gray-900">Ingredients · required<textarea className={inputClass} rows={5} maxLength={2000} value={ingredients} onChange={event => setIngredients(event.target.value)} placeholder="One ingredient per line, including its amount" /></label>}
          <button type="button" className={accentClass + " w-full"} disabled={uploading} onClick={createDesign}>Create editable layered design</button>
          <p className="text-xs leading-relaxed text-gray-600">Built-in decorations are created on your device. No OpenAI request is needed.</p>
        </div>
        <aside className="rounded-[22px] border border-gray-200 bg-white/60 p-4"><div className="flex items-center justify-between gap-2"><div><p className="text-xs uppercase tracking-[.18em] text-blue-700">Output preview</p><h2 className="studio-title mt-1 text-xl">1200 × 1500 {selected?.image.type === "image/jpeg" ? "JPEG" : "PNG"}</h2></div><button type="button" className={buttonClass} onClick={() => setShowHistory(value => !value)}>Design History ({history.length})</button></div>
          <div className="mt-4 flex aspect-[4/5] items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white">{selected ? <ImageBlob blob={selected.image} alt="Layered design preview" className="h-full w-full object-contain" /> : <p className="px-6 text-center text-sm text-gray-600">Your layered design will appear here.</p>}</div>
          {selected && <><p className="mt-3 text-sm text-blue-700">{selected.filtered ? "Filtered copy" : "Editable layered design"} · {selected.title}</p><p className="mt-2 text-xs text-gray-600">Your original photo remains unchanged. Exported photo pixels are not separately verified.</p>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => void download(selected.image).catch(reason => setError(reason instanceof Error ? reason.message : "Download failed."))}>Download {selected.filtered ? "copy" : "design"}</button>{selected.project && <button type="button" className={buttonClass} onClick={() => setEditor({ title: selected.title, ingredients: selected.ingredients, family: selected.family, styleId: selected.styleId, project: selected.project })}>Edit Layers</button>}<button type="button" className={buttonClass} onClick={() => setFilterTarget(selected)}>Add Filter</button></div></>}
          {showHistory && <div className="mt-5 border-t border-gray-200 pt-4"><h3 className="text-sm font-medium">Saved on this device</h3>{history.length === 0 ? <p className="mt-2 text-xs text-gray-600">No layered designs yet.</p> : <div className="mt-2 space-y-2">{history.slice(0, 20).map(item => <button key={item.id} type="button" onClick={() => setSelected(item)} className="block w-full rounded-lg border border-gray-200 p-2 text-left text-xs"><span className="block truncate">{item.title}</span><span className="text-gray-600">{item.filtered ? "Filtered copy" : "Editable layered design"} · {new Date(item.createdAt).toLocaleString()}</span></button>)}</div>}</div>}
          <p className="mt-5 border-t border-gray-200 pt-4 text-xs text-gray-600">Layered designs are stored in this browser, separately from Recipe Designs history.</p>
        </aside>
      </div>
    </section>
    {editor && <LayeredDesignEditor photo={editor.photo} title={editor.title} ingredients={editor.ingredients} family={editor.family} project={editor.project} onClose={() => setEditor(null)} onSave={saveDesign} />}
    {filterTarget && <ImageFilterStudio source={filterTarget.image} fileName="layered-design-1200x1500" onClose={() => setFilterTarget(null)} onSave={saveFiltered} />}
  </div>;
}
