"use client";
import { imageQualitiesFor, supportsImageComplexity, type OpenAIImageSettings } from "@/lib/openaiImageSettings";

export function OpenAIImageControls({ model, value, onChange, disabled, countDescription, hidePartialImages, quickSettingsOnly, hideQuickSettings }: {
  model: string; value: OpenAIImageSettings; onChange: (value: OpenAIImageSettings) => void; disabled: boolean;
  countDescription?: string;
  hidePartialImages?: boolean;
  quickSettingsOnly?: boolean;
  hideQuickSettings?: boolean;
}) {
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
    <div className="grid gap-4 sm:grid-cols-2">
      {field("Size & orientation", "size", [["auto", "Auto"], ["1024x1024", "Square (1024×1024)"], ["1024x1536", "Portrait (1024×1536)"], ["1536x1024", "Landscape (1536×1024)"]])}
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
