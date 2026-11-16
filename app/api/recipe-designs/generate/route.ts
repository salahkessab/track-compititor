import { NextResponse } from "next/server";
import { finalizeGeneration, preparationFailure } from '@/lib/imageFinalization';
import { checkImageProcessing } from '@/lib/imageMetadata';
import { streamGeneration } from '@/lib/generationStream';
import { generateRecipeDesignArtwork } from "@/lib/recipeDesignArtworkImage";
import { withCostLedger, recordOpenAIImage, costSummary } from "@/lib/costLedger";
import { MAX_RECIPE_EDIT_REQUEST_CHARS, recipeDirectPrompt, validateRecipeEditImage } from "@/lib/recipeDesignDirect";
import { selectRecipeStyle, validateDesignSettings, validateTitle } from "@/lib/recipeDesigns";
import { requiresRecipeIngredients, validateRecipeIngredients } from "@/lib/recipeDesignIngredients";

export const runtime = "nodejs";
export const maxDuration = 300;

async function run(req: Request, phase: (value: 'generating' | 'preparing') => void) {
  let dispatched = false;
  try {
    const b = await req.json();
    if (b.approved !== true) throw new Error("Approve the paid image edit first.");
    const settings = validateDesignSettings(b.settings);
    const { title } = validateTitle(b.title, false);
    const styleId = selectRecipeStyle(settings.styleId, title);
    const ingredients = requiresRecipeIngredients(styleId) ? validateRecipeIngredients(b.ingredients) : undefined;
    const photo = validateRecipeEditImage(b.photo, 2_950_000);
    if (!Array.isArray(b.references) || b.references.length > 3) throw new Error("Use up to three optional style references.");
    const references = b.references.map((value: unknown) => validateRecipeEditImage(value, 260_000));
    if (photo.length + references.reduce((total: number, ref: string) => total + ref.length, 0) > MAX_RECIPE_EDIT_REQUEST_CHARS) {
      throw new Error("The images are too large for one request. Use smaller style references.");
    }
    const prompt = recipeDirectPrompt(styleId, title, b.notes ?? "", b.promptCopy, ingredients, settings.image.size, b.photoInstructions ?? "");
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY. Configure it on the server.");
    await checkImageProcessing();
    dispatched = true;
    const image = await generateRecipeDesignArtwork(settings, prompt, [photo, ...references]);
    recordOpenAIImage(settings.model, settings.image, image);
    phase('preparing');
    const json = JSON.stringify(await finalizeGeneration({ image: image.dataUrl, styleId, status: "Metadata cleanup verified", ...costSummary(settings.model) }, 'image'));
    const encoder = new TextEncoder();
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      for (let offset = 0; offset < json.length; offset += 64_000) controller.enqueue(encoder.encode(json.slice(offset, offset + 64_000)));
      controller.close();
    } }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    if (preparationFailure(e)) return NextResponse.json(preparationFailure(e), { status: 422 });
    const message = e instanceof Error ? e.message : "Recipe image edit failed.";
    return NextResponse.json({ error: message, dispatched, outcome: dispatched ? "unknown" : "not_dispatched",
      costStatus: dispatched ? "The provider outcome may be unknown; check OpenAI usage before trying again." : "No provider request was sent." },
      { status: dispatched ? 502 : 400 });
  }
}

export async function POST(req: Request) { return streamGeneration(req, phase => withCostLedger(() => run(req, phase))); }
