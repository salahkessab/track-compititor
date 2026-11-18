export const pinTemplates = [
  {id:'retro', name:'Retro ribbon', color:'#F5AF54', ink:'#251A13', layout:'A hero photo, bold ribbon and one or two detail photos'},
  {id:'stack', name:'Editorial diptych', color:'#F5F0E6', ink:'#332C26', layout:'Two stacked photos separated by a typeset title'},
  {id:'pair', name:'Side by side', color:'#30483D', ink:'#FFFFFF', layout:'A split view under a deep green headline'},
  {id:'detail', name:'Detail inset', color:'#733A47', ink:'#FFFFFF', layout:'A full-bleed photo with a framed detail and footer'},
  {id:'steps', name:'Process strip', color:'#263E56', ink:'#FFFFFF', layout:'A sequence of two details above the final result'},
] as const;
export type PinStyle = typeof pinTemplates[number]['id'];
export type PinPhoto = {url:string; label:string};
export type PinArticle = {title:string; text:string; textUrl?:string; link:string; photos:PinPhoto[]; first:number};
export function sendToPinStudio(article:PinArticle) {
  window.sessionStorage.setItem('pin-article',JSON.stringify(article));
  window.history.pushState(null,'','/?tab=pinterest-design');
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.dispatchEvent(new Event('pin-article-changed'));
}

type Photo = ImageBitmap;
type Align = 'center' | 'left';

function paintPin(ctx:CanvasRenderingContext2D, style:PinStyle, images:Photo[], title:string, hook:string) {
  const cream='#fff5dd', black='#231c16';
  function rect(x:number,y:number,w:number,h:number,color:string) {
    ctx.fillStyle=color;ctx.fillRect(x,y,w,h);
  }
  function photo(index:number,x:number,y:number,w:number,h:number) {
    const image=images[index];
    const scale=Math.max(w/image.width,h/image.height);
    const sw=w/scale,sh=h/scale;
    ctx.drawImage(image,(image.width-sw)/2,(image.height-sh)/2,sw,sh,x,y,w,h);
  }
  function details(y:number,h:number,x=0,w=1000,gap=12) {
    if(images.length===2) photo(1,x,y,w,h);
    if(images.length===3) {
      const half=(w-gap)/2;
      photo(1,x,y,half,h);photo(2,x+half+gap,y,half,h);
    }
  }
  function lettering(value:string,x:number,y:number,w:number,h:number,max:number,face:string,
                     ink:string,align:Align='center',outline=false) {
    const words=value.trim().split(/\s+/u);
    if(!words[0])return;
    let size=max,lines:string[]=[];
    for(;size>=12;size--){
      ctx.font=face.replace('@',size+'px');
      lines=[];
      let line='';
      for(const word of words){
        const next=line?line+' '+word:word;
        if(line && ctx.measureText(next).width>w){lines.push(line);line=word;}else line=next;
      }
      lines.push(line);
      if(lines.length*size*1.08<=h && lines.every(s=>ctx.measureText(s).width<=w))break;
    }
    ctx.textBaseline='middle';ctx.textAlign=align;ctx.lineJoin='round';
    const tx=align==='center'?x+w/2:x;
    const leading=size*1.08;
    lines.forEach((line,i)=>{
      const ty=y+h/2+(i-(lines.length-1)/2)*leading;
      if(outline){ctx.lineWidth=Math.max(3,size*.09);ctx.strokeStyle=black;ctx.strokeText(line,tx,ty,w);}
      ctx.fillStyle=ink;ctx.fillText(line,tx,ty,w);
    });
  }
  const serif='bold @ Georgia,serif', italic='italic @ Georgia,serif';
  const poster='900 @ Impact,"Arial Black",sans-serif';
  const multiple=images.length>1;
  rect(0,0,1000,1500,cream);
  if(style==='retro'){
    photo(0,0,0,1000,multiple?870:1500);
    if(multiple)details(918,582,0,1000,12);
    const y=multiple?824:1110;
    ctx.save();ctx.translate(500,y);ctx.rotate(-.033);
    rect(-548,-137,1096,295,'#542a20');
    rect(-548,-148,1096,287,'#ffc56a');
    rect(-548,-133,1096,4,'#914326');rect(-548,122,1096,4,'#914326');
    if(hook)lettering(hook,-440,-131,880,81,63,italic,black);
    lettering(title.toLocaleUpperCase(),-452,hook?-44:-119,904,hook?158:236,114,poster,cream,'center',true);
    ctx.restore();
  }else if(style==='stack'){
    rect(0,0,1000,1500,'#f8f1e4');
    photo(0,32,32,936,multiple?624:910);
    if(multiple)details(983,485,32,936,12);
    const y=multiple?681:983;
    rect(52,y,68,7,'#922e26');
    lettering(title,48,y+25,904,multiple?166:258,115,serif,'#462721','left');
    if(hook)lettering(hook,52,y+(multiple?197:290),896,80,47,italic,'#813d32','left');
  }else if(style==='pair'){
    rect(0,0,1000,1500,'#183c33');
    lettering(title,54,42,892,hook?212:272,119,serif,'#ffefd3','left');
    if(hook)lettering(hook,58,260,885,72,47,italic,'#deebc8','left');
    rect(56,357,888,3,'#b4bd97');
    photo(0,34,394,multiple?554:932,1072);
    if(multiple)photo(1,604,394,362,images.length===3?525:1072);
    if(images.length===3)photo(2,604,935,362,531);
  }else if(style==='detail'){
    photo(0,0,0,1000,1500);
    for(let i=1;i<images.length;i++){
      const x=images.length===3?52+(i-1)*314:52;
      ctx.save();ctx.translate(x+144,814);ctx.rotate(i===1?-.052:.036);
      ctx.shadowColor='#21171466';ctx.shadowBlur=18;ctx.shadowOffsetY=8;
      rect(-145,-155,290,310,'#fff9ef');ctx.shadowColor='transparent';
      photo(i,-133,-143,266,286);ctx.restore();
    }
    rect(42,1018,916,418,'#fff4df');rect(62,1042,7,369,'#8b3444');
    lettering(title,98,1060,812,hook?224:320,113,serif,'#502331','left');
    if(hook)lettering(hook,102,1290,805,98,49,italic,'#723847','left');
  }else{
    rect(0,0,1000,1500,'#172d42');
    if(multiple)details(26,364,26,948,14);
    const y=multiple?407:0;
    photo(0,0,y,1000,1500-y);
    const gradient=ctx.createLinearGradient(0,918,0,1500);
    gradient.addColorStop(0,'rgba(9,23,35,0)');gradient.addColorStop(.40,'rgba(9,23,35,.91)');gradient.addColorStop(1,'#091723');
    ctx.fillStyle=gradient;ctx.fillRect(0,918,1000,582);
    rect(58,1141,76,8,'#f5ba71');
    lettering(title.toLocaleUpperCase(),53,1170,894,hook?172:260,102,poster,'#fff6e4','left');
    if(hook)lettering(hook,58,1360,886,88,50,italic,'#ffce87','left');
  }
}

export async function composePin(style:PinStyle, photos:Blob[], title:string, hook:string):Promise<Blob> {
  if(!photos.length || photos.length>3 || !title.trim())throw new Error('Choose one to three photos and enter a headline.');
  const canvas=document.createElement('canvas');
  canvas.width=1000;canvas.height=1500;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas is unavailable.');
  const images:ImageBitmap[]=[];
  try{
    for(const blob of photos)images.push(await createImageBitmap(blob));
    paintPin(ctx,style,images,title,hook.trim());
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG export failed.')),'image/png'));
  } finally {images.forEach(i=>i.close());}
}
