import type { DesignFamily, DesignPlan, TemplateEdits } from "./recipeDesigns";

type Box = {x:number;y:number;width:number;height:number};
type Face = {family:string;weight:number;maxSize:number;spacing:number};
export type RecipeSceneResult = {titleSize:number|null;sceneJson:string;objectCount:number};
type Colors = {background:string;panel:string;accent:string;ink:string};

/** Curated stock-and-ink systems; the protected photograph is a separate layer. */
export const TEMPLATE_COLORS: Record<DesignFamily,Colors> = {
  black_label:{background:"#142B3A",panel:"#182C3C",accent:"#D6AD65",ink:"#FFF1D1"},
  notebook:{background:"#49352A",panel:"#F3E2C5",accent:"#A2352B",ink:"#812821"},
  retro_diner:{background:"#8B2C24",panel:"#F6E3C4",accent:"#A83225",ink:"#792018"},
  heritage:{background:"#594536",panel:"#F2E1C1",accent:"#77613D",ink:"#542E24"},
  farmhouse:{background:"#6B4A32",panel:"#FFF0CC",accent:"#AD392C",ink:"#722B24"},
  minimal:{background:"#263E2F",panel:"#F6E7CD",accent:"#385B3A",ink:"#82241C"},
  editorial:{background:"#1E2925",panel:"#F4E8D5",accent:"#D35336",ink:"#1E2925"},
  mediterranean:{background:"#123B66",panel:"#F6E9D0",accent:"#C56945",ink:"#123B66"},
};
export function resolveTemplateColors(family:DesignFamily,edits?:TemplateEdits):Colors {
  const base=TEMPLATE_COLORS[family];
  return {background:edits?.background??base.background,panel:edits?.panel??base.panel,accent:edits?.accent??base.accent,ink:edits?.ink??base.ink};
}
function luminance(hex:string):number {
  const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*c[0]+.7152*c[1]+.0722*c[2];
}
function contrast(a:string,b:string):number {const [light,dark]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (light+.05)/(dark+.05);}
/** Read-only reference analysis affects the actual printed panel, not just a thin border. */
export function referenceTemplate(plan:DesignPlan,strength:"low"|"medium"|"high"):TemplateEdits | undefined {
  if(plan.evidenceMode!=="uploaded_reference" || strength==="low")return undefined;
  const colors=plan.palette.filter(c=>/^#[0-9a-f]{6}$/i.test(c));
  const base=TEMPLATE_COLORS[plan.family];
  const dark=plan.family==="black_label";
  const panel=colors.find(c=>dark?luminance(c)<.22:luminance(c)>.62);
  const label=panel||base.panel;
  const ink=colors.find(c=>contrast(c,label)>=4.5) || (contrast(base.ink,label)>=4.5?base.ink:dark?"#FFF1D1":"#422B25");
  const accent=colors.find(c=>contrast(c,label)>=2 && c!==ink);
  const hierarchy=(plan.styleDNA?.titleHierarchy||"").toLowerCase();
  const font:TemplateEdits["font"]=/(condensed|narrow)/.test(hierarchy)?"diner_slab":/(typewriter|stamped)/.test(hierarchy)?"notebook_serif":undefined;
  return {panel,ink,accent,font};
}
function titleParts(title:string):{lead:string;focus:string}|null {
  // A line break stands in for one separating space; spelling and case stay intact.
  if(title.length>32 || title.trim()!==title || /\s{2}|\n/.test(title))return null;
  const words=title.split(" ");
  if(words.length<2 || words.length>4)return null;
  return {lead:words.slice(0,-1).join(" "),focus:words.at(-1)!};
}

/** Fabric holds editable decorative objects. The original food photo never enters it. */
export async function renderRecipeScene(ctx:CanvasRenderingContext2D,args:{family:DesignFamily;title:string;noText:boolean;titleBox:Box;photoRect:Box;face:Face;template?:TemplateEdits}):Promise<RecipeSceneResult> {
  const F=await import("fabric");
  const el=document.createElement("canvas");el.width=1200;el.height=1500;
  const stage=new F.StaticCanvas(el,{width:1200,height:1500,enableRetinaScaling:false,renderOnAddRemove:false});
  const family=args.family,style=resolveTemplateColors(family,args.template),box=args.titleBox,photo=args.photoRect;
  const above=box.y<photo.y, x=box.x,y=box.y,w=box.width,h=box.height;
  const add=(...items:InstanceType<typeof F.FabricObject>[])=>stage.add(...items);
  const rect=(left:number,top:number,width:number,height:number,fill:string|InstanceType<typeof F.Pattern>,stroke?:string,sw=1,extra:Record<string,unknown>={})=>new F.Rect({left,top,width,height,fill,stroke,strokeWidth:sw,originX:"left",originY:"top",selectable:false,evented:false,...extra});
  const line=(x1:number,y1:number,x2:number,y2:number,color:string,width=2,dash?:number[])=>new F.Line([x1,y1,x2,y2],{stroke:color,strokeWidth:width,strokeDashArray:dash,selectable:false,evented:false});
  const ellipse=(cx:number,cy:number,rx:number,ry:number,angle:number,fill:string)=>new F.Ellipse({left:cx-rx,top:cy-ry,rx,ry,angle,fill,selectable:false,evented:false});
  const poly=(points:{x:number;y:number}[],fill:string|InstanceType<typeof F.Pattern>,stroke?:string,sw=1)=>new F.Polygon(points,{fill,stroke,strokeWidth:sw,selectable:false,evented:false});
  const path=(d:string,stroke:string,width=2)=>new F.Path(d,{fill:"",stroke,strokeWidth:width,selectable:false,evented:false});
  const shadow=(blur=14,offsetY=6)=>new F.Shadow({color:"rgba(24,15,10,.38)",blur,offsetY});
  const mat=(fill:string,edge:string,pad:number)=>add(rect(photo.x-pad,photo.y-pad,photo.width+pad*2,photo.height+pad*2,fill,edge,2,{shadow:shadow(13,5)}));
  const diamond=(cx:number,cy:number,r:number,color:string)=>poly([{x:cx,y:cy-r},{x:cx+r,y:cy},{x:cx,y:cy+r},{x:cx-r,y:cy}],color);
  const rule=(left:number,right:number,cy:number,color:string)=>{
    add(line(left,cy,(left+right)/2-17,cy,color,2),diamond((left+right)/2,cy,5,color),line((left+right)/2+17,cy,right,cy,color,2));
  };
  const branch=(cx:number,cy:number,sx:number,sy:number,color:string)=>{
    add(path(`M ${cx} ${cy} Q ${cx+sx*24} ${cy+sy*10} ${cx+sx*86} ${cy+sy*72}`,color,2.5));
    for(const [a,b,angle] of [[25,14,-35],[47,29,30],[65,50,-35]]){
      add(ellipse(cx+sx*a,cy+sy*b,6,13,angle*sx*sy,color));
    }
  };
  // Small, deterministic paper flecks sit only on the title stock.
  const paper=(left:number,top:number,width:number,height:number,color:string)=>{
    let seed=37;
    for(let i=0;i<84;i++){
      seed=(seed*1664525+1013904223)>>>0;const fx=(seed%1000)/1000;
      seed=(seed*1664525+1013904223)>>>0;const fy=(seed%1000)/1000;
      add(rect(left+12+fx*(width-24),top+12+fy*(height-24),i%7===0?3:1.4,i%7===0?1.2:1.4,color));
    }
  };
  const printedStock=(color:string,dark=false)=>{
    const tile=document.createElement("canvas");tile.width=96;tile.height=96;
    const p=tile.getContext("2d")!;p.fillStyle=color;p.fillRect(0,0,96,96);
    let seed=641;
    for(let i=0;i<950;i++){
      seed=(seed*1664525+1013904223)>>>0;const px=seed%96;
      seed=(seed*1664525+1013904223)>>>0;const py=seed%96;
      p.fillStyle=dark?(i%3===0?"rgba(255,232,177,.09)":"rgba(0,0,0,.16)"):(i%3===0?"rgba(255,255,240,.27)":"rgba(92,54,27,.10)");
      p.fillRect(px,py,i%9===0?2:1,i%9===0?2:1);
    }
    return new F.Pattern({source:tile,repeat:"repeat"});
  };
  const gingham=(top:number,color:string,cream:string)=>{
    add(rect(17,top,1166,40,cream));
    for(let col=0;col<48;col++)for(let row=0;row<2;row++)if((col+row)%2===0)add(rect(17+col*24.3,top+row*20,24.3,20,color));
    add(line(16,top,1184,top,"rgba(55,28,20,.46)",2),line(16,top+40,1184,top+40,"rgba(55,28,20,.46)",2));
  };
  const flower=(cx:number,cy:number,scale:number)=>{
    for(let i=0;i<6;i++){
      const angle=i*Math.PI/3;
      add(ellipse(cx+Math.cos(angle)*14*scale,cy+Math.sin(angle)*14*scale,7*scale,13*scale,i*60,"#E8D5AC"));
    }
    add(new F.Circle({left:cx-6*scale,top:cy-6*scale,radius:6*scale,fill:"#AB402E",selectable:false,evented:false}));
    add(ellipse(cx+28*scale,cy+18*scale,8*scale,18*scale,-42,"#526341"));
    add(ellipse(cx-27*scale,cy-17*scale,8*scale,18*scale,-42,"#526341"));
  };

  if(family==="black_label"){
    add(rect(14,17,1172,1466,"transparent",style.accent,3),rect(24,27,1152,1446,"transparent","rgba(246,220,172,.48)",1));
    for(const [px,py,sx,sy] of [[44,45,1,1],[1156,45,-1,1],[44,1455,1,-1],[1156,1455,-1,-1]])branch(px,py,sx,sy,style.accent);
    mat("#F3DFBB",style.accent,13);
    if(!args.noText){
      add(rect(x+9,y+10,w,h,style.accent,undefined,0,{shadow:shadow(16,7)}));
      add(poly([{x:x+25,y},{x:x+w-25,y},{x:x+w,y:y+24},{x:x+w,y:y+h-24},{x:x+w-25,y:y+h},{x:x+25,y:y+h},{x,y:y+h-24},{x,y:y+24}],printedStock(style.panel,true),style.accent,4));
      add(rect(x+15,y+15,w-30,h-30,"transparent","rgba(253,226,177,.46)",1));
      rule(x+130,x+w-130,y+34,style.accent);rule(x+130,x+w-130,y+h-34,style.accent);
      add(path(`M ${x+34} ${y+80} Q ${x+73} ${y+24} ${x+122} ${y+79} M ${x+w-34} ${y+80} Q ${x+w-73} ${y+24} ${x+w-122} ${y+79}`,style.accent,3));
      for(const px of [x+55,x+w-55])for(const py of [y+65,y+h-65])add(diamond(px,py,9,style.accent));
      paper(x+18,y+18,w-36,h-36,"rgba(251,228,185,.15)");
    }
  } else if(family==="notebook"){
    add(rect(19,22,1162,1456,"transparent","#C4A37B",2));
    mat("#F8E7C8","#D7BA8B",14);
    if(!args.noText){
      add(rect(x+10,y+10,w-20,h-8,"#C0A27D",undefined,0,{shadow:shadow(20,8)}));
      add(rect(x,y,w,h,printedStock(style.panel),"#8B694A",3,{rx:11,ry:11}));
      for(let yy=y+47;yy<y+h-18;yy+=40)add(line(x+27,yy,x+w-27,yy,"rgba(70,105,102,.35)",2));
      add(line(x+66,y+16,x+66,y+h-17,"rgba(161,55,50,.70)",3));
      for(let yy=y+59;yy<y+h-20;yy+=80)add(new F.Circle({left:x+24,top:yy,radius:11,fill:"#BAA387",stroke:"#6E5944",strokeWidth:2,selectable:false,evented:false}));
      const tabY=above?y+h:y-17;
      add(poly([{x:x+w*.39,y:tabY},{x:x+w*.43,y:tabY-21},{x:x+w*.57,y:tabY-21},{x:x+w*.61,y:tabY}],style.panel,"#8B694A",2));
      gingham(above?y+h+10:y-29,style.accent,"#F6E2C2");
      paper(x+16,y+16,w-32,h-32,"rgba(119,73,45,.14)");
      branch(x+w-108,y+28,-1,1,style.accent);
      rule(x+91,x+w-88,y+h-27,style.accent);
    }
  } else if(family==="retro_diner"){
    add(rect(17,17,1166,1466,"transparent","#F4DDB8",3));
    mat("#F7E4C7","#E3BB8A",13);
    if(!args.noText){
      add(poly([{x:x+43,y:y+14},{x:x+w-25,y:y+14},{x:x+w+8,y:y+45},{x:x+w-12,y:y+h-14},{x:x+20,y:y+h-5},{x:x-10,y:y+h-32}],style.background,undefined,0));
      add(poly([{x:x+31,y},{x:x+w-30,y},{x:x+w,y:y+28},{x:x+w-13,y:y+h-20},{x:x+w-38,y:y+h},{x:x+16,y:y+h},{x:x-8,y:y+h-29}],printedStock(style.panel),style.accent,4));
      add(line(x+58,y+20,x+w-60,y+20,style.accent,2),line(x+58,y+h-20,x+w-60,y+h-20,style.accent,2));
      for(const bx of [x+33,x+w-33])add(diamond(bx,y+h/2,6,style.accent));
      paper(x+20,y+14,w-40,h-28,"rgba(120,73,40,.18)");
      gingham(above?y+h+9:y-36,style.accent,"#F4D9B4");
    }
  } else if(family==="farmhouse"){
    add(rect(19,21,1162,1458,"transparent","#D9B776",5),rect(28,30,1144,1440,"transparent","#A74333",2));
    for(const [fx,fy,s] of [[65,70,1.05],[1113,67,.9],[70,1392,1.15],[1112,1394,1.05]] as const)flower(fx,fy,s);
    mat("#F7E7C9","#B78950",17);
    if(!args.noText){
      add(rect(x+12,y+13,w-24,h-7,"#B79668",undefined,0,{shadow:shadow(25,9)}));
      add(new F.Path(`M ${x+44} ${y+4} Q ${x+w*.5} ${y-20} ${x+w-44} ${y+4} Q ${x+w+6} ${y+16} ${x+w-4} ${y+52} L ${x+w-4} ${y+h-52} Q ${x+w+9} ${y+h-12} ${x+w-43} ${y+h-4} Q ${x+w*.5} ${y+h+18} ${x+43} ${y+h-4} Q ${x-8} ${y+h-12} ${x+4} ${y+h-52} L ${x+4} ${y+52} Q ${x-7} ${y+15} ${x+44} ${y+4} Z`,{fill:printedStock(style.panel),stroke:"#A96645",strokeWidth:4,selectable:false,evented:false}));
      add(rect(x+22,y+27,w-44,h-54,"transparent",style.accent,1,{rx:12,ry:12}));
      gingham(above?y+h+10:y-34,style.accent,"#FFECD0");
      rule(x+140,x+w-140,y+33,"#526341");rule(x+140,x+w-140,y+h-34,"#526341");
      flower(x+67,y+h-82,1.15);flower(x+w-67,y+h-82,1.15);
      add(path(`M ${x+43} ${y+75} Q ${x+103} ${y+30} ${x+157} ${y+70} M ${x+w-43} ${y+75} Q ${x+w-103} ${y+30} ${x+w-157} ${y+70}`,"#526341",3));
      paper(x+18,y+18,w-36,h-36,"rgba(125,70,38,.17)");
    }
  } else if(family==="heritage"){
    add(rect(12,12,1176,1476,"#E4CFA9","#7D5B3E",5,{shadow:shadow(18,7)}));
    add(rect(28,28,1144,1444,printedStock("#F3E4C7"),"#A27C50",2));
    add(line(48,39,48,1460,"#B29068",3),line(57,39,57,1460,"rgba(103,74,48,.45)",1));
    add(rect(67,41,1092,1418,"transparent","#8B6B42",2));
    paper(70,50,1060,1380,"rgba(128,84,44,.15)");
    mat("#F7E6C7","#8D693E",14);
    if(!args.noText){
      add(line(x+55,y+24,x+w-55,y+24,"#825D3D",3),line(x+75,y+34,x+w-75,y+34,"#C29C67",1));
      add(line(x+55,y+h-26,x+w-55,y+h-26,"#825D3D",3),line(x+75,y+h-36,x+w-75,y+h-36,"#C29C67",1));
      branch(x+62,y+55,1,1,"#626A3E");branch(x+w-62,y+55,-1,1,"#626A3E");
      branch(x+62,y+h-55,1,-1,"#626A3E");branch(x+w-62,y+h-55,-1,-1,"#626A3E");
      rule(x+186,x+w-186,y+53,style.accent);rule(x+186,x+w-186,y+h-54,style.accent);
    }
  } else {
    add(rect(15,15,1170,1470,"transparent","#C09D6A",3),rect(26,26,1148,1448,"transparent",style.accent,2));
    mat("#F3E0BB","#A98A5C",14);
    if(!args.noText){
      add(rect(x+5,y+8,w-10,h-4,"#BA9B71",undefined,0,{shadow:shadow(17,6)}));
      add(rect(x,y,w,h,style.panel,"#AE885B",3,{rx:14,ry:14}));
      add(rect(x+16,y+14,w-32,h-28,"transparent",style.accent,1));
      for(const [bx,by,sx,sy] of [[x+35,y+32,1,1],[x+w-35,y+32,-1,1],[x+35,y+h-32,1,-1],[x+w-35,y+h-32,-1,-1]])branch(bx,by,sx,sy,style.accent);
      rule(x+155,x+w-155,y+34,style.accent);rule(x+155,x+w-155,y+h-34,style.accent);
      paper(x+18,y+18,w-36,h-36,"rgba(132,82,42,.15)");
      gingham(above?y+h+12:y-33,"#A03930","#F2E1C2");
    }
  }

  let titleSize:number|null=null;
  if(!args.noText){
    const loadFont=async(familyName:string,weight:number)=>{
      if(typeof document.fonts?.load==="function")await document.fonts.load(`${weight} 48px "${familyName}"`,"Recipe");
    };
    if(family==="notebook")await loadFont("Special Elite",400);
    if(family==="retro_diner")await loadFont("Archivo Narrow Variable",800);
    const align: "left"|"center"|"right"=args.template?.alignment||(family==="notebook"?"left":"center");
    const title=(value:string,area:Box,options:{font:string;weight:number;max:number;min?:number;fill:string;align?:"left"|"center"|"right";shadow?:InstanceType<typeof F.Shadow>})=>{
      const t=new F.Textbox(value,{left:area.x,top:area.y,width:area.width,fontFamily:options.font,fontWeight:options.weight,fontSize:options.max,
        lineHeight:.88,charSpacing:0,fill:options.fill,textAlign:options.align||align,splitByGrapheme:false,
        shadow:options.shadow,originX:"left",originY:"top",selectable:false,evented:false});
      let size=options.max;
      while((t.height>area.height || t.width>area.width) && size>(options.min||20)){size-=2;t.set({fontSize:size,width:area.width});t.initDimensions();}
      if(t.height>area.height || t.width>area.width)throw new Error("This title is too long for the available title area. Shorten it and try again.");
      t.set({top:area.y+(area.height-t.height)/2});add(t);
      return size;
    };
    const scale=args.template?.titleScale||1,parts=titleParts(args.title);
    // A two-word diner title reads stronger as one large sign line. Reserve the
    // small lead / huge final-word treatment for longer titles.
    const split=parts && (family==="notebook" || family==="farmhouse" || family==="black_label" || family==="heritage" || (family==="retro_diner" && parts.lead.includes(" ")));
    if(split){
      const left=family==="notebook"?x+92:family==="heritage"?x+120:x+67,innerW=family==="notebook"?w-180:family==="heritage"?w-240:w-134;
      const leadArea={x:left,y:y+39,width:innerW,height:75};
      const focusArea={x:left,y:y+110,width:innerW,height:h-142};
      title(parts.lead,leadArea,{font:family==="notebook"?"Special Elite":family==="retro_diner"?"Archivo Narrow Variable":"Fraunces Variable",weight:family==="notebook"?400:800,
        max:Math.round((family==="notebook"?73:family==="retro_diner"?94:86)*scale),fill:family==="black_label"?style.accent:style.ink,align:family==="notebook"?"left":align});
      titleSize=title(parts.focus,focusArea,{font:args.face.family,weight:args.face.weight,max:Math.round((family==="notebook"?174:family==="retro_diner"?214:190)*scale),fill:style.ink,
        align:family==="notebook"?"left":align,shadow:family==="retro_diner"?new F.Shadow({color:"rgba(202,133,66,.66)",offsetX:3,offsetY:4,blur:0}):undefined});
    } else {
      const margin=family==="black_label"?75:family==="heritage"?84:family==="notebook"?85:74;
      const topSpace=family==="black_label"?54:family==="heritage"?58:39;
      const area={x:x+margin,y:y+topSpace,width:w-2*margin,height:h-topSpace-(family==="black_label"?52:family==="heritage"?55:42)};
      titleSize=title(args.title,area,{font:args.face.family,weight:args.face.weight,max:Math.round(args.face.maxSize*scale),fill:style.ink});
    }
  }
  stage.renderAll();
  const sceneJson=JSON.stringify(stage.toJSON()),objectCount=stage.size();
  ctx.drawImage(el,0,0);
  await stage.dispose();
  return {titleSize,sceneJson,objectCount};
}
