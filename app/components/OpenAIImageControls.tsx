"use client";
import { useEffect } from "react";
import { recipePlatformPreset } from "@/lib/recipeImageToImageSettings";
import { imageSizesFor, imageQualitiesFor, supportsImageComplexity, type OpenAIImageSettings } from "@/lib/openaiImageSettings";

export function OpenAIImageControls({ model, value, onChange, disabled, countDescription, hidePartialImages, quickSettingsOnly, hideQuickSettings, recipePresets = false }: {
  model: string; value: OpenAIImageSettings; onChange: (value: OpenAIImageSettings) => void; disabled: boolean;
  countDescription?: string;
  hidePartialImages?: boolean;
  quickSettingsOnly?: boolean;
  hideQuickSettings?: boolean;
  recipePresets?: boolean;
}) {
  const facebookSupported = imageSizesFor(model).includes("1152x1440");
  useEffect(() => {
    if (!facebookSupported && (value.size === "1152x1440" || value.size === "1536x864")) {
      onChange({ ...value, size: "1024x1536" });
    }
  }, [facebookSupported, value, onChange]);
  const update = (key: keyof OpenAIImageSettings, next: string | number) => {
    if (recipePresets && key === "size") { onChange(recipePlatformPreset(value, next as OpenAIImageSettings["size"])); return; }
    const settings = { ...value, [key]: next };
    if (key === "background" && next === "transparent" && settings.output_format === "jpeg") settings.output_format = "png";
    onChange(settings);
  };
  const field = (label: string, key: keyof OpenAIImageSettings, options: readonly (readonly [string, string])[]) => {
    const highlight = quickSettingsOnly && key === "output_format";
    return <label className={`grid gap-2 text-sm ${highlight ? "font-semibold text-[#f2bb84]" : "text-[#cbb8a2]"}`}>
      {label}
      <select aria-label={label} value={value[key] ?? "default"} disabled={disabled}
        onChange={(e) => update(key, key === "partial_images" ? Number(e.target.value) : e.target.value)}
        className={`rounded-xl border px-3 py-2.5 disabled:opacity-50 ${highlight
          ? "border-[#d9965e] bg-[#50301f] text-[#fff3e5] shadow-[0_0_0_1px_rgba(217,150,94,0.18),0_6px_18px_rgba(201,122,61,0.12)] focus:outline-none focus:ring-2 focus:ring-[#e9b989]"
          : "border-[#4a3b2c] bg-[#1a1511] text-neutral-100"}`}>
        {options.map(([id, title]) => <option key={id} value={id} disabled={key === "output_format" && id === "jpeg" && value.background === "transparent"}>{title}</option>)}
      </select>
    </label>;
  };
  const qualityLabels: Record<string, string> = { auto: "Auto", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
  const quality = () => field("Quality", "quality", imageQualitiesFor(model).map((q) => [q, qualityLabels[q]]));
  const outputFormat = () => field("Output format", "output_format", [["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"]]);
  const socialButton = (platform: "Facebook" | "Pinterest" | "WordPress") => {
    const facebook = platform === "Facebook";
    const wordpress = platform === "WordPress";
    const size = wordpress ? "1536x864" : facebook ? "1152x1440" : "1024x1536";
    const selected = value.size === size;
    return <button type="button" disabled={disabled || ((facebook || wordpress) && !facebookSupported)}
      aria-pressed={selected} title={(facebook || wordpress) && !facebookSupported ? "Select GPT Image 2 or later to use this size." : undefined}
      onClick={() => update("size", size)}
      className={`inline-flex min-h-9 w-fit max-w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-xs text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1511] disabled:cursor-not-allowed disabled:opacity-50 ${wordpress ? "border-[#38a7d1] bg-[#21759b] hover:bg-[#185a78]" : facebook
        ? "border-[#1877F2] bg-[#145cbd] hover:bg-[#1877F2]"
        : "border-[#E60023] bg-[#bd001d] hover:bg-[#E60023]"} ${selected ? "ring-2 ring-white ring-offset-2 ring-offset-[#1a1511]" : ""}`}>
      {recipePresets && <img src={`/brand-icons/${platform.toLowerCase()}.svg`} alt="" aria-hidden="true" width={16} height={16} className="h-4 w-4 shrink-0" />}
      <span className="font-semibold">{platform}</span>
      <span>{wordpress ? "1536 × 864" : facebook ? "1152 × 1440" : "1024 × 1536"}</span>
      {selected && <span aria-hidden="true">✓</span>}
    </button>;
  };
  const qualityWithPreset = () => <div className="grid content-start gap-3">{quality()}{socialButton("Facebook")}</div>;
  const outputWithPreset = () => <div className="grid content-start gap-3">{outputFormat()}{socialButton("Pinterest")}</div>;
  if (quickSettingsOnly) return <div className="grid items-start gap-4 sm:grid-cols-2">{qualityWithPreset()}{outputWithPreset()}{recipePresets && <div className="grid gap-2 sm:col-span-2">{socialButton("WordPress")}{value.output_format === "webp" && <p className="text-xs text-[#b9aa98]">High-quality WebP downloads keep full resolution. We aim for 300 KB, but preserve quality when a larger file is needed.</p>}</div>}</div>;
  return <section className="studio-panel mb-4 rounded-[24px] p-5">
    <h2 className="mb-4 font-semibold text-neutral-100">OpenAI image settings</h2>
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <div className="grid content-start gap-3">
        {field("Size & orientation", "size", [
          ["auto", "Auto"], ["1024x1024", "Square (1024×1024)"],
          ...(facebookSupported ? [["1152x1440", "Facebook (1152×1440)"]] as const : []),
          ["1024x1536", "Pinterest (1024×1536)"], ["1536x1024", "Landscape (1536×1024)"],
          ...(recipePresets && facebookSupported ? [["1536x864", "WordPress (1536×864)"]] as const : []),
        ])}
      </div>
      {!hideQuickSettings && qualityWithPreset()}
      {supportsImageComplexity(model) && field("Complexity", "complexity", [["default", "Default"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]])}
    </div>
    <details className="mt-5 border-t border-[#4a3b2c] pt-4" open>
      <summary className="mb-4 cursor-pointer font-medium">Advanced</summary>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {!hideQuickSettings && outputWithPreset()}
        {field("Background", "background", [["opaque", "Opaque"], ["transparent", "Transparent"], ["auto", "Auto"]])}
        {field("Moderation", "moderation", [["auto", "Auto"], ["low", "Low"]])}
        {!hidePartialImages && field("Partial images", "partial_images", [["0", "None"], ["1", "1 preview"], ["2", "2 previews"], ["3", "3 previews"]])}
      </div>
      <p className="mt-3 text-xs text-[#b9aa98]">{countDescription || "The image count above creates separate posts. Partial images show progress before each finished image."}</p>
    </details>
  </section>;
}
