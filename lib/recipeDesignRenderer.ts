import { recipeDesignAspect, recipeDesignSignature, type DesignFamily, type DesignPlan } from "./recipeDesigns";
import { digest, type LocalPhoto } from "./recipeDesignPhoto";
import { renderRecipeScene, TEMPLATE_COLORS } from "./recipeDesignScene";

type Rectangle = { x: number; y: number; width: number; height: number };
export type VisualQA = { reviewRequired: true; font: string; titleSize: number | null; artworkTexture: "none" | "visible" | "subtle"; notes: string[] };
export type DesignQA = { originalSha256: string; workingSha256: string; outputSha256: string; photoRect: Rectangle; pixelDifferences: number; title: string; transformations: string[]; visual?: VisualQA; designSignature?:string; sceneJson?:string };
export type RenderedDesign = { blob: Blob; qa: DesignQA };

const intersect = (a: Rectangle, b: Rectangle) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
const getContext = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error("Your browser cannot render this design.");
  return ctx;
};
const rounded = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath(); ctx.roundRect(x,y,w,h,r);
};
type Layout = { area: Rectangle; title: Rectangle; placement: "top" | "bottom" };
type Typeface = { family: string; weight: number; maxSize: number; spacing: number };
export function recipeDesignLayout(family: DesignFamily, placement?: "top" | "bottom"): Layout {
  let result: Layout;
  switch (family) {
    case "black_label": result={area:{x:36,y:42,width:1128,height:1128},title:{x:43,y:1190,width:1114,height:265},placement:"bottom"};break;
    case "notebook": result={area:{x:55,y:40,width:1090,height:1090},title:{x:38,y:1145,width:1124,height:304},placement:"bottom"};break;
    case "retro_diner": result={area:{x:36,y:380,width:1128,height:1080},title:{x:40,y:42,width:1120,height:300},placement:"top"};break;
    case "heritage": result={area:{x:32,y:365,width:1136,height:1090},title:{x:40,y:38,width:1120,height:300},placement:"top"};break;
    default: result={area:{x:32,y:36,width:1136,height:1090},title:{x:40,y:1150,width:1120,height:300},placement:"bottom"};break;
  }
  if (placement && placement !== result.placement) return {
    area:{...result.area,y:1500-result.area.y-result.area.height},
    title:{...result.title,y:1500-result.title.y-result.title.height},placement,
  };
  return result;
}
function typeface(plan: DesignPlan): Typeface {
  const choice=plan.template?.font || plan.typographyPair || (plan.family==="retro_diner"?"heritage_slab":"editorial_serif");
  if(choice==="heritage_slab")return {family:"Rokkitt Variable",weight:900,maxSize:192,spacing:0};
  if(choice==="notebook_serif")return {family:"Special Elite",weight:400,maxSize:128,spacing:0};
  if(choice==="diner_slab")return {family:"Archivo Narrow Variable",weight:800,maxSize:208,spacing:0};
  return {family:"Fraunces Variable",weight:900,maxSize:202,spacing:0};
}
async function ensureFont(face: Typeface) {
  if (typeof document.fonts?.load !== "function") return;
  const loaded=await document.fonts.load(`${face.weight} 48px "${face.family}"`,"Recipe");
  if(!loaded.length)throw new Error("The design font could not load. Check your connection and try again.");
}
function setFont(ctx: CanvasRenderingContext2D, face: Typeface, size: number) {
  ctx.font = `${face.weight} ${size}px "${face.family}", Georgia, serif`;
  if("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & {letterSpacing:string}).letterSpacing=`${face.spacing}px`;
}
function fitLines(ctx: CanvasRenderingContext2D, title: string, box: Rectangle, face: Typeface, maxSize=face.maxSize) {
  for (let size = maxSize; size >= 18; size -= 2) {
    setFont(ctx,face,size);
    const lines: string[] = [];
    let line = "";
    // Preserve every character; prefer wrapping between words, splitting only
    // a word too wide to fit. Explicit newlines are retained as line breaks.
    for (const token of title.match(/\n|[^\S\n]+|[^\s]+/gu) || []) {
      if (token === "\n") { lines.push(line); line = ""; continue; }
      if (line && ctx.measureText(line + token).width > box.width - 90 && !/^\s+$/u.test(token)) { lines.push(line); line = ""; }
      const characters = typeof Intl.Segmenter === "function"
        ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(token), part => part.segment)
        : Array.from(token);
      for (const char of characters) {
        if (line && ctx.measureText(line + char).width > box.width - 90) { lines.push(line); line = char; }
        else line += char;
      }
    }
    lines.push(line);
    if (lines.length * size * 1.12 <= box.height - 42 && lines.every((l) => ctx.measureText(l).width <= box.width - 100)) return { lines, size };
  }
  throw new Error("This title is too long for the available title area. Shorten it and try again.");
}
function line(ctx: CanvasRenderingContext2D,x1:number,y1:number,x2:number,y2:number,color:string,width=2) {
  ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
}
function diamond(ctx: CanvasRenderingContext2D,x:number,y:number,r:number,color:string) {
  ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();ctx.fill();
}
function ornamentalRule(ctx: CanvasRenderingContext2D,x:number,y:number,w:number,color:string) {
  line(ctx,x,y,x+w*.37,y,color,2);line(ctx,x+w*.63,y,x+w,y,color,2);diamond(ctx,x+w/2,y,5,color);
  ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x+w*.37,y);ctx.quadraticCurveTo(x+w*.43,y-13,x+w*.47,y);ctx.moveTo(x+w*.53,y);ctx.quadraticCurveTo(x+w*.57,y+13,x+w*.63,y);ctx.stroke();
}
function titleShape(ctx:CanvasRenderingContext2D,family:DesignFamily,box:Rectangle) {
  const {x,y,width:w,height:h}=box;
  if(family==="black_label") {
    ctx.fillStyle="#1c1917";rounded(ctx,x,y,w,h,8);ctx.fill();ctx.strokeStyle="#c9a664";ctx.lineWidth=4;ctx.stroke();
    ctx.strokeStyle="#806743";ctx.lineWidth=1.5;rounded(ctx,x+10,y+10,w-20,h-20,4);ctx.stroke();
    ornamentalRule(ctx,x+w*.24,y+25,w*.52,"#b89a66");ornamentalRule(ctx,x+w*.24,y+h-25,w*.52,"#b89a66");
  } else if(family==="notebook") {
    ctx.fillStyle="#f5ead6";ctx.fillRect(x,y,w,h);ctx.strokeStyle="#a88775";ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
    for(let yy=y+48;yy<y+h-15;yy+=35)line(ctx,x+14,yy,x+w-14,yy,"rgba(140,157,151,.32)",1);
    line(ctx,x+32,y+14,x+32,y+h-14,"rgba(157,64,54,.45)",2);
  } else if(family==="retro_diner") {
    // A ticket silhouette with cut-in sides, a perforated spine and inked endcaps.
    ctx.fillStyle="#f6e6c8";ctx.beginPath();ctx.moveTo(x+12,y);ctx.lineTo(x+w-12,y);ctx.lineTo(x+w-12,y+h*.36);
    ctx.quadraticCurveTo(x+w-42,y+h*.5,x+w-12,y+h*.64);ctx.lineTo(x+w-12,y+h);ctx.lineTo(x+12,y+h);ctx.lineTo(x+12,y+h*.64);
    ctx.quadraticCurveTo(x+42,y+h*.5,x+12,y+h*.36);ctx.closePath();ctx.fill();ctx.strokeStyle="#8c302b";ctx.lineWidth=5;ctx.stroke();
    ctx.setLineDash([6,8]);line(ctx,x+58,y+15,x+58,y+h-15,"#b65c43",2);line(ctx,x+w-58,y+15,x+w-58,y+h-15,"#b65c43",2);ctx.setLineDash([]);
    diamond(ctx,x+34,y+h/2,7,"#8c302b");diamond(ctx,x+w-34,y+h/2,7,"#8c302b");
  } else {
    // Curved bakery-sign shape and a fine inner keyline, not a plain card.
    ctx.fillStyle="#f1e2c7";ctx.beginPath();ctx.moveTo(x+45,y);ctx.quadraticCurveTo(x+w/2,y+17,x+w-45,y);
    ctx.quadraticCurveTo(x+w-5,y+5,x+w-5,y+h/2);ctx.quadraticCurveTo(x+w-5,y+h-5,x+w-45,y+h);
    ctx.quadraticCurveTo(x+w/2,y+h-17,x+45,y+h);ctx.quadraticCurveTo(x+5,y+h-5,x+5,y+h/2);ctx.quadraticCurveTo(x+5,y+5,x+45,y);ctx.closePath();ctx.fill();ctx.strokeStyle="#815e45";ctx.lineWidth=3;ctx.stroke();
    ornamentalRule(ctx,x+w*.25,y+24,w*.5,"#a7825e");ornamentalRule(ctx,x+w*.25,y+h-24,w*.5,"#a7825e");
    diamond(ctx,x+35,y+h/2,5,"#a7825e");diamond(ctx,x+w-35,y+h/2,5,"#a7825e");
  }
}
function drawTitle(ctx: CanvasRenderingContext2D, family: DesignFamily, bounds: Rectangle, title: string, face: Typeface) {
  const initial=fitLines(ctx,title,bounds,face);setFont(ctx,face,initial.size);
  const needed=Math.max(...initial.lines.map(l=>ctx.measureText(l).width),0);
  const width=Math.min(bounds.width,Math.max(family==="retro_diner"?660:family==="heritage"?550:430,Math.ceil(needed+(family==="retro_diner"?260:190))));
  const box={x:Math.round(bounds.x+(bounds.width-width)/2),y:bounds.y,width,height:bounds.height};
  titleShape(ctx,family,box);
  const fitted=fitLines(ctx,title,box,face,initial.size);setFont(ctx,face,fitted.size);
  ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle=family==="black_label"?"#f5e8cd":family==="notebook"?"#702c31":family==="retro_diner"?"#752c29":"#4d2d25";
  const height=fitted.size*1.12;const start=box.y+box.height/2-(fitted.lines.length-1)*height/2;
  fitted.lines.forEach((lineText,index)=>ctx.fillText(lineText,box.x+box.width/2,start+index*height));
  return fitted.size;
}
async function drawBackdrop(ctx: CanvasRenderingContext2D, family: DesignFamily, artwork: Blob | null, background?:string): Promise<VisualQA["artworkTexture"]> {
  const base=background || TEMPLATE_COLORS[family].background;
  ctx.fillStyle=base;ctx.fillRect(0,0,1200,1500);
  if(!artwork)return "none";
  const before=ctx.getImageData(4,320,12,800).data;
  const bitmap=await createImageBitmap(artwork);
  // Reduce untrusted generated imagery to an abstract color texture before it
  // reaches the final composition; recognizable bowls, props and lettering
  // must not be introduced beside the protected photo.
  const sample=document.createElement("canvas");sample.width=18;sample.height=24;
  const s=getContext(sample);const scale=Math.max(18/bitmap.width,24/bitmap.height);
  s.drawImage(bitmap,(18-bitmap.width*scale)/2,(24-bitmap.height*scale)/2,bitmap.width*scale,bitmap.height*scale);bitmap.close();
  ctx.save();ctx.globalAlpha=.30;ctx.filter="blur(30px)";ctx.drawImage(sample,-30,-30,1260,1560);ctx.restore();
  const after=ctx.getImageData(4,320,12,800).data;let delta=0;
  for(let i=0;i<after.length;i+=4)delta+=Math.abs(after[i]-before[i])+Math.abs(after[i+1]-before[i+1])+Math.abs(after[i+2]-before[i+2]);
  return delta/(after.length/4*3)>2?"visible":"subtle";
}
function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve,reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode the PNG.")),"image/png"));
}
export async function renderIngredientsCard(title: string, ingredients: string): Promise<Blob> {
  if (!title.trim() || !ingredients.trim() || ingredients.length > 2000) throw new Error("Enter a title and up to 2000 characters of ingredients for the separate card.");
  const canvas=document.createElement("canvas");canvas.width=1200;canvas.height=1500;
  const ctx=getContext(canvas);ctx.fillStyle="#dfd1b6";ctx.fillRect(0,0,1200,1500);
  ctx.fillStyle="#f8f1e2";ctx.fillRect(42,42,1116,1416);ctx.strokeStyle="#bdaa8d";ctx.lineWidth=3;ctx.strokeRect(42,42,1116,1416);
  const heading={x:100,y:85,width:1000,height:220};
  const face:Typeface={family:"Fraunces Variable",weight:700,maxSize:90,spacing:0};await ensureFont(face);
  drawTitle(ctx,"notebook",heading,title,face);
  const bodyFace:Typeface={family:"Fraunces Variable",weight:400,maxSize:66,spacing:0};
  const box={x:105,y:345,width:990,height:1020};const {lines,size}=fitLines(ctx,ingredients,box,bodyFace);
  setFont(ctx,bodyFace,size);ctx.fillStyle="#352a25";ctx.textAlign="left";ctx.textBaseline="top";
  const lineHeight=size*1.15;lines.forEach((line,index)=>ctx.fillText(line,box.x+45,box.y+index*lineHeight));
  return png(canvas);
}
export function assertProtectedPixels(expected: Uint8ClampedArray, actual: Uint8ClampedArray): void {
  if (expected.length !== actual.length) throw new Error("Protected photo dimensions changed. Export blocked.");
  let differences = 0;
  for (let i=0; i<actual.length; i++) if (actual[i] !== expected[i]) differences++;
  if (differences) throw new Error(`Protected photo verification failed (${differences} channel differences). Export blocked.`);
}
export async function renderProtectedDesign(args: { source: LocalPhoto; artwork: Blob | null; plan: DesignPlan; title: string; noText: boolean; priority?: "food_first" | "balanced" }): Promise<RenderedDesign> {
  const sourceHash = await digest(args.source.blob);
  if (sourceHash !== args.source.sha256) throw new Error("Original photo hash changed. Export blocked.");
  const face=typeface(args.plan);if(!args.noText)await ensureFont(face);
  const source = await createImageBitmap(args.source.blob, { imageOrientation:"from-image" });
  const canvas = document.createElement("canvas"); canvas.width=1200; canvas.height=1500;
  const ctx = getContext(canvas);
  const artworkTexture=await drawBackdrop(ctx,args.plan.family,args.artwork,args.plan.template?.background);
  const layout=recipeDesignLayout(args.plan.family,args.plan.titlePlacement);
  const baseArea = args.noText ? {x:40,y:40,width:1120,height:1420} : layout.area;
  const inset = args.priority === "balanced" ? 55 : 0;
  const area = {x:baseArea.x+inset,y:baseArea.y+inset,width:baseArea.width-2*inset,height:baseArea.height-2*inset};
  const scale=Math.min(area.width/source.width,area.height/source.height);
  const width=Math.max(1,Math.round(source.width*scale)), height=Math.max(1,Math.round(source.height*scale));
  const rect={x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width,height};
  if (!args.noText && intersect(rect,layout.title)) { source.close(); throw new Error("The title overlaps the protected photo. Export blocked."); }
  let scene;
  try { scene=await renderRecipeScene(ctx,{family:args.plan.family,title:args.title,noText:args.noText,titleBox:layout.title,photoRect:rect,face,template:args.plan.template}); }
  catch(e){source.close();throw e;}
  const titleSize=scene.titleSize;
  const working=document.createElement("canvas"); working.width=width; working.height=height;
  const photoCtx=getContext(working); photoCtx.fillStyle="#ffffff"; photoCtx.fillRect(0,0,width,height);
  photoCtx.imageSmoothingEnabled=true; photoCtx.imageSmoothingQuality="high";
  photoCtx.drawImage(source,0,0,width,height); source.close();
  const expected=photoCtx.getImageData(0,0,width,height);
  const workingSha256=await digest(expected.data);
  // Copy opaque, normalized pixels once, at integer coordinates, after all decoration.
  ctx.putImageData(expected,rect.x,rect.y);
  const blob=await png(canvas);
  const decoded=await createImageBitmap(blob);
  if (decoded.width!==1200 || decoded.height!==1500 || blob.type!=="image/png") { decoded.close(); throw new Error("PNG dimensions failed validation. Export blocked."); }
  const check=document.createElement("canvas"); check.width=1200; check.height=1500;
  const checkCtx=getContext(check); checkCtx.drawImage(decoded,0,0); decoded.close();
  const actual=checkCtx.getImageData(rect.x,rect.y,width,height).data;
  assertProtectedPixels(expected.data, actual);
  if(await digest(args.source.blob)!==sourceHash) throw new Error("Original photo changed during rendering. Export blocked.");
  const notes=["Visual quality requires owner review; pixel verification is a separate technical check."];
  if(titleSize!==null && titleSize<40)notes.push("The long title may be small on a phone preview.");
  if(artworkTexture==="subtle")notes.push("The generated color texture is subtle; inspect the margins.");
  const aspect=recipeDesignAspect(args.source.width,args.source.height);
  return { blob, qa:{originalSha256:sourceHash,workingSha256,outputSha256:await digest(blob),photoRect:rect,pixelDifferences:0,title:args.noText?"":args.title,transformations:["EXIF orientation applied on decode", "Converted to browser canvas sRGB", `Proportional contain: ${args.source.width}×${args.source.height} → ${width}×${height}`, "Decorative layers rendered with Fabric.js", "Composited as opaque pixels at integer coordinates", "Lossless PNG"],visual:{reviewRequired:true,font:face.family,titleSize,artworkTexture,notes},designSignature:recipeDesignSignature(args.plan.family,layout.placement,aspect),sceneJson:scene.sceneJson} };
}
