"use client";
import { useEffect } from "react";
import { imageSizesFor, imageQualitiesFor, supportsImageComplexity, type OpenAIImageSettings } from "@/lib/openaiImageSettings";

export function OpenAIImageControls({ model, value, onChange, disabled, countDescription, hidePartialImages, quickSettingsOnly, hideQuickSettings }: {
  model: string; value: OpenAIImageSettings; onChange: (value: OpenAIImageSettings) => void; disabled: boolean;
  countDescription?: string;
  hidePartialImages?: boolean;
  quickSettingsOnly?: boolean;
  hideQuickSettings?: boolean;
}) {
  const facebookSupported = imageSizesFor(model).includes("1152x1440");
  useEffect(() => {
    if (!facebookSupported && value.size === "1152x1440") {
      onChange({ ...value, size: "1024x1536" });
    }
  }, [facebookSupported, value, onChange]);
  const update = (key: keyof OpenAIImageSettings, next: string | number) => {
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
  if (quickSettingsOnly) return <div className="grid gap-4 sm:grid-cols-2">{quality()}{outputFormat()}</div>;
  return <section className="studio-panel mb-4 rounded-[24px] p-5">
    <h2 className="mb-4 font-semibold text-neutral-100">OpenAI image settings</h2>
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <div className="grid content-start gap-3">
        <div role="group" aria-label="Social image sizes" className="grid gap-2">
          <button type="button" disabled={disabled || !facebookSupported} aria-pressed={value.size === "1152x1440"}
            onClick={() => update("size", "1152x1440")}
            className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 border-[#1877F2] bg-[#145cbd] px-4 py-3 text-left text-white transition hover:bg-[#1877F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1511] disabled:cursor-not-allowed disabled:opacity-50 ${value.size === "1152x1440" ? "ring-2 ring-white ring-offset-2 ring-offset-[#1a1511]" : ""}`}>
            <span><span className="block font-semibold">Facebook</span><span className="text-sm">1152 × 1440 · 4:5</span></span>
            {value.size === "1152x1440" && <span className="text-sm font-semibold">Selected</span>}
          </button>
          <button type="button" disabled={disabled} aria-pressed={value.size === "1024x1536"}
            onClick={() => update("size", "1024x1536")}
            className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 border-[#E60023] bg-[#bd001d] px-4 py-3 text-left text-white transition hover:bg-[#E60023] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1511] disabled:cursor-not-allowed disabled:opacity-50 ${value.size === "1024x1536" ? "ring-2 ring-white ring-offset-2 ring-offset-[#1a1511]" : ""}`}>
            <span><span className="block font-semibold">Pinterest</span><span className="text-sm">1024 × 1536 · 2:3</span></span>
            {value.size === "1024x1536" && <span className="text-sm font-semibold">Selected</span>}
          </button>
        </div>
        {!facebookSupported && <p className="text-xs text-[#b9aa98]">Select GPT Image 2 or later to use the Facebook size.</p>}
        {field("Size & orientation", "size", [
          ["auto", "Auto"], ["1024x1024", "Square (1024×1024)"],
          ...(facebookSupported ? [["1152x1440", "Facebook (1152×1440)"]] as const : []),
          ["1024x1536", "Pinterest (1024×1536)"], ["1536x1024", "Landscape (1536×1024)"],
        ])}
      </div>
      {!hideQuickSettings && quality()}
      {supportsImageComplexity(model) && field("Complexity", "complexity", [["default", "Default"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]])}
    </div>
    <details className="mt-5 border-t border-[#4a3b2c] pt-4" open>
      <summary className="mb-4 cursor-pointer font-medium">Advanced</summary>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {!hideQuickSettings && outputFormat()}
        {field("Background", "background", [["opaque", "Opaque"], ["transparent", "Transparent"], ["auto", "Auto"]])}
        {field("Moderation", "moderation", [["auto", "Auto"], ["low", "Low"]])}
        {!hidePartialImages && field("Partial images", "partial_images", [["0", "None"], ["1", "1 preview"], ["2", "2 previews"], ["3", "3 previews"]])}
      </div>
      <p className="mt-3 text-xs text-[#b9aa98]">{countDescription || "The image count above creates separate posts. Partial images show progress before each finished image."}</p>
    </details>
  </section>;
}
