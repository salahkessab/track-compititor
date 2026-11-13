"use client";

import { randomFramingsForHorseScene } from "@/lib/horseSceneGuidance";

import { PAIR_DIRECTION_COUNT } from "@/lib/openaiPrompt";
import { OpenAIImageControls } from "./components/OpenAIImageControls";
import { RecipeImageToImage } from "./components/RecipeImageToImage";
import { RecipeTwoInOne } from "./components/RecipeTwoInOne";
import { RecipeDesigns } from "./components/RecipeDesigns";
import { HomeDecor } from "./components/HomeDecor";
import { prepareClientImage } from "@/lib/preparedImageClient";
import { VerifiedImage, ImagePreparationNotifications } from './components/VerifiedImage';
import { RecipeIntelligence } from "./components/RecipeIntelligence";
import { ImageFilterStudio } from "./components/ImageFilterStudio";
import { DEFAULT_IMAGE_SETTINGS, isOpenAIImageModel, imageQualitiesFor, supportsImageComplexity, type OpenAIImageSettings } from "@/lib/openaiImageSettings";
import { readGenerationResponse } from "@/lib/generationResponse";
import { estimateOpenAIImageOutput, openAIOutputExamples, previewUnitCost } from "@/lib/imagePricing";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  OPENAI_MODELS,
  BATCH_OPTIONS,
  FRAMINGS,
  IMG2IMG_STRENGTHS,
  ALL_IMAGE_MODELS,
  DEFAULT_RECIPE_DESIGNED_IMAGE_MODEL,
  imageModelsFor,
  DEFAULT_IMAGE_MODEL,
  type Framing,
  estimateImageCost,
  PRICING,
} from "@/lib/config";
import {
  DEFAULT_RECIPE_PIN_STYLE,
  RECIPE_PIN_STYLES,
  type RecipePinStyle,
} from "@/lib/recipePinStyles";
const MAX_REFS = 5;
const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

type Workflow = "openai";

type RefImage = { id: string; dataUrl: string; name: string };

type SceneMode =
  | "auto" | "foal" | "couple" | "blackwhite" | "black"
  | "appaloosa" | "arabian" | "andalusian" | "palomino" | "paint"
  | "mustang" | "white" | "buckskin" | "chestnut" | "haflinger"
  | "mural" | "funny" | "western"
  | "dreamy_greeting" | "art_blessing" | "fantasy_floral" | "horse_wall_painting"
  // Emotion
  | "friendship" | "protective" | "owner_bond" | "horse_human_bond" | "gentle_eye" | "lonely" | "tender"
  // Action
  | "running" | "herd" | "jumping" | "dusty_run" | "windy_mane" | "splashing" | "river_crossing" | "beach_running" | "wild_motion" | "walking"
  // Funny / Curiosity
  | "yawning" | "big_nose" | "messy_forelock" | "side_eye" | "barn_peek" | "rolling" | "tongue_out" | "curious"
  // Beauty / Premium
  | "golden_hour" | "snow" | "autumn" | "misty" | "black_bg" | "silhouette" | "cinematic" | "eye" | "bokeh" | "dramatic_mane" | "appaloosa_wildflowers" | "black_horse_rain"
  // Western / Ranch
  | "cowboy" | "pasture" | "fence" | "barn" | "buttes" | "mountain" | "rodeo" | "farm_sunrise" | "prairie" | "dusty_sunset";

// Selectable scene categories â€” a single clean flat row of chips. Each image is
// randomly drawn from the chips you select; the variety (breed, pose, setting,
// light, mood, camera, caption) is randomized behind the scenes in sceneSeed.ts.
const SCENE_MODES: { value: SceneMode; label: string }[] = [
  { value: "foal", label: "Mare & foal" },
  { value: "couple", label: "Couples" },
  { value: "friendship", label: "Horse friendship" },
  { value: "blackwhite", label: "Black & white pair" },
  { value: "black", label: "Black horse (Friesian)" },
  { value: "white", label: "White horse" },
  { value: "appaloosa", label: "Appaloosa" },
  { value: "arabian", label: "Arabian" },
  { value: "andalusian", label: "Andalusian (grey)" },
  { value: "palomino", label: "Palomino" },
  { value: "paint", label: "Paint horse" },
  { value: "buckskin", label: "Buckskin" },
  { value: "chestnut", label: "Chestnut" },
  { value: "haflinger", label: "Haflinger" },
  { value: "mustang", label: "Mustang" },
  { value: "running", label: "Running horse" },
  { value: "dusty_run", label: "Dusty ranch run" },
  { value: "golden_hour", label: "Golden hour" },
  { value: "snow", label: "Snow horse" },
  { value: "eye", label: "Close-up eye" },
  { value: "big_nose", label: "Big nose close-up" },
  { value: "barn_peek", label: "Peeking from barn" },
  { value: "barn", label: "Barn scene" },
  { value: "buttes", label: "Desert buttes" },
  { value: "mural", label: "Giant horse mural" },
  { value: "dreamy_greeting", label: "Dreamy / greeting" },
  { value: "art_blessing", label: "Art / blessing" },
  { value: "fantasy_floral", label: "Fantasy / floral" },
  { value: "funny", label: "Funny / playful" },
  { value: "western", label: "Western / ranch" },
  { value: "horse_human_bond", label: "Horse & human bond" },
  { value: "river_crossing", label: "River crossing" },
  { value: "appaloosa_wildflowers", label: "Appaloosa in wildflowers" },
  { value: "black_horse_rain", label: "Black horse in the rain" },
  { value: "horse_wall_painting", label: "Horse wall painting" },
  { value: "beach_running", label: "Running horse on the beach" },
];

type ContentType = "horses" | "recipes" | "fashion";
const MAIN_TABS = [
  { id: "horses", label: "🐴 Horses", contentType: "horses" },
  { id: "recipe-designs", label: "Recipe Designs", contentType: "recipes", workflow: "designs" },
  { id: "image-to-image", label: "Image to Image", contentType: "recipes", workflow: "imageToImage" },
  { id: "two-in-one", label: "2 in one image", contentType: "recipes", workflow: "twoInOne" },
  { id: "recipe-intelligence", label: "Recipe Intelligence", contentType: "recipes", workflow: "intelligence" },
  { id: "home-decor", label: "Home & Decor", contentType: "recipes", workflow: "decor" },
] as const;
const RECIPE_MODES: { value: string; label: string }[] = [
  { value: "dessert", label: "Desserts & sweets" },
  { value: "comfort", label: "Comfort food" },
  { value: "healthy", label: "Healthy / fresh" },
  { value: "breakfast", label: "Breakfast" },
  { value: "dinner", label: "Dinner mains" },
  { value: "soup", label: "Soups & stews" },
  { value: "baking", label: "Baking & bread" },
  { value: "pasta", label: "Pasta" },
  { value: "chicken", label: "Chicken" },
  { value: "beef", label: "Beef" },
  { value: "seafood", label: "Seafood" },
  { value: "drink", label: "Drinks" },
];

// Fashion categories
const FASHION_MODES: { value: string; label: string }[] = [
  { value: "robe", label: "Robes" },
  { value: "chemisier", label: "Chemisiers" },
  { value: "top", label: "Tops" },
  { value: "pantalon", label: "Pantalons" },
  { value: "ensemble", label: "Ensembles" },
  { value: "pull", label: "Pulls" },
  { value: "gilet", label: "Gilets" },
  { value: "chaussures", label: "Chaussures" },
  { value: "sac", label: "Sacs" },
  { value: "veste", label: "Vestes" },
  { value: "casual_chic", label: "Look casual chic" },
  { value: "elegant", label: "Look Ã©lÃ©gant" },
  { value: "urbain", label: "Look urbain" },
  { value: "minimaliste", label: "Look minimaliste" },
  { value: "ete", label: "Look Ã©tÃ©" },
  { value: "automne", label: "Look automne" },
  { value: "produit_seul", label: "Produit seul" },
  { value: "exterieur", label: "ModÃ¨le en extÃ©rieur" },
  { value: "interieur", label: "ModÃ¨le en intÃ©rieur" },
];

// No categories selected by default â€” an empty selection uses the full auto mix.
const DEFAULT_HORSE_MODES: string[] = [];
const DEFAULT_RECIPE_MODES: string[] = [];
const DEFAULT_FASHION_MODES: string[] = [];

type Item = {
  idea: string;
  prompt: string;
  description: string;
  firstComment?: string;
  title?: string;
  location?: string;
  referenceStrategy?: string;
  contentType?: string;
  viralHook?: string;
  winningElements?: string;
  whyStrong?: string;
  engagementScore?: string;
  rpmScore?: string;
  altText?: string;
  recipeStyle?: string;
  trendSource?: string;
  trendAngle?: string;
  imageUrl: string;
  provider: Workflow;
  model: string;
  falModel: string;
  cost: number;
  textCost?: number;
  imageCost?: number | null;
  searchCost?: number;
  costIncomplete?: boolean;
  imageCostIncluded?: boolean;
  imageSettings?: OpenAIImageSettings;
  renderedPrompt?: string;
  createdAt: string;
  analysis?: string;
  usedReference: boolean;
  viralScore?: "high" | "medium" | "low";
  viralReason?: string;
  seed?: {
    setting?: string;
    breed?: string;
    mood?: string;
    light?: string;
    action?: string;
    tone?: string;
    sceneType?: string;
  };
};

// Framing pool for "Random (varied)" â€” weighted toward the engaging close
// shots (eye / close-up / portrait appear twice) while still mixing in wider ones.
const RANDOM_FRAMING_POOL: Framing[] = [
  "eye", "eye", "closeup", "closeup", "portrait", "portrait", "half", "full", "wide",
];

// Fisher-Yates shuffle (returns a new array)
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Resize an image file to max 768px and return a JPEG base64 data URL
async function resizeToBase64(file: File, maxDim = 768): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function imageDownloadName(url: string): string {
  const format = /^data:image\/(png|jpeg|webp);/.exec(url)?.[1] || "png";
  return `image-${Date.now()}.${format}`;
}

function proxiedImageUrl(url: string): string {
  return url.startsWith("data:image/") ? url : `/api/download?url=${encodeURIComponent(url)}`;
}

// True only on real phones/tablets. Used to decide between the native share
// sheet (mobile â€” saves to gallery) and a direct file download (desktop).
function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as any).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") return uaData.mobile;
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
  const touch = navigator.maxTouchPoints > 0;
  return (!!coarse && touch) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export default function Page() {
  const workflow: Workflow = "openai";
  const [openaiModel, setOpenaiModel] = useState<string>(OPENAI_MODELS[0]);
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL);
  const [imageSettings, setImageSettings] = useState<OpenAIImageSettings>({ ...DEFAULT_IMAGE_SETTINGS, size: "1152x1440" });
  const [partialPreview, setPartialPreview] = useState<string | null>(null);
  const openAIImage = isOpenAIImageModel(imageModel);
  useEffect(() => {
    const supportedQualities = imageQualitiesFor(imageModel);
    if (openAIImage && !supportedQualities.includes(imageSettings.quality)) {
      setImageSettings((current) => ({ ...current, quality: supportedQualities.includes(DEFAULT_IMAGE_SETTINGS.quality) ? DEFAULT_IMAGE_SETTINGS.quality : supportedQualities[0] }));
    }
  }, [imageModel, imageSettings.quality, openAIImage]);
  useEffect(() => {
    if (!supportsImageComplexity(imageModel) && imageSettings.complexity && imageSettings.complexity !== "default") {
      setImageSettings((current) => ({ ...current, complexity: "default" }));
    }
  }, [imageModel, imageSettings.complexity]);
  const [count, setCount] = useState<number>(1);
  const [countRaw, setCountRaw] = useState<string>("1");
  const [contentType, setContentType] = useState<ContentType>("horses");
  const [recipeWorkflow, setRecipeWorkflow] = useState<"designs" | "imageToImage" | "twoInOne" | "intelligence" | "decor">("designs");
  const showRecipeImageToImage = contentType === "recipes" && recipeWorkflow === "imageToImage";
  const [modes, setModes] = useState<Set<string>>(new Set(DEFAULT_HORSE_MODES));
  const [customSubject, setCustomSubject] = useState<string>("");
  const [framing, setFraming] = useState<Framing>("random");
  const [captionLength, setCaptionLength] = useState<string>("fb");
  const [wantFirstComment, setWantFirstComment] = useState<boolean>(false);
  const [designPin, setDesignPin] = useState<boolean>(true);
  const [recipePinStyle, setRecipePinStyle] = useState<RecipePinStyle>(DEFAULT_RECIPE_PIN_STYLE);
  const [trendResearch, setTrendResearch] = useState<boolean>(false);
  const [imgStrength, setImgStrength] = useState<number>(0.7);
  const [copied, setCopied] = useState<string | null>(null);
  const [lastCopiedCaptionId, setLastCopiedCaptionId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const recipeDesignPinLocked = contentType === "recipes" && designPin;
  const availableImageModels = imageModelsFor(contentType, recipeDesignPinLocked);

  function copyText(text: string, tag: string) {
    // execCommand must run synchronously inside the user gesture â€” any prior
    // await breaks the gesture context on iOS Chrome and makes it fail.
    // So we try execCommand first (sync), then async clipboard API as fallback.
    let ok = false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    document.body.removeChild(ta);

    if (!ok) {
      // Async clipboard API fallback (desktop browsers, modern Android Chrome)
      navigator.clipboard?.writeText(text).catch(() => {});
      ok = true;
    }
    setCopied(tag);
    setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1200);
  }

  function copyCaption(item: Item) {
    copyText(item.description, `${item.imageUrl}:cap`);
    setLastCopiedCaptionId(item.imageUrl);
  }

  const sceneChips =
    contentType === "recipes" ? RECIPE_MODES :
    contentType === "fashion" ? FASHION_MODES :
    SCENE_MODES;

  const switchContentType = useCallback((t: ContentType) => {
    if (t === contentType) return;
    setContentType(t);
    setModes(new Set(
      t === "recipes" ? DEFAULT_RECIPE_MODES :
      t === "fashion" ? DEFAULT_FASHION_MODES :
      DEFAULT_HORSE_MODES
    ));
    // If the current image model isn't offered on the new tab, reset to its default.
    const allowed = imageModelsFor(t, t === "recipes" ? designPin : false);
    if (!allowed.some((m) => m.value === imageModel)) {
      setImageModel(allowed[0].value);
    }
  }, [contentType, designPin, imageModel]);

  function toggleMode(v: string) {
    setError(null);
    setModes((prev) => {
      const n = new Set(prev);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  }
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ url: string; alt: string } | null>(null);
  const [previewPinned, setPreviewPinned] = useState(false);
  const navigationInitialized = useRef(false);
  useEffect(() => {
    const selectFromUrl = () => {
      const id = new URLSearchParams(window.location.search).get("tab");
      const tab = MAIN_TABS.find((item) => item.id === id) || MAIN_TABS[0];
      switchContentType(tab.contentType);
      if ("workflow" in tab) {
        setRecipeWorkflow(tab.workflow);
        setPreview(null);
        setPreviewPinned(false);
      }
    };
    if (!navigationInitialized.current) { navigationInitialized.current = true; selectFromUrl(); }
    window.addEventListener("popstate", selectFromUrl);
    return () => window.removeEventListener("popstate", selectFromUrl);
  }, [switchContentType]);
  const [filterTarget, setFilterTarget] = useState<{ url: string; fileName: string } | null>(null);
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [expandedAnalysis, setExpandedAnalysis] = useState<Set<string>>(new Set());
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());

  const totalCost = items.reduce((s, i) => s + (i.cost || 0), 0);
  const selectedRows = selected.size ? items.filter((i) => selected.has(i.imageUrl)) : items;
  const highPotential = items.filter((i) => i.viralScore === "high").length;
  const averageCost = items.length ? totalCost / items.length : 0;
  const averageCaptionLength = items.length
    ? Math.round(items.reduce((s, i) => s + (i.description?.length || 0), 0) / items.length)
    : 0;

  // â”€â”€ Checkbox helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function toggleOne(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.imageUrl))
    );
  }
  const allChecked = items.length > 0 && selected.size === items.length;

  // â”€â”€ Reference image helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleAddRefs = useCallback(async (files: FileList | File[]) => {
    const remaining = MAX_REFS - refs.length;
    if (remaining <= 0) return;
    const accepted = Array.from(files)
      .filter((f) => ACCEPTED_TYPES.includes(f.type))
      .slice(0, remaining);
    if (!accepted.length) return;
    try {
      const resized = await Promise.all(accepted.map((f) => resizeToBase64(f)));
      setRefs((prev) => [
        ...prev,
        ...resized.map((dataUrl, i) => ({
          id: `${Date.now()}-${i}`,
          dataUrl,
          name: accepted[i].name,
        })),
      ]);
    } catch (e) {
      console.error("Failed to process reference image:", e);
    }
  }, [refs.length]);

  function removeRef(id: string) {
    setRefs((prev) => prev.filter((r) => r.id !== id));
  }

  // â”€â”€ Cost estimates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const activeModel = openaiModel;
  const imageOutputEstimate = openAIImage
    ? estimateOpenAIImageOutput(imageModel, imageSettings.size, imageSettings.quality)
    : refs.length === 1 && (contentType === "horses" || contentType === "fashion")
      ? null : estimateImageCost(imageModel);
  const outputExamples = openAIImage && imageSettings.quality === "auto"
    ? openAIOutputExamples(imageModel, imageSettings) : null;
  const textRates = PRICING.text[activeModel];
  const previewPrice = openAIImage ? previewUnitCost(imageModel) : null;

  // â”€â”€ Generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function waitForVisible(): Promise<void> {
    if (typeof document === "undefined" || !document.hidden) return Promise.resolve();
    return new Promise((resolve) => {
      const handler = () => {
        if (!document.hidden) {
          document.removeEventListener("visibilitychange", handler);
          resolve();
        }
      };
      document.addEventListener("visibilitychange", handler);
    });
  }

  async function generateOne(prev: Item[], chosenMode: string, chosenFraming: Framing, batchOffset: number): Promise<Item> {
    const seeds = prev.map((p) => p.seed).filter(Boolean) as NonNullable<Item["seed"]>[];
    const used = {
      settings: seeds.map((s) => s.setting).filter(Boolean) as string[],
      breeds:   seeds.map((s) => s.breed).filter(Boolean) as string[],
      moods:    seeds.map((s) => s.mood).filter(Boolean) as string[],
      lights:   seeds.map((s) => s.light).filter(Boolean) as string[],
      actions:  seeds.map((s) => s.action).filter(Boolean) as string[],
      tones:    seeds.map((s) => s.tone).filter(Boolean) as string[],
      sceneTypes: seeds.map((s) => s.sceneType).filter(Boolean) as string[],
    };
    const openers = prev
      .map((p) => p.description.split(/\s+/).slice(0, 4).join(" "))
      .filter(Boolean);
    const ideas = prev.map((p) => p.idea).filter(Boolean);
    // Final engagement question of each previous caption (to avoid repeats).
    const questions = prev
      .map((p) => {
        const m = p.description.trim().match(/([^\n.!?]*\?)\s*$/);
        return m ? m[1].trim() : "";
      })
      .filter(Boolean);

    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({
        workflow,
        model: activeModel,
        used,
        avoid: { ideas, openers, questions },
        references: (contentType === "horses" || contentType === "fashion") && refs.length ? refs.map((r) => r.dataUrl) : undefined,
        sceneMode: chosenMode,
        customSubject: customSubject.trim() || undefined,
        framing: contentType === "horses" ? chosenFraming : undefined,
        captionLength,
        firstComment: wantFirstComment,
        contentType,
        designPin: contentType === "recipes" ? designPin : false,
        recipePinStyle: contentType === "recipes" ? recipePinStyle : undefined,
        trendResearch: contentType === "recipes" ? trendResearch : false,
        imgStrength,
        imageModel,
        imageSettings: openAIImage ? imageSettings : undefined,
        batchIndex: prev.length,
        batchOffset,
      }),
    });
    const data = await readGenerationResponse(r, setPartialPreview);
    return {
      idea:          data.idea,
      prompt:        data.prompt,
      description:   data.description,
      firstComment:  data.firstComment,
      title:         data.title,
      location:      data.location,
      referenceStrategy: data.referenceStrategy,
      contentType:   data.contentType,
      viralHook:     data.viralHook,
      winningElements: data.winningElements,
      whyStrong:     data.whyStrong,
      engagementScore: data.engagementScore,
      rpmScore:      data.rpmScore,
      altText:       data.altText,
      recipeStyle:   data.recipeStyle,
      trendSource:   data.trendSource,
      trendAngle:    data.trendAngle,
      imageUrl:      data.imageUrl,
      provider:      workflow,
      model:         data.model ?? activeModel,
      falModel:      data.falModel ?? "",
      cost:          Number(data.cost ?? 0),
      textCost:      data.textCost,
      imageCost:     data.imageCost,
      searchCost:    data.searchCost,
      costIncomplete: data.costIncomplete,
      imageCostIncluded: data.imageCostIncluded,
      imageSettings: data.imageSettings,
      renderedPrompt: data.renderedPrompt,
      createdAt:     new Date().toISOString(),
      analysis:      data.analysis,
      usedReference: !!data.usedReference,
      viralScore:    data.viralScore,
      viralReason:   data.viralReason,
      seed:          data.seed,
    };
  }

  async function generate() {
    // Require a scene focus unless a reference image is driving the scene.
    const refDriven = (contentType === "horses" || contentType === "fashion") && refs.length > 0;
    if (modes.size === 0 && !refDriven) {
      setError(
        contentType === "recipes"
          ? "Please pick at least one food category before generating."
          : contentType === "fashion"
          ? "Veuillez choisir au moins une categorie mode avant de generer."
          : "Please pick at least one Scene focus before generating."
      );
      return;
    }

    if (count >= 10) {
      const ok = window.confirm(
        "This will generate multiple images and may use more API credit. Continue?"
      );
      if (!ok) return;
    }

    setLoading(true);
    setError(null);
    setItems([]);
    setSelected(new Set());
    setPreview(null);
    setPreviewPinned(false);
    setExpandedAnalysis(new Set());
    setExpandedPrompts(new Set());
    setLastCopiedCaptionId(null);
    setProgress({ done: 0, total: count });

    // Keep screen awake on mobile while generating (prevents iOS suspension on screen-off).
    let wakeLock: any = null;
    try {
      if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
        wakeLock = await (navigator as any).wakeLock.request("screen");
      }
    } catch { /* wake lock not supported or denied â€” safe to ignore */ }

    try {
      // Round-robin across the selected categories (shuffled order) so a batch
      // spreads evenly instead of clumping on one category.
      const pool: string[] = modes.size ? shuffle(Array.from(modes)) : ["auto"];
      // When framing is "Random", roll a real framing per image (shuffled
      // round-robin) so the batch gets a varied, even spread of shots.
      // For reference-driven horse images, Random leaves the reference crop
      // alone; an explicitly chosen crop can still override it.
      const framingPool = framing === "random" && !(contentType === "horses" && refs.length > 0)
        ? shuffle(RANDOM_FRAMING_POOL) : null;
      const results: Item[] = [];
      const batchOffset = Math.floor(Math.random() * PAIR_DIRECTION_COUNT);
      for (let i = 0; i < count; i++) {
        // Wait for the tab to be visible before starting each image.
        // If the user minimized the app, this pauses here and resumes
        // automatically when they come back â€” no generation is lost.
        await waitForVisible();

        const chosenMode = pool[i % pool.length];
        // Keep random crops compatible with the chosen scene; explicit framing wins.
        const compatibleFramings = framingPool && contentType === "horses" && refs.length === 0
          ? randomFramingsForHorseScene(chosenMode, framingPool) as Framing[] : framingPool;
        const chosenFraming: Framing = compatibleFramings?.length
          ? compatibleFramings[i % compatibleFramings.length]
          : framing;

        // A lost response may still incur provider charges. Retry only by user action.
        setPartialPreview(null);
        const item = await generateOne(results, chosenMode, chosenFraming, batchOffset);
        results.push(item!);
        setItems([...results]);
        setProgress({ done: i + 1, total: count });
      }
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
      setProgress(null);
      setPartialPreview(null);
      try { wakeLock?.release(); } catch { /* ignore */ }
    }
  }

  // â”€â”€ Item actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function deleteItem(url: string) {
    setItems((prev) => prev.filter((p) => p.imageUrl !== url));
    setSelected((prev) => { const n = new Set(prev); n.delete(url); return n; });
    setExpandedAnalysis((prev) => { const n = new Set(prev); n.delete(url); return n; });
    setExpandedPrompts((prev) => { const n = new Set(prev); n.delete(url); return n; });
    setPreview((p) => (p?.url === url ? null : p));
    if (preview?.url === url) setPreviewPinned(false);
    setLastCopiedCaptionId((prev) => (prev === url ? null : prev));
  }

  // Regenerate just the caption for an existing image (no new render).
  async function regenerateCaption(item: Item) {
    setRegenerating((prev) => new Set(prev).add(item.imageUrl));
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          captionOnly: true,
          workflow,
          model: activeModel,
          idea: item.idea,
          prompt: item.prompt,
          sceneType: item.seed?.sceneType,
          tone: item.seed?.tone,
          captionLength,
          firstComment: wantFirstComment,
          contentType,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      setItems((prev) =>
        prev.map((p) =>
          p.imageUrl === item.imageUrl
            ? {
                ...p,
                description: data.description ?? p.description,
                firstComment: data.firstComment,
                cost: p.cost + Number(data.cost ?? 0),
                textCost: (p.textCost ?? 0) + Number(data.textCost ?? 0),
                costIncomplete: p.costIncomplete || !!data.costIncomplete,
              }
            : p
        )
      );
    } catch (e: any) {
      setError(e.message || "Caption regeneration failed");
    } finally {
      setRegenerating((prev) => { const n = new Set(prev); n.delete(item.imageUrl); return n; });
    }
  }

  function deleteBulk() {
    if (selected.size) {
      if (!window.confirm(`Delete ${selected.size} selected image${selected.size > 1 ? "s" : ""}?`)) return;
      setItems((prev) => prev.filter((p) => !selected.has(p.imageUrl)));
      setLastCopiedCaptionId((prev) => (prev && selected.has(prev) ? null : prev));
      setSelected(new Set());
      setExpandedPrompts((prev) => {
        const n = new Set(prev);
        selected.forEach((url) => n.delete(url));
        return n;
      });
    } else {
      if (!window.confirm(`Delete all ${items.length} images?`)) return;
      setItems([]);
      setSelected(new Set());
      setExpandedPrompts(new Set());
      setLastCopiedCaptionId(null);
    }
    setPreview(null);
    setPreviewPinned(false);
  }

  async function downloadImage(url: string) {
    const proxyUrl = proxiedImageUrl(url);
    try {
      const resp = await fetch(proxyUrl);
      if (!resp.ok) throw new Error("Could not download the original image.");
      const blob = (await prepareClientImage(await resp.blob())).blob;
      // Mobile browsers can save the unchanged image through their share sheet.
      if (isMobileDevice() && typeof navigator !== "undefined" && typeof navigator.share === "function") {
        const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
        const file = new File([blob], `image-${Date.now()}.${ext}`, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file] }); return; }
          catch (error) { if (error instanceof Error && error.name === "AbortError") return; }
        }
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
      a.download = `image-${Date.now()}.${extension}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) setError(error instanceof Error ? error.message : "Could not download the original image.");
    }
  }

  function directDownloadImage(url: string) {
    const a = document.createElement("a");
    a.href = proxiedImageUrl(url);
    a.download = imageDownloadName(url);
    a.click();
  }

  function downloadCSV() {
    const rows = selectedRows;
    if (!rows.length) return;
    if (rows.some((row) => row.imageUrl.startsWith("data:"))) {
      setError("Posting CSV requires hosted image URLs. Configure optional FAL_KEY storage, or download the images and JSON instead.");
      return;
    }
    const escape = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    if (contentType === "fashion") {
      const header = "media_url,message,post_type,comment";
      const csv = header + "\n" + rows
        .map((i) => [i.imageUrl, i.description, "photo", i.firstComment ?? ""].map(escape).join(","))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `fashion-${Date.now()}.csv`;
      a.click();
    } else {
      const header = "media_url,message,post_type,comment";
      const csv = header + "\n" + rows
        .map((i) => [i.imageUrl, i.description, "photo", i.firstComment ?? ""].map(escape).join(","))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `horses-${Date.now()}.csv`;
      a.click();
    }
  }

  function downloadJSON() {
    if (!selectedRows.length) return;
    const payload = selectedRows.map((i, index) => ({
      index: index + 1,
      imageUrl: i.imageUrl,
      caption: i.description,
      firstComment: i.firstComment ?? "",
      prompt: i.renderedPrompt || i.prompt,
      idea: i.idea,
      provider: i.provider,
      textModel: i.model,
      imageModel: i.falModel,
      cost: i.cost,
      textCost: i.textCost,
      imageCost: i.imageCost,
      searchCost: i.searchCost,
      costIncomplete: i.costIncomplete,
      imageCostIncluded: i.imageCostIncluded,
      imageSettings: i.imageSettings,
      viralScore: i.viralScore ?? "",
      viralReason: i.viralReason ?? "",
      location: i.location ?? "",
      createdAt: i.createdAt,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${contentType}-batch-${Date.now()}.json`;
    a.click();
  }

  function copySelectedCaptions() {
    if (!selectedRows.length) return;
    const text = selectedRows
      .map((i, idx) => {
        const lines = [`Post ${idx + 1}`, i.description];
        if (i.firstComment) lines.push(`First comment: ${i.firstComment}`);
        return lines.join("\n\n");
      })
      .join("\n\n---\n\n");
    copyText(text, "bulk-captions");
  }

  async function downloadSelectedImages() {
    const rows = selectedRows;
    if (!rows.length) return;
    // On mobile, avoid the native bulk-share popup entirely so the user stays
    // in the app and can return to the captions/results screen right away.
    if (isMobileDevice()) {
      rows.forEach((i, idx) => setTimeout(() => directDownloadImage(i.imageUrl), idx * 400));
      return;
    }
    // Desktop fallback
    rows.forEach((i, idx) => setTimeout(() => downloadImage(i.imageUrl), idx * 250));
  }

  function toggleAnalysis(url: string) {
    setExpandedAnalysis((prev) => {
      const n = new Set(prev);
      if (n.has(url)) n.delete(url); else n.add(url);
      return n;
    });
  }

  function togglePrompt(url: string) {
    setExpandedPrompts((prev) => {
      const n = new Set(prev);
      if (n.has(url)) n.delete(url); else n.add(url);
      return n;
    });
  }

  return (
    <main className="studio-main mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
      <ImagePreparationNotifications />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[220px] bg-[radial-gradient(circle_at_top,rgba(201,122,61,0.12),transparent_55%)]" />
      <div className="pointer-events-none absolute right-0 top-20 -z-10 h-56 w-56 rounded-full bg-green-50/8 blur-3xl" />

      <nav aria-label="Main navigation" className="mb-5 inline-flex max-w-full flex-wrap items-center gap-2 rounded-[20px] border border-gray-200 bg-white/92 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.22)]">
        {MAIN_TABS.map((tab) => {
          const active = contentType === tab.contentType &&
            (!("workflow" in tab) || recipeWorkflow === tab.workflow);
          return (
            <a
              key={tab.id}
              href={`/?tab=${tab.id}`}
              aria-current={active ? "page" : undefined}
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                const url = new URL(window.location.href);
                if (url.searchParams.get("tab") !== tab.id) {
                  url.searchParams.set("tab", tab.id);
                  window.history.pushState(null, "", url);
                }
                switchContentType(tab.contentType);
                if ("workflow" in tab) {
                  setRecipeWorkflow(tab.workflow);
                  setPreview(null);
                  setPreviewPinned(false);
                }
              }}
              className={`whitespace-nowrap rounded-[14px] px-4 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-blue-600 text-white shadow-[0_12px_30px_rgba(243,229,212,0.18)]"
                  : "text-gray-600 hover:bg-gray-100 hover:text-blue-700"
              }`}
            >
              {tab.label}
            </a>
          );
        })}
      </nav>

      {/* â”€â”€ Settings panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div hidden={!showRecipeImageToImage}>
        <RecipeImageToImage />
      </div>
      <div hidden={contentType !== "recipes" || recipeWorkflow !== "twoInOne"}>
        <RecipeTwoInOne />
      </div>
      <div hidden={contentType !== "recipes" || recipeWorkflow !== "designs"}>
        <RecipeDesigns />
      </div>
      <HomeDecor active={contentType === "recipes" && recipeWorkflow === "decor"} />
      <div hidden={contentType !== "recipes" || recipeWorkflow !== "intelligence"}>
        <RecipeIntelligence active={contentType === "recipes" && recipeWorkflow === "intelligence"} />
      </div>
      <div hidden={contentType === "recipes"}>
      <section className="studio-panel mb-4 grid gap-4 rounded-[28px] p-5 sm:p-6 sm:grid-cols-2 md:grid-cols-4">
        {contentType !== "recipes" && (
          <Field label="Provider">
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900">
              OpenAI only
            </div>
          </Field>
        )}

        <Field label="Text model">
          <Select value={openaiModel} onChange={setOpenaiModel} options={OPENAI_MODELS} />
        </Field>

        <Field label="Image model">
          <select
            value={imageModel}
            onChange={(e) => setImageModel(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
          >
            {availableImageModels.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}{m.price === null ? " · OpenAI" : ` - $${m.price.toFixed(3)}/img`}
              </option>
            ))}
          </select>
        </Field>

        {contentType === "recipes" && designPin && (
          <Field label="Recipe Post Style">
            <select
              value={recipePinStyle}
              onChange={(e) => setRecipePinStyle(e.target.value as RecipePinStyle)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            >
              {RECIPE_PIN_STYLES.map((style) => (
                <option key={style.value} value={style.value}>
                  {style.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Number of images">
          <div className="flex gap-2">
            <div className="flex gap-1 rounded-xl bg-white p-1">
              {BATCH_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => { setCount(n); setCountRaw(String(n)); }}
                  className={`rounded-md px-2.5 py-1 text-xs transition ${
                    count === n ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100 hover:text-blue-700"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              inputMode="numeric"
              type="number"
              min={1}
              max={50}
              value={countRaw}
              onChange={(e) => { setCountRaw(e.target.value); }}
              onBlur={(e) => {
                const n = Math.floor(Number(e.target.value));
                const clamped = Number.isFinite(n) && n >= 1 ? Math.min(50, n) : 1;
                setCount(clamped);
                setCountRaw(String(clamped));
              }}
              title="Or type any number (1-50)"
              className="w-16 rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />
          </div>
        </Field>

        {contentType !== "recipes" && (
          <Field label={
            contentType === "fashion" ? "Sujet personnalisÃ© (optionnel)" :
            "Custom subject (optional)"
          }>
            <input
              type="text"
              value={customSubject}
              onChange={(e) => { setCustomSubject(e.target.value); }}
              placeholder={
                contentType === "fashion" ? "ex: robe satinÃ©e blanche dans une rue parisienne" :
                "e.g. two palomino horses nose to nose"
              }
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-600 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />
          </Field>
        )}

        {contentType === "horses" && (
          <Field label="Camera framing">
            <select
              value={framing}
              onChange={(e) => { setFraming(e.target.value as Framing); }}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            >
              {FRAMINGS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {contentType === "recipes" && (
          <Field label="Designed pin (title in image)">
            <button
              onClick={() => {
                setDesignPin((v) => {
                  const next = !v;
                  if (next) setImageModel(DEFAULT_RECIPE_DESIGNED_IMAGE_MODEL);
                  else if (imageModelsFor("recipes", true).some((m) => m.value === imageModel)) {
                    setImageModel(imageModelsFor("recipes", false)[0].value);
                  }
                  return next;
                });
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm transition ${
                designPin
                  ? "border-blue-600 bg-blue-600/15 text-blue-700"
                  : "border-gray-200 bg-white text-gray-600 hover:text-gray-900"
              }`}
            >
              {designPin ? "On - pin with title text" : "Off - plain food photo"}
            </button>
          </Field>
        )}

        {contentType === "recipes" && (
          <Field label="Trend Research">
            <button
              onClick={() => { setTrendResearch((v) => !v); }}
              className={`w-full rounded-lg border px-3 py-2 text-sm transition ${
                trendResearch
                  ? "border-blue-600 bg-blue-600/15 text-blue-700"
                  : "border-gray-200 bg-white text-gray-600 hover:text-gray-900"
              }`}
            >
              {trendResearch ? "On - research current trend angles first" : "Off"}
            </button>
          </Field>
        )}

        <Field label="Caption length">
          <select
            value={captionLength}
            onChange={(e) => { setCaptionLength(e.target.value); }}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
          >
            <option value="fb">Facebook optimized (200-400 chars)</option>
            <option value="story">Long storytelling (by scene)</option>
          </select>
        </Field>

        {contentType !== "recipes" && (
          <Field label="First comment">
            <button
              onClick={() => { setWantFirstComment((v) => !v); }}
              className={`w-full rounded-lg border px-3 py-2 text-sm transition ${
                wantFirstComment
                  ? "border-green-300 bg-green-50/15 text-green-700"
                  : "border-gray-200 bg-white text-gray-600 hover:text-gray-900"
              }`}
            >
              {wantFirstComment ? "On - generate a first comment" : "Off"}
            </button>
          </Field>
        )}

        <Field label="Actions">
          <div className="flex gap-2">
            <button
              onClick={generate}
              disabled={loading}
              className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(201,122,61,0.22)] transition hover:brightness-105 disabled:opacity-50"
            >
              {loading
                ? progress
                  ? `Generating ${progress.done}/${progress.total}...`
                  : "Generating..."
                : "Generate"}
            </button>
            <button
              onClick={downloadCSV}
              disabled={!items.length}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 transition hover:bg-gray-100 disabled:opacity-40"
              title="Download CSV"
            >
              CSV
            </button>
          </div>
          <div className="mt-2 grid gap-1 text-[12px] text-gray-600">
            <div className="flex flex-wrap items-center justify-between gap-x-2">
              <span>Image output / post</span>
              <span className="font-mono text-green-700">{imageOutputEstimate !== null
                ? `$${imageOutputEstimate.toFixed(5)} est.` : outputExamples
                  ? `Low $${outputExamples.low.toFixed(5)} · ${imageModel.startsWith("gpt-image-2.5-") ? "Max" : "High"} $${outputExamples.high.toFixed(5)}`
                  : "Depends on usage"}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-2">
              <span>Image output / batch</span>
              <span className="font-mono text-green-700">{imageOutputEstimate !== null
                ? `$${(imageOutputEstimate * count).toFixed(5)} est.` : outputExamples
                  ? `Low $${(outputExamples.low * count).toFixed(5)} · ${imageModel.startsWith("gpt-image-2.5-") ? "Max" : "High"} $${(outputExamples.high * count).toFixed(5)}`
                  : "Depends on usage"}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-2 border-t border-gray-200 pt-1">
              <span>Text input / output per 1M tokens</span>
              <span className="font-mono text-green-700">{textRates ? `$${textRates.in.toFixed(2)} / $${textRates.out.toFixed(2)}` : "Depends on usage"}</span>
            </div>
            {openAIImage && imageSettings.partial_images > 0 && previewPrice !== null && (
              <div className="flex items-center justify-between">
                <span>Each partial preview</span>
                <span className="font-mono text-green-700">${previewPrice.toFixed(5)} extra</span>
              </div>
            )}
            <p className="text-gray-600">{outputExamples ? "Auto quality varies; Low and " + (imageModel.startsWith("gpt-image-2.5-") ? "Max" : "High") + " are examples. " : ""}Image output estimates exclude prompt and reference inputs, text planning, image analysis, previews, and any search fees. Actual usage may differ.</p>
          </div>
        </Field>
      </section>
      {openAIImage && <OpenAIImageControls model={imageModel} value={imageSettings} onChange={setImageSettings} disabled={loading} />}
      {partialPreview && loading && <section className="studio-panel mb-4 rounded-[24px] p-4" aria-live="polite">
        <p className="mb-2 text-sm">Image preview · generation in progress</p>
        <p role="status">{partialPreview}</p>
      </section>}


      {/* â”€â”€ Scene focus multi-select â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section className="studio-panel mb-6 rounded-[24px] p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.22em] text-gray-600">
            {contentType === "fashion" ? "Categorie mode - choisissez une ou plusieurs" : "Scene focus - pick one or more"}
            {modes.size > 0 && <span className="ml-1 text-gray-600">({modes.size})</span>}
          </span>
          <div className="flex gap-3 text-[11px]">
            <button
              onClick={() => setModes(new Set(sceneChips.map((m) => m.value)))}
              className="text-gray-600 transition hover:text-blue-700"
            >
              Select all
            </button>
            <button
              onClick={() => setModes(new Set())}
              className="text-gray-600 transition hover:text-red-700"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {sceneChips.map((m) => {
            const on = modes.has(m.value);
            return (
              <button
                key={m.value}
                onClick={() => toggleMode(m.value)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  on
                    ? "border-green-300 bg-green-50 text-green-700"
                    : "border-gray-200 text-gray-600 hover:border-blue-600 hover:text-blue-700"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-gray-600">
          {contentType === "recipes"
            ? "Each image is randomly drawn from the food categories you select. Select all gives a full mix of dishes."
            : contentType === "fashion"
            ? "Chaque image est tirÃ©e alÃ©atoirement des catÃ©gories sÃ©lectionnÃ©es. Tout sÃ©lectionner donne un mix complet. Les images de rÃ©fÃ©rence remplacent ce choix."
            : "Each image is randomly drawn from the categories you select. Select all gives a full mix. When you upload reference images, this is ignored and the upload drives the scene."}
        </p>
      </section>

      {/* â”€â”€ Reference upload zone (horses + fashion) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {(contentType === "horses" || contentType === "fashion") && (
        <ReferenceZone
          refs={refs}
          onAdd={handleAddRefs}
          onRemove={removeRef}
          onClear={() => setRefs([])}
          contentType={contentType}
        />
      )}

      {/* â”€â”€ img2img strength (shown when a reference is uploaded) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {(contentType === "horses" || contentType === "fashion") && refs.length > 0 && (
        <section className="studio-panel mb-6 flex flex-col gap-2 rounded-[24px] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-gray-600">
              {openAIImage ? "Reference inspiration" : "Inspiration mode - Flux Dev img2img"}
            </div>
            <p className="mt-1 text-[11px] leading-5 text-gray-600">
              {openAIImage ? "Guides how closely the prompt follows your reference. OpenAI edits use the selected image model." : "Controls both the image transform strength and how closely the new concept follows your reference style."}
            </p>
          </div>
          <select
            value={imgStrength}
            onChange={(e) => setImgStrength(Number(e.target.value))}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
          >
            {IMG2IMG_STRENGTHS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </section>
      )}

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700 shadow-[0_18px_40px_rgba(122,64,55,0.16)]">
          {error}
        </div>
      )}

      {/* â”€â”€ Results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {!!items.length && (
        <section className="studio-panel mb-4 grid gap-2 rounded-[24px] p-4 sm:grid-cols-4 sm:p-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-gray-600">Generated</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{items.length}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-gray-600">High potential</div>
            <div className="mt-1 text-2xl font-semibold text-orange-300">{highPotential}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-gray-600">Avg. caption</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{averageCaptionLength}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-gray-600">{items.some((item) => item.costIncomplete) ? "Avg. partial estimate" : "Avg. usage estimate"}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-green-700">${averageCost.toFixed(4)}</div>
          </div>
        </section>
      )}

      {!!items.length && (
        <section className="studio-panel overflow-hidden rounded-[24px]">
          {/* Bulk header */}
          <div className="flex flex-col gap-3 border-b border-neutral-800 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <label className="flex flex-wrap items-center gap-2 text-sm text-gray-900 sm:gap-3">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="h-4 w-4 accent-white"
              />
              <span>
                Select All ({items.length})
                {selected.size > 0 && (
                  <span className="ml-1 text-gray-600">/ {selected.size}</span>
                )}
              </span>
              <span className="rounded-full border border-emerald-700/50 bg-emerald-900/30 px-2.5 py-0.5 text-xs font-medium text-green-700">
                {items.some((item) => item.costIncomplete) ? "Partial estimate" : "Usage estimate"}: <span className="font-mono">${totalCost.toFixed(5)}</span>
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={copySelectedCaptions}
                disabled={!items.length}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-900 disabled:opacity-40"
              >
                {copied === "bulk-captions" ? "Copied" : "Copy captions"}
              </button>
              <button
                onClick={deleteBulk}
                disabled={!items.length}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40"
              >
                {selected.size ? `Delete (${selected.size})` : "Delete all"}
              </button>
              <button
                onClick={downloadSelectedImages}
                disabled={!items.length}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-900 disabled:opacity-40"
              >
                Download images
              </button>
              <button
                onClick={downloadCSV}
                disabled={!items.length}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400 disabled:opacity-40"
              >
                Download CSV
              </button>
              <button
                onClick={downloadJSON}
                disabled={!items.length}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-900 disabled:opacity-40"
              >
                JSON
              </button>
            </div>
          </div>

          {/* Result list */}
          <ul className="divide-y divide-neutral-800">
            {items.map((i, idx) => {
              const checked = selected.has(i.imageUrl);
              const analysisOpen = expandedAnalysis.has(i.imageUrl);
              const promptOpen = expandedPrompts.has(i.imageUrl);
              const lastCopied = lastCopiedCaptionId === i.imageUrl;
              return (
                <li
                  key={i.imageUrl}
                  className={`relative flex flex-col gap-3 px-3 py-3 transition hover:bg-neutral-900/40 sm:px-4 ${
                    checked ? "bg-neutral-900/60" : ""
                  } ${
                    lastCopied
                      ? "rounded-xl bg-emerald-950/14 ring-1 ring-inset ring-emerald-500/40 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.12),0_0_0_1px_rgba(52,211,153,0.08)]"
                      : ""
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <label className="-m-3 cursor-pointer p-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(i.imageUrl)}
                          className="h-5 w-5 shrink-0 accent-white"
                        />
                      </label>

                      <div
                        className="relative shrink-0 cursor-zoom-in"
                        onClick={() => {
                          if (previewPinned && preview?.url === i.imageUrl) {
                            setPreview(null);
                            setPreviewPinned(false);
                          } else {
                            setPreview({ url: i.imageUrl, alt: i.idea });
                            setPreviewPinned(true);
                          }
                        }}
                        onPointerEnter={(e) => { if (e.pointerType === "mouse" && !previewPinned) setPreview({ url: i.imageUrl, alt: i.idea }); }}
                        onPointerLeave={(e) => { if (e.pointerType === "mouse" && !previewPinned) setPreview(null); }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <VerifiedImage
                          source={proxiedImageUrl(i.imageUrl)}
                          alt={i.idea}
                          draggable
                          title="Click to open the preview, or drag the image to your computer"
                          className="h-16 w-16 cursor-grab rounded-lg object-cover ring-1 ring-neutral-800 active:cursor-grabbing"
                        />
                        <span className="absolute -left-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-semibold text-white shadow">
                          {idx + 1}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap text-sm text-gray-900">
                          {i.description || i.idea || "Untitled"}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          <button
                            onClick={() => regenerateCaption(i)}
                            disabled={regenerating.has(i.imageUrl)}
                            className="rounded-lg border border-neutral-700 px-2.5 py-1 text-[11px] text-gray-900 hover:bg-neutral-800 disabled:opacity-50 transition"
                          >
                            {regenerating.has(i.imageUrl) ? "Regenerating..." : "Regenerate caption"}
                          </button>
                          <button
                            onClick={() => togglePrompt(i.imageUrl)}
                            className="rounded-lg border border-neutral-700 px-2.5 py-1 text-[11px] text-gray-900 hover:bg-neutral-800 transition"
                          >
                            {promptOpen ? "Hide prompt" : "Show prompt"}
                          </button>
                          <button
                            onClick={() => copyText(i.renderedPrompt || i.prompt, `${i.imageUrl}:prompt`)}
                            className="rounded-lg border border-neutral-700 px-2.5 py-1 text-[11px] text-gray-900 hover:bg-neutral-800 transition"
                          >
                            {copied === `${i.imageUrl}:prompt` ? "Copied" : "Copy prompt"}
                          </button>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-600">
                          <span>{new Date(i.createdAt).toLocaleString()}</span>
                          <span className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-600">
                            {i.provider} / {i.model}
                          </span>
                          {i.falModel && (
                            <span className="rounded border border-amber-700/60 bg-amber-900/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-700">
                              {prettyFal(i.falModel)}
                            </span>
                          )}
                          {i.recipeStyle && (
                            <span className="rounded border border-sky-700/60 bg-sky-900/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-sky-300">
                              Recipe style: {i.recipeStyle}
                            </span>
                          )}
                          {i.trendSource && (
                            <span className="rounded border border-cyan-700/60 bg-cyan-900/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300">
                              Trend source: {i.trendSource}
                            </span>
                          )}
                          {i.trendAngle && (
                            <span className="rounded border border-teal-700/60 bg-teal-900/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-teal-300">
                              Trend angle: {i.trendAngle}
                            </span>
                          )}
                          {i.viralScore === "high" && (
                            <span
                              title={i.viralReason || "High viral potential"}
                              className="rounded border border-orange-600/60 bg-orange-900/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-300 cursor-default"
                            >
                              🔥 High Potential
                            </span>
                          )}
                          {i.usedReference && (
                            <span className="rounded border border-violet-700/60 bg-violet-900/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-violet-300">
                              📎 Reference
                            </span>
                          )}
                          {lastCopied && (
                            <span className="rounded border border-emerald-600/60 bg-emerald-900/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green-700">
                              ✓ Last copied
                            </span>
                          )}
                          <span className="font-mono text-green-700">
                            ${i.cost.toFixed(5)}{i.costIncomplete ? " partial est.; some usage unavailable" : " usage est."}
                            {typeof i.textCost === "number" && ` · text $${i.textCost.toFixed(5)}`}
                            {typeof i.imageCost === "number" && ` · ${i.imageCostIncluded ? "image" : "image output est."} $${i.imageCost.toFixed(5)}`}
                            {!!i.searchCost && ` · search $${i.searchCost.toFixed(5)}`}
                          </span>
                          {i.description && (
                            <span className="text-[10px] text-gray-600">{i.description.length} chars</span>
                          )}
                          {i.location && /no location/i.test(i.location) && (
                            <span className="text-[10px] text-neutral-600">📍 No location suggested</span>
                          )}
                          {i.analysis && (
                            <button
                              onClick={() => toggleAnalysis(i.imageUrl)}
                              className="text-[10px] text-gray-600 underline underline-offset-2 hover:text-violet-300 transition"
                            >
                              {analysisOpen ? "Hide analysis ↑" : "Show analysis ↓"}
                            </button>
                          )}
                        </div>

                        {i.firstComment && (
                          <div className="mt-2 rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-2">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-[10px] uppercase tracking-wider text-green-700">First comment</span>
                              <button
                                onClick={() => copyText(i.firstComment ?? "", `${i.imageUrl}:fc`)}
                                className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-gray-600 hover:bg-neutral-800 transition"
                              >
                                {copied === `${i.imageUrl}:fc` ? "Copied ✓" : "Copy"}
                              </button>
                            </div>
                            <p className="whitespace-pre-wrap text-xs text-gray-900">{i.firstComment}</p>
                          </div>
                        )}

                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">
                      <button
                        onClick={() => copyCaption(i)}
                        className="flex-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400 sm:flex-none"
                      >
                        {copied === `${i.imageUrl}:cap` ? "Copied ✓" : "Copy caption"}
                      </button>
                      <button
                        onClick={() => downloadImage(i.imageUrl)}
                        className="flex-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 sm:flex-none"
                      >
                        Download Original
                      </button>
                      <button
                        type="button"
                        onClick={() => { setPreview(null); setPreviewPinned(false); setFilterTarget({ url: i.imageUrl, fileName: `${contentType}-image-${idx + 1}` }); }}
                        className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-100 sm:flex-none"
                      >
                        Add Filter
                      </button>
                      <button
                        onClick={() => deleteItem(i.imageUrl)}
                        className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 sm:flex-none"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {promptOpen && (
                    <div className="ml-8 grid gap-2 rounded-xl border border-neutral-800 bg-neutral-900/70 p-3 text-xs text-gray-600 sm:ml-12">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] uppercase tracking-wider text-gray-600">
                          Image prompt
                        </p>
                        <button
                          onClick={() => copyText(i.renderedPrompt || i.prompt, `${i.imageUrl}:prompt-panel`)}
                          className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-gray-600 hover:bg-neutral-800 transition"
                        >
                          {copied === `${i.imageUrl}:prompt-panel` ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{i.renderedPrompt || i.prompt}</p>
                      {i.idea && (
                        <p className="border-t border-neutral-800 pt-2 text-gray-600">
                          Idea: {i.idea}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Inspiration analysis panel */}
                  {i.analysis && analysisOpen && (
                    <div className="ml-8 grid gap-2 rounded-xl border border-violet-800/40 bg-violet-950/20 p-3 text-xs text-gray-600 sm:ml-12">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[10px] uppercase tracking-wider text-violet-400">
                          Inspiration analysis
                        </p>
                        {i.contentType && (
                          <span className="rounded border border-violet-700/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-violet-300">
                            {i.contentType}
                          </span>
                        )}
                        {i.engagementScore && (
                          <span className="rounded border border-orange-700/60 bg-orange-900/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-orange-300">
                            Engagement: {i.engagementScore}
                          </span>
                        )}
                        {i.rpmScore && (
                          <span className="rounded border border-emerald-700/60 bg-emerald-900/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-green-700">
                            RPM: {i.rpmScore}
                          </span>
                        )}
                      </div>
                      {i.referenceStrategy && (
                        <p><span className="text-violet-400">Multi-reference strategy:</span> {i.referenceStrategy}</p>
                      )}
                      {i.viralHook && (
                        <p><span className="text-violet-400">Viral hook:</span> {i.viralHook}</p>
                      )}
                      {i.winningElements && (
                        <p><span className="text-violet-400">Winning elements:</span> {i.winningElements}</p>
                      )}
                      {i.whyStrong && (
                        <p><span className="text-violet-400">Why this should perform:</span> {i.whyStrong}</p>
                      )}
                      <p><span className="text-violet-400">What was detected:</span> {i.analysis}</p>
                      {i.altText && (
                        <div className="flex items-start justify-between gap-2 rounded-lg bg-neutral-900/60 p-2">
                          <p className="min-w-0"><span className="text-violet-400">Alt text:</span> {i.altText}</p>
                          <button
                            onClick={() => copyText(i.altText ?? "", `${i.imageUrl}:alt`)}
                            className="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-gray-600 hover:bg-neutral-800 transition"
                          >
                                {copied === `${i.imageUrl}:alt` ? "Copied ✓" : "Copy"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* â”€â”€ Preview overlay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      </div>
      {preview && (
        <>
          <button
            type="button"
            onClick={() => { setPreview(null); setPreviewPinned(false); }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 md:hidden"
            aria-label="Close preview"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <VerifiedImage
              source={proxiedImageUrl(preview.url)}
              alt={preview.alt}
              className="max-h-[90vh] max-w-full rounded-2xl object-contain shadow-2xl"
            />
          </button>
          <div className={`fixed left-6 top-1/2 z-50 hidden -translate-y-1/2 md:block ${previewPinned ? "pointer-events-auto" : "pointer-events-none"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <VerifiedImage
              source={proxiedImageUrl(preview.url)}
              alt={preview.alt}
              draggable
              title={previewPinned ? "Drag this image to your computer" : "Click the thumbnail to keep this preview open"}
              className="h-auto w-[440px] max-w-[32vw] cursor-grab rounded-2xl object-contain shadow-2xl ring-1 ring-neutral-700 active:cursor-grabbing"
            />
            {previewPinned && (
              <div className="absolute right-2 top-2 flex gap-2">
                <button type="button" onClick={() => downloadImage(preview.url)} className="rounded-lg bg-neutral-950/90 px-3 py-2 text-xs text-white hover:bg-neutral-800">Save image</button>
                <button type="button" onClick={() => { setPreview(null); setPreviewPinned(false); }} className="rounded-lg bg-neutral-950/90 px-3 py-2 text-xs text-white hover:bg-neutral-800" aria-label="Close preview">Close</button>
              </div>
            )}
          </div>
        </>
      )}
      {filterTarget && <ImageFilterStudio source={filterTarget.url} fileName={filterTarget.fileName} onClose={() => setFilterTarget(null)} />}
    </main>
  );
}

function ReferenceZone({
  refs,
  onAdd,
  onRemove,
  onClear,
  contentType = "horses",
}: {
  refs: RefImage[];
  onAdd: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  contentType?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function handleDragLeave() {
    setDragging(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) onAdd(e.dataTransfer.files);
  }
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      onAdd(e.target.files);
      e.target.value = "";
    }
  }

  const remaining = MAX_REFS - refs.length;
  const full = remaining <= 0;

  return (
    <section className="studio-panel mb-6 rounded-[24px] p-4 sm:p-5">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="text-[11px] uppercase tracking-[0.22em] text-gray-600">
            Viral Post Inspiration
          </span>
          {refs.length > 0 && (
            <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
              {refs.length}/{MAX_REFS} images
            </span>
          )}
        </div>
        {refs.length > 0 && (
          <button
            onClick={onClear}
            className="text-[11px] text-gray-600 transition hover:text-red-700"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Drop zone */}
      {!full && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition select-none ${
            dragging
              ? "border-blue-600 bg-blue-50 text-blue-700"
              : "border-gray-200 text-gray-600 hover:border-blue-600 hover:text-gray-900"
          }`}
        >
          <span className="text-2xl">📎</span>
          <p className="text-sm font-medium">
            {contentType === "fashion" ? "Drag viral fashion images here" : "Drag viral horse images here"}
            <br />
            <span className="font-normal text-gray-600">or click to upload</span>
          </p>
          <p className="text-[11px] text-gray-600">
            JPG / PNG / WEBP / max {MAX_REFS} images
            {refs.length > 0 && ` / ${remaining} slot${remaining !== 1 ? "s" : ""} left`}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      )}

      {/* Thumbnails */}
      {refs.length > 0 && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            {refs.map((r) => (
              <div key={r.id} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.dataUrl}
                  alt={r.name}
                  className="h-16 w-16 rounded-xl object-cover ring-1 ring-gray-200"
                />
                <button
                  onClick={() => onRemove(r.id)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-white opacity-0 shadow transition group-hover:opacity-100"
                  title="Remove"
                >
                  x
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] leading-5 text-gray-600">
            {contentType === "fashion"
              ? `L'IA va analyser ${refs.length === 1 ? "cette image" : `ces ${refs.length} images`} et creer de nouvelles scenes mode originales inspirees de leur style.`
              : `AI will analyze ${refs.length === 1 ? "this image" : `these ${refs.length} images`} and create new original prompts inspired by their visual style.`}
            {full && (
              <span className="ml-1 text-gray-600">(Max {MAX_REFS} reached.)</span>
            )}
          </p>
        </div>
      )}

      {/* Empty hint */}
      {refs.length === 0 && (
        <p className="mt-2.5 text-[11px] leading-5 text-gray-600">
          {contentType === "fashion"
            ? "Importez des images mode virales pour guider l'IA. Sans image, l'app genere normalement."
            : "Upload viral horse images to guide the AI. If no images are uploaded, the app generates normally."}
        </p>
      )}
    </section>
  );
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function prettyFal(slug: string): string {
  // Prefer the exact label from the selectable image-model list.
  const known = ALL_IMAGE_MODELS.find((m) => m.value === slug);
  if (known) return known.label;
  // Reference-upload (img2img) path and any other slugs.
  if (slug.includes("flux") && slug.includes("dev")) return "Flux Dev";
  if (slug.includes("flux") && slug.includes("schnell")) return "FLUX Schnell";
  if (slug.includes("flux") && slug.includes("pro")) return "Flux Pro";
  if (slug.includes("seedream") && slug.includes("4.5")) return "Seedream 4.5";
  if (slug.includes("seedream")) return "Seedream 4.0";
  if (slug.includes("ideogram")) return "Ideogram V3";
  if (slug.includes("qwen")) return "Qwen-Image";
  const tail = slug.split("/").filter(Boolean).pop() || slug;
  return tail.replace(/-/g, " ");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] uppercase tracking-[0.22em] text-gray-600">{label}</div>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
