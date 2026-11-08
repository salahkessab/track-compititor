"use client";

import { useEffect, useRef, useState } from "react";
import type { Canvas, FabricObject, Textbox } from "fabric";
import { recipeDesignLayout } from "@/lib/recipeDesignRenderer";
import { renderRecipeScene, TEMPLATE_COLORS } from "@/lib/recipeDesignScene";
import type { DesignFamily } from "@/lib/recipeDesigns";
import type { LocalPhoto } from "@/lib/recipeDesignPhoto";
import { fitPhotoLayer } from "@/lib/recipeLayerLayout";

export type LayerProject = { version: 1; scene: string; title: string; ingredients?: string };
export type LayeredOutput = { blob: Blob; project: LayerProject; title: string; ingredients?: string };

type Props = {
  photo?: LocalPhoto | null;
  title: string;
  ingredients?: string;
  family: DesignFamily;
  project?: LayerProject;
  onClose: () => void;
  onSave: (output: LayeredOutput) => Promise<void>;
};
type NamedObject = FabricObject & { layerId?: string };
type LayerInfo = { id: string; label: string; visible: boolean; locked: boolean };

const button = "rounded-xl border border-[#604a36] px-3 py-2 text-sm text-[#ead9c7] transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";
const field = "w-full rounded-xl border border-[#514131] bg-[#17120f] px-3 py-2.5 text-sm text-[#f7efe5] outline-none focus:border-[#c97a3d]";
const labelFor = (id: string) => id === "photo" ? "Food photo" : id === "title" ? "Recipe title" : id === "ingredients" ? "Ingredients" : "Decoration";

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the image."));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(blob);
  });
}

function download(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "layered-recipe-design-1200x1500.png"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function LayeredDesignEditor({ photo, title, ingredients, family, project, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvasElement = useRef<HTMLCanvasElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Canvas | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [active, setActive] = useState("title");
  const [titleText, setTitleText] = useState(project?.title ?? title);
  const [titleFont, setTitleFont] = useState("Fraunces Variable");
  const [titleColor, setTitleColor] = useState(TEMPLATE_COLORS[family].ink);
  const [ingredientText, setIngredientText] = useState(project?.ingredients ?? ingredients ?? "");
  const hasIngredients = ingredients !== undefined || project?.ingredients !== undefined;
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lastSaved = useRef("");

  function refreshLayers(stage: Canvas) {
    setLayers((stage.getObjects() as NamedObject[]).slice().reverse().filter(object => object.layerId).map(object => ({
      id: object.layerId!, label: labelFor(object.layerId!), visible: object.visible !== false, locked: object.selectable === false,
    })));
  }
  function layer(id: string) { return (stageRef.current?.getObjects() as NamedObject[] | undefined)?.find(object => object.layerId === id); }

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let alive = true, stage: Canvas | null = null, observer: ResizeObserver | null = null;
    void (async () => {
      try {
        const F = await import("fabric");
        if (!alive || !canvasElement.current) return;
        stage = new F.Canvas(canvasElement.current, { width: 1200, height: 1500, enableRetinaScaling: false, preserveObjectStacking: true });
        stageRef.current = stage;
        if (project) {
          await stage.loadFromJSON(project.scene);
        } else {
          if (!photo) throw new Error("Choose a food photo before creating a layered design.");
          const photoUrl = await readDataUrl(photo.blob);
          const layout = recipeDesignLayout(family);
          const photoRect = fitPhotoLayer(layout.area, photo.width, photo.height);
          const designCanvas = document.createElement("canvas"); designCanvas.width = 1200; designCanvas.height = 1500;
          const ctx = designCanvas.getContext("2d"); if (!ctx) throw new Error("Could not prepare the decoration layer.");
          ctx.fillStyle = TEMPLATE_COLORS[family].background; ctx.fillRect(0, 0, 1200, 1500);
          const font = family === "notebook" ? "Special Elite" : family === "retro_diner" ? "Archivo Narrow Variable" : "Fraunces Variable";
          await renderRecipeScene(ctx, { family, title: " ", noText: false, titleBox: layout.title, photoRect, face: { family: font, weight: 800, maxSize: 160, spacing: 0 } });
          await document.fonts?.load(`800 48px "${font}"`);
          const decoration = await F.FabricImage.fromURL(designCanvas.toDataURL("image/png"));
          decoration.set({ left: 0, top: 0, originX: "left", originY: "top", selectable: true, evented: true, cornerSize: 32, transparentCorners: false });
          (decoration as NamedObject).layerId = "decoration";
          const image = await F.FabricImage.fromURL(photoUrl);
          image.set({ left: photoRect.x, top: photoRect.y, originX: "left", originY: "top", scaleX: photoRect.width / photo.width, scaleY: photoRect.height / photo.height, cornerSize: 32, transparentCorners: false });
          (image as NamedObject).layerId = "photo";
          const margin = 90;
          const text = new F.Textbox(title, { left: layout.title.x + margin, top: layout.title.y + 45, originX: "left", originY: "top", width: layout.title.width - margin * 2,
            fontFamily: font, fontWeight: 800, fontSize: ingredients ? 72 : 150, fill: TEMPLATE_COLORS[family].ink, textAlign: "center", lineHeight: 0.95, cornerSize: 32, transparentCorners: false });
          while (text.height > (ingredients ? 105 : layout.title.height - 90) && (text.fontSize || 20) > 24) { text.set("fontSize", (text.fontSize || 20) - 2); text.initDimensions(); }
          text.set({ top: ingredients ? layout.title.y + 28 : layout.title.y + (layout.title.height - text.height) / 2 });
          (text as NamedObject).layerId = "title";
          stage.add(decoration, image, text);
          if (ingredients) {
            const ingredientText = new F.Textbox(`INGREDIENTS\n${ingredients}`, { left: layout.title.x + 100, top: layout.title.y + 125, originX: "left", originY: "top",
              width: layout.title.width - 200, fontFamily: "Georgia", fontWeight: 600, fontSize: 30, fill: TEMPLATE_COLORS[family].ink, lineHeight: 1, cornerSize: 32 });
            while (ingredientText.height > layout.title.height - 150 && (ingredientText.fontSize || 10) > 14) { ingredientText.set("fontSize", (ingredientText.fontSize || 10) - 1); ingredientText.initDimensions(); }
            (ingredientText as NamedObject).layerId = "ingredients"; stage.add(ingredientText);
          }
        }
        if (!alive || !stage) return;
        const current = stage;
        const titleObject = (current.getObjects() as NamedObject[]).find(object => object.layerId === "title") as Textbox | undefined;
        if (titleObject) { setTitleFont(titleObject.fontFamily || "Fraunces Variable"); if (typeof titleObject.fill === "string" && /^#[0-9a-f]{6}$/i.test(titleObject.fill)) setTitleColor(titleObject.fill); }
        const resize = () => {
          if (!canvasHost.current) return;
          const width = Math.max(160, Math.min(560, canvasHost.current.clientWidth));
          current.setDimensions({ width: `${width}px`, height: `${Math.round(width * 1.25)}px` }, { cssOnly: true });
          current.calcOffset(); current.requestRenderAll();
        };
        observer = new ResizeObserver(resize); if (canvasHost.current) observer.observe(canvasHost.current); resize();
        current.on("selection:created", event => { const object = event.selected?.[0] as NamedObject | undefined; if (object?.layerId) setActive(object.layerId); });
        current.on("selection:updated", event => { const object = event.selected?.[0] as NamedObject | undefined; if (object?.layerId) setActive(object.layerId); });
        current.on("object:modified", () => { setNotice(""); refreshLayers(current); });
        current.on("text:changed", event => { const object = event.target as Textbox & NamedObject; setNotice(""); if (object.layerId === "title") setTitleText(object.text || ""); if (object.layerId === "ingredients") setIngredientText((object.text || "").replace(/^INGREDIENTS\n/, "")); });
        current.requestRenderAll(); refreshLayers(current); setReady(true);
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Could not open the layered editor."); }
    })();
    return () => { alive = false; observer?.disconnect(); if (stageRef.current === stage) stageRef.current = null; if (stage) void stage.dispose(); };
  }, [photo, title, ingredients, family, project]);

  function selectLayer(id: string) {
    const stage = stageRef.current, object = layer(id); if (!stage || !object) return;
    setActive(id); if (object.visible !== false && object.selectable !== false) stage.setActiveObject(object); else stage.discardActiveObject(); stage.requestRenderAll();
  }
  function toggleVisibility(id: string) {
    const stage = stageRef.current, object = layer(id); if (!stage || !object) return;
    object.set("visible", object.visible === false); stage.discardActiveObject(); stage.requestRenderAll(); setNotice(""); refreshLayers(stage);
  }
  function toggleLock(id: string) {
    const stage = stageRef.current, object = layer(id); if (!stage || !object) return;
    const unlocked = object.selectable === false; object.set({ selectable: unlocked, evented: unlocked }); stage.discardActiveObject(); stage.requestRenderAll(); setNotice(""); refreshLayers(stage);
  }
  function moveLayer(id: string, direction: 1 | -1) {
    const stage = stageRef.current, object = layer(id); if (!stage || !object) return;
    const objects = stage.getObjects(), index = objects.indexOf(object);
    stage.moveObjectTo(object, Math.max(0, Math.min(objects.length - 1, index + direction))); stage.requestRenderAll(); setNotice(""); refreshLayers(stage);
  }
  function changeTitle(value: string) {
    setTitleText(value); setNotice(""); const object = layer("title") as Textbox | undefined;
    if (object) { object.set("text", value); object.initDimensions(); object.setCoords(); stageRef.current?.requestRenderAll(); }
  }
  function changeIngredients(value: string) {
    setIngredientText(value); setNotice(""); const object = layer("ingredients") as Textbox | undefined;
    if (object) { object.set("text", `INGREDIENTS\n${value}`); object.initDimensions(); object.setCoords(); stageRef.current?.requestRenderAll(); }
  }
  async function changeTitleFont(value: string) {
    setTitleFont(value); setNotice("");
    try {
      await document.fonts?.load(`800 48px "${value}"`);
      const object = layer("title") as Textbox | undefined;
      if (object) { object.set("fontFamily", value); object.initDimensions(); object.setCoords(); stageRef.current?.requestRenderAll(); }
    } catch { setError("Could not load that title font."); }
  }
  function changeTitleColor(value: string) {
    setTitleColor(value); setNotice(""); const object = layer("title");
    if (object) { object.set("fill", value); stageRef.current?.requestRenderAll(); }
  }
  async function replaceDecoration(file?: File) {
    if (!file || !stageRef.current) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 25 * 1024 * 1024) { setError("Choose a PNG, JPG, or WebP image under 25 MB."); return; }
    try {
      const F = await import("fabric"), url = await readDataUrl(file), image = await F.FabricImage.fromURL(url);
      const stage = stageRef.current; if (!stage) return;
      const previous = layer("decoration"), index = previous ? stage.getObjects().indexOf(previous) : 0;
      if (previous) stage.remove(previous);
      const scale = Math.min(1200 / image.width, 1500 / image.height);
      image.set({ left: (1200 - image.width * scale) / 2, top: (1500 - image.height * scale) / 2, originX: "left", originY: "top", scaleX: scale, scaleY: scale, cornerSize: 32 });
      (image as NamedObject).layerId = "decoration"; stage.insertAt(index, image); stage.requestRenderAll(); refreshLayers(stage); setError(""); setNotice("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load that decoration."); }
  }
  async function save(andDownload: boolean) {
    const stage = stageRef.current; if (!stage || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      stage.discardActiveObject(); stage.renderAll();
      const blob = await stage.toBlob({ format: "png", multiplier: 1 });
      if (!blob) throw new Error("Could not export this layered design.");
      const scene = JSON.stringify(stage.toObject(["layerId", "selectable", "evented"]));
      if (scene !== lastSaved.current) {
        const savedIngredients = hasIngredients ? ingredientText : undefined;
        try { await onSave({ blob, title: titleText, ingredients: savedIngredients, project: { version: 1, scene, title: titleText, ingredients: savedIngredients } }); lastSaved.current = scene; }
        catch (reason) {
          if (andDownload) { download(blob); setError("The image was downloaded, but the editable design could not be saved to history."); return; }
          throw reason;
        }
      }
      if (andDownload) download(blob);
      setNotice("Layered design saved separately in Design History.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this layered design."); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} aria-label="Layered Design Editor" onCancel={event => { event.preventDefault(); onClose(); }}
    className="max-h-[95dvh] w-[min(97vw,1200px)] overflow-y-auto rounded-[24px] border border-[#604a36] bg-[#17120f] p-0 text-[#f3e5d4] shadow-2xl backdrop:bg-black/80">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#514131] px-5 py-4"><div><h2 className="studio-title text-2xl">Layered Design Editor</h2><p className="mt-1 text-xs text-[#b9aa98]">Move and resize the photo, title, and decoration separately.</p></div><button type="button" className={button} onClick={onClose}>Close</button></header>
    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div ref={canvasHost} className="flex min-w-0 justify-center rounded-xl bg-[#0d0a08] p-2"><canvas ref={canvasElement} aria-label="Editable recipe design canvas" /></div>
      <div className="min-w-0"><h3 className="text-xs font-semibold uppercase tracking-[.16em] text-[#d2a273]">Layers</h3><p className="mt-2 text-xs text-[#b9aa98]">Select a layer, then drag it or use its corners to resize.</p>
        <div className="mt-3 space-y-2">{layers.map(item => <div key={item.id} className={"rounded-xl border p-2 " + (active === item.id ? "border-[#c97a3d] bg-[#c97a3d]/10" : "border-[#514131]")}>
          <button type="button" className="w-full px-1 py-1 text-left text-sm font-medium" onClick={() => selectLayer(item.id)}>{item.label}</button>
          <div className="mt-1 flex flex-wrap gap-1"><button type="button" className={button + " text-xs"} onClick={() => toggleVisibility(item.id)}>{item.visible ? "Hide" : "Show"}</button><button type="button" className={button + " text-xs"} onClick={() => toggleLock(item.id)}>{item.locked ? "Unlock position" : "Lock position"}</button><button type="button" className={button + " text-xs"} aria-label={`Move ${item.label} up`} onClick={() => moveLayer(item.id, 1)}>↑</button><button type="button" className={button + " text-xs"} aria-label={`Move ${item.label} down`} onClick={() => moveLayer(item.id, -1)}>↓</button></div>
        </div>)}</div>
        <label className="mt-4 block text-xs text-[#d7c5b3]">Recipe title<textarea className={field + " mt-2"} value={titleText} rows={2} maxLength={180} disabled={!ready} onChange={event => changeTitle(event.target.value)} /></label>
        <div className="mt-3 grid grid-cols-[1fr_72px] gap-3"><label className="block text-xs text-[#d7c5b3]">Title font<select className={field + " mt-2"} value={titleFont} disabled={!ready} onChange={event => void changeTitleFont(event.target.value)}><option value="Fraunces Variable">Classic serif</option><option value="Rokkitt Variable">Slab serif</option><option value="Archivo Narrow Variable">Diner</option><option value="Special Elite">Typewriter</option></select></label><label className="block text-xs text-[#d7c5b3]">Title color<input type="color" className="mt-2 h-[42px] w-full cursor-pointer rounded border border-[#514131] bg-[#17120f] p-1" value={titleColor} disabled={!ready} onChange={event => changeTitleColor(event.target.value)} /></label></div>
        {hasIngredients && <label className="mt-3 block text-xs text-[#d7c5b3]">Ingredients<textarea className={field + " mt-2"} value={ingredientText} rows={5} maxLength={2000} disabled={!ready} onChange={event => changeIngredients(event.target.value)} /></label>}
        <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload a decoration" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void replaceDecoration(file); }} />
        <button type="button" className={button + " mt-3 w-full"} disabled={!ready} onClick={() => uploadRef.current?.click()}>Upload a decoration</button>
        <p className="mt-3 text-xs leading-relaxed text-[#b9aa98]">Your original photo and generated designs stay unchanged. Layers do not guarantee removal of AI provenance signals.</p>
        {!ready && !error && <p role="status" className="mt-3 text-xs text-[#b9aa98]">Preparing the layers…</p>}{error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}{notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}
        <button type="button" disabled={!ready || busy} onClick={() => void save(true)} className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#f3e5d4] to-[#c97a3d] px-4 py-3 text-sm font-semibold text-[#221912] hover:brightness-110 disabled:opacity-40">{busy ? "Saving…" : "Download layered PNG"}</button>
        <button type="button" disabled={!ready || busy} onClick={() => void save(false)} className={button + " mt-2 w-full"}>Save editable design</button>
      </div>
    </div>
  </dialog>;
}
