import { NextResponse } from "next/server";
import { generateRecipeDesignArtwork } from "@/lib/recipeDesignArtworkImage";
import { withCostLedger, recordOpenAIImage, costSummary } from "@/lib/costLedger";
import { recipeArtworkPrompt, validateDesignPlan, validateDesignSettings, validateTitle } from "@/lib/recipeDesigns";
import {getRecipeStyle,validateRecipePromptCopy} from "@/lib/recipeDesignStylePresets";

export const runtime = "nodejs";
export const maxDuration = 300;

async function run(req: Request) {
  let dispatched = false;
  try {
    const b = await req.json();
    if (b.approved !== true) return NextResponse.json({ error: "Approve the estimated paid work first.", dispatched: false, outcome: "not_dispatched" }, { status: 400 });
    const settings = validateDesignSettings(b.settings);
    const plan = validateDesignPlan(b.plan);
    if(!plan.styleId)throw new Error("Choose one of the saved Recipe Designs styles before creating artwork.");
    const chosen=getRecipeStyle(plan.styleId)!;
    if(plan.family!==chosen.family)throw new Error("The design family does not match its saved style prompt.");
    const {title,noText}=validateTitle(b.title,b.noText);
    if(settings.styleId!=="auto" && plan.styleId && settings.styleId!==plan.styleId)throw new Error("The planned style does not match the selected style.");
    const notes=b.notes ?? "";
    if(typeof notes!=="string" || notes.length>1000)throw new Error("Invalid style notes.");
    const promptCopy=validateRecipePromptCopy(b.promptCopy,plan.styleId);
    const prompt=recipeArtworkPrompt(plan,title,noText,settings.strength,notes,promptCopy);
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY. Configure it on the server.");
    dispatched = true;
    // Never provide a reference here: this must always be text-to-image, not edits.
    const image = await generateRecipeDesignArtwork(settings,prompt);
    recordOpenAIImage(settings.model, settings.image, image);
    // Stream large image data so serverless response body limits do not truncate
    // a valid full-resolution artwork response.
    const json = JSON.stringify({ artwork: image.dataUrl, status: "AI Artwork Generated", ...costSummary(settings.model) });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < json.length; offset += 64_000) controller.enqueue(encoder.encode(json.slice(offset, offset + 64_000)));
        controller.close();
      },
    });
    return new Response(body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Artwork generation failed.";
    return NextResponse.json({ error: message, dispatched, outcome: dispatched ? "unknown" : "not_dispatched", costStatus: dispatched ? "The provider outcome may be unknown; check OpenAI usage before trying again." : "No provider request was sent." }, { status: dispatched ? 502 : 400 });
  }
}
export async function POST(req: Request) { return withCostLedger(() => run(req)); }
