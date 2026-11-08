import { generateOpenAIImage, type OpenAIImageResult } from "./openaiImages";
import { recipeArtworkSize, type DesignSettings } from "./recipeDesigns";

/** Recipe Designs-only size adapter; shared image settings and other workflows stay untouched. */
export async function generateRecipeDesignArtwork(settings: DesignSettings, prompt: string, references: string[] = []): Promise<OpenAIImageResult> {
  if (settings.artworkSize !== "1280x1600") {
    return generateOpenAIImage({model:settings.model,settings:settings.image,prompt,references});
  }
  if (settings.model !== "gpt-image-2.5-sunburst") throw new Error("This artwork size requires gpt-image-2.5-sunburst.");
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY. Configure it on the server.");
  if (!prompt || prompt.length > 32000) throw new Error("Image prompt must contain 1 to 32000 characters.");
  const {partial_images,complexity,...options} = settings.image;
  if (partial_images !== 0 || (complexity && complexity !== "default")) throw new Error("Unsupported artwork settings.");
  const parameters={model:settings.model,prompt,n:1,...options,size:recipeArtworkSize(settings)};
  const form=new FormData();
  if(references.length){
    for(const [key,value] of Object.entries(parameters))form.append(key,String(value));
    for(const [index,ref] of references.entries()){
      const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(ref);
      if(!match || match[2].length>3_000_000)throw new Error("Invalid or oversized recipe reference image.");
      form.append("image[]",new Blob([Buffer.from(match[2],"base64")],{type:`image/${match[1]}`}),`recipe-${index}.${match[1]}`);
    }
  }
  const response=await fetch(`https://api.openai.com/v1/images/${references.length?"edits":"generations"}`,{
    method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,...(references.length?{}:{"Content-Type":"application/json"})},
    body:references.length?form:JSON.stringify(parameters),
    signal:AbortSignal.timeout(240_000),
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error?.message || `OpenAI image request failed (${response.status})`);
  const b64=result?.data?.[0]?.b64_json;
  if(typeof b64!=="string" || !b64)throw new Error("OpenAI returned no image");
  return {dataUrl:`data:image/${result.output_format || settings.image.output_format};base64,${b64}`,usage:result.usage,size:result.size || "1280x1600",quality:result.quality || settings.image.quality,partialImages:0};
}
