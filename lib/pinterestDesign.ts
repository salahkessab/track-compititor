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

export async function composePin(style:PinStyle, photos:Blob[], title:string, hook:string):Promise<Blob> {
  if(!photos.length || !title.trim())throw new Error('Choose at least one photo and enter a headline.');
  const canvas=document.createElement('canvas');
  canvas.width=1000;canvas.height=1500;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas is unavailable.');
  const images:ImageBitmap[]=[];
  try {
    for(const photo of photos)images.push(await createImageBitmap(photo));
    const theme=pinTemplates.find(t=>t.id===style)!;
    function rect(x:number,y:number,w:number,h:number,color:string){ctx!.fillStyle=color;ctx!.fillRect(x,y,w,h);}
    function picture(i:number,x:number,y:number,w:number,h:number){
      const image=images[i] || images[0];
      const scale=Math.max(w/image.width,h/image.height);
      ctx!.drawImage(image,(image.width-w/scale)/2,(image.height-h/scale)/2,w/scale,h/scale,x,y,w,h);
    }
    function type(value:string,top:number,height:number,size:number,font:string,color:string,outline=false){
      if(!value.trim())return;
      let lines:string[]=[];
      for(;size>=14;size-=2){
        ctx!.font=font.replace('SIZE',String(size));lines=[''];
        for(const word of value.trim().split(/\s+/)){
          const last=lines.length-1,next=[lines[last],word].filter(Boolean).join(' ');
          if(lines[last] && ctx!.measureText(next).width>888)lines.push(word);else lines[last]=next;
        }
        if(lines.length*size*1.13<=height && lines.every(l=>ctx!.measureText(l).width<=888))break;
      }
      ctx!.textAlign='center';ctx!.textBaseline='middle';ctx!.lineJoin='round';
      let y=top+height/2-(lines.length-1)*size*.565;
      for(const line of lines){
        if(outline){ctx!.strokeStyle='#201914';ctx!.lineWidth=Math.max(4,size*.085);ctx!.strokeText(line,500,y,888);}
        ctx!.fillStyle=color;ctx!.fillText(line,500,y,888);y+=size*1.13;
      }
    }
    function band(top:number,height:number,serif=false){
      rect(0,top,1000,height,theme.color);
      const k=hook.trim()?Math.round(height*.32):0;
      type(hook,top+8,k,42,'italic SIZEpx Georgia',theme.ink);
      type(title,top+k+8,height-k-22,86,serif?'bold SIZEpx Georgia':'900 SIZEpx Arial',theme.ink);
    }
    function strip(y:number,h:number){
      if(images.length===1) return;
      if(images.length===2)picture(1,0,y,1000,h);
      else{picture(1,0,y,495,h);picture(2,505,y,495,h);}
    }
    rect(0,0,1000,1500,'#F7F2E8');
    if(style==='retro'){
      picture(0,0,0,1000,images.length===1?1500:840);strip(970,530);
      ctx.save();ctx.translate(500,866);ctx.rotate(-.035);rect(-560,-125,1120,250,theme.color);ctx.restore();
      type(title.toLocaleUpperCase(),750,223,83,'900 SIZEpx Arial','#FFF9ED',true);
      type(hook,28,145,60,'bold SIZEpx Georgia','#FFFFFF',true);
    }else if(style==='stack'){
      picture(0,0,0,1000,images.length===1?1500:650);strip(900,600);band(627,286,true);
    }else if(style==='pair'){
      band(0,333,true);picture(0,0,345,images.length===1?1000:495,1155);
      if(images.length>1){picture(1,506,345,494,images.length===3?572:1155);if(images[2])picture(2,506,928,494,572);}
    }else if(style==='detail'){
      picture(0,0,0,1000,1210);
      for(let i=1;i<images.length;i++){const x=1000-i*315;rect(x-9,815,300,320,'#FFF9F0');picture(i,x,824,282,302);}
      band(1188,312,true);
    }else{
      picture(0,0,0,1000,1500);strip(0,410);band(images.length===1?1090:419,280);
    }
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG export failed.')),'image/png'));
  } finally { images.forEach(i=>i.close()); }
}
