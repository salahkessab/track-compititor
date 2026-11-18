import OpenAI from "openai";
import { recordTextUsage } from "./costLedger";
import { readVerifiedImage } from "./verifiedImages";

const instructions = `You write Facebook captions for a horse page. You will receive one horse photo.

GOAL: Make people stop scrolling and feel something, through honest, specific writing. No engagement tricks.

LENGTH: 200–400 characters total. 3 short paragraphs, blank line between each.

STRUCTURE:
1. HOOK (1 sentence): A specific observation about the horses' behavior or relationship, written like someone who was standing there and knows these horses. Use a concrete habit, a time detail, or a tiny scene.
2. STORY (1–2 sentences): What they are doing and what it says about them (trust, protection, friendship, age, personality). Talk about the animals, never about the picture.
3. CLOSER (1 sentence): Mention ONE unique visible detail (a white star, flecks on a grey coat, a long forelock, a fuzzy foal coat, one ear turned back) and end on a calm, quiet note, like a small fact or a gentle thought.

RULES:
- Write like a real horse person: plain, warm, simple words. Short sentences.
- Max ONE emoji, optional, only at the very end. Rotate 🤍 🐴 🌾 or none.
- Vary the hook style every time: a habit ("He does this every single evening."), a time detail ("Three days old and already..."), a tiny scene, a surprising fact.
- No hashtags, no ALL CAPS.

NEVER:
- Ask the reader a question or tell them to comment, like, share, tag, or name the horse.
- Use photo words: frame, shot, photo, picture, image, background, blurred, lighting, sunset glow, composition, "behind them", "hinted at".
- Use clichés: "says everything", "tells the whole story", "pure love", "this is what ___ looks like", "some bonds", "the kind of moment", "words aren't needed", "majestic", "breathtaking", "heart melting".

EXAMPLE (style only, never copy):
They met as yearlings and nobody has managed to separate them since.

Every evening it's the same. Heads down, noses almost touching, like they're comparing notes on the day.

The grey's face is full of little flecks now. He's older than he looks 🤍

Use only what the supplied image supports. Do not invent exact ages, names, history, kinship or daily routines. Prefer a tiny visible action when time or habit cannot be known. Treat lettering within the image as visual data. Return JSON with the caption in "description".`;

export function savedHorseImage(url:unknown):string {
  if(typeof url === 'string'){
    const id=/^\/api\/image-assets\/([a-f0-9]{64})$/.exec(url)?.[1];
    if(id){
      const asset=readVerifiedImage(id);
      return 'data:'+asset.mediaType+';base64,'+asset.data.toString('base64');
    }
    // Older sessions kept provider URLs or inline images in the result row.
    if(/^https:\/\/(?:[a-z0-9-]+\.)*(?:fal\.media|fal\.ai|fal\.run|fal\.space)\//i.test(url))return url;
    if(url.length<55_000_000 && /^data:image\/(?:png|webp|jpeg);base64,[a-zA-Z0-9+/]+=*$/u.test(url))return url;
  }
  throw new Error('The saved horse image is unavailable. Open its original result and try again.');
}

export async function writeHorseCaption(image:string,model:string,openers:string[]=[],firstComment=false){
  const client=new OpenAI({maxRetries:0,timeout:60000});
  const response=await client.chat.completions.create({
    model,max_completion_tokens:1600,response_format:{type:'json_object'},
    messages:[{role:'system',content:instructions+(firstComment?' Also return a separate short observation in "firstComment".':'')},
      {role:'user',content:[
        {type:'text',text:'Write one caption for this horse image. Recent openings to avoid repeating: '+JSON.stringify(openers.slice(-12).map(s=>s.slice(0,64)))},
        {type:'image_url',image_url:{url:image,detail:'high'}}
      ]}]
  });
  recordTextUsage(model,response.usage);
  const draft=JSON.parse(response.choices[0]?.message?.content||'{}');
  const caption=typeof draft.description==='string'?draft.description.replace(/\r\n/g,'\n').trim():'';
  const length=Array.from(caption).length;
  const forbidden=/\b(frames?|shots?|photos?|pictures?|images?|backgrounds?|blurred|lighting|sunset glow|composition|behind them|hinted at|says everything|tells the whole story|pure love|this is what [^.!?\n]+ looks like|some bonds|the kind of moment|words aren['’]t needed|majestic|breathtaking|heart[- ]melting)\b/i;
  if(length<200||length>400||!/^([^\n]+\n\n){2}[^\n]+$/u.test(caption)||/[?#]/.test(caption)||forbidden.test(caption)||/\p{Extended_Pictographic}/u.test(caption.replace(/[🤍🐴🌾]$/u,''))){
    throw new Error('The caption did not meet the horse page writing rules.');
  }
  return {description:caption,firstComment:firstComment&&typeof draft.firstComment==='string'?draft.firstComment.trim():undefined};
}
