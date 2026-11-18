'use client';
import { useEffect, useRef, useState } from 'react';
import { composePin, pinTemplates, type PinArticle, type PinStyle } from '@/lib/pinterestDesign';
import { analysisThumbnail, prepareLocalPhoto } from '@/lib/recipeDesignPhoto';
import { prepareClientImage } from '@/lib/preparedImageClient';
import { readGenerationResponse } from '@/lib/generationResponse';
import { OPENAI_IMAGE_MODEL_IDS, DEFAULT_OPENAI_IMAGE_MODEL } from '@/lib/openaiImageSettings';
import { estimateOpenAIImageOutput } from '@/lib/imagePricing';
import { MetadataBadge } from './VerifiedImage';

const input='mt-1 block w-full rounded-xl border border-gray-300 bg-white p-2.5 text-sm';
const btn='rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-40';
const primary=btn+' bg-blue-600 text-white';
const empty:PinArticle={title:'',text:'',link:'',photos:[],first:0};
const blankCopy={headline:'',hook:'',title:'',description:'',alt:''};
type Copy=typeof blankCopy;
const fields:{key:keyof Copy;label:string;max:number}[]=[
  {key:'headline',label:'Headline on the image',max:100},{key:'hook',label:'Hook on the image',max:76},
  {key:'title',label:'Pin title',max:100},{key:'description',label:'Description',max:800},{key:'alt',label:'Alt text',max:500}];

export function PinterestDesigns(){
  const [source,setSource]=useState({article:empty,revision:0});
  useEffect(()=>{
    function load(){try{const a=JSON.parse(sessionStorage.getItem('pin-article')||'null');if(a?.photos)setSource(old=>({article:a,revision:old.revision+1}));}catch{}}
    function clear(){sessionStorage.removeItem('pin-article');setSource(old=>({article:empty,revision:old.revision+1}));}
    load();window.addEventListener('pin-article-changed',load);window.addEventListener('article-library-cleared',clear);
    return()=>{window.removeEventListener('pin-article-changed',load);window.removeEventListener('article-library-cleared',clear);};
  },[]);
  return <Editor key={source.revision} source={source.article}/>;
}
function Editor({source}:{source:PinArticle}){
  const [photos,setPhotos]=useState(source.photos),[selected,select]=useState<number[]>(source.photos[source.first]?[source.first]:[]);
  const [title,setTitle]=useState(source.title),[text,setText]=useState(source.text),[link,setLink]=useState(source.link);
  const [copy,setCopy]=useState<Copy>({...blankCopy,headline:source.title.slice(0,100),title:source.title.slice(0,100)});
  const [style,setStyle]=useState<PinStyle>('retro'),[ref,setRef]=useState<File|null>(null),[mode,setMode]=useState('fixed');
  const [model,setModel]=useState<string>(DEFAULT_OPENAI_IMAGE_MODEL),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const [out,setOut]=useState<{imageUrl:string;removed:boolean}|null>(null);
  const owned=useRef<string[]>([]),lock=useRef(false);
  useEffect(()=>{const urls=owned.current;return()=>urls.forEach(URL.revokeObjectURL);},[]);
  useEffect(()=>{
    if(!source.textUrl)return;
    const ac=new AbortController();
    fetch(source.textUrl,{signal:ac.signal}).then(async r=>{if(!r.ok)throw Error('Open the saved article again or paste its text below.');const s=await r.text();if(!ac.signal.aborted)setText(s.slice(0,40000));})
      .catch(e=>{if(!ac.signal.aborted)setError(e.message);});
    return()=>ac.abort();
  },[source.textUrl]);
  function change(fn:()=>void){setOut(null);setError('');fn();}
  async function run(label:string,fn:()=>Promise<void>){
    if(lock.current)return;lock.current=true;setBusy(label);setError('');setOut(null);
    try{await fn();}catch(e){setError(e instanceof Error?e.message:'Unable to finish the design.');}
    finally{lock.current=false;setBusy('');}
  }
  async function bytes(){return Promise.all(selected.map(async i=>{
    const r=await fetch(photos[i].url);if(!r.ok)throw Error('A selected article photo is unavailable.');
    return r.blob();
  }));}
  async function thumb(blob:Blob){return analysisThumbnail(await prepareLocalPhoto(new File([blob],'photo',{type:blob.type})));}
  async function request(data:Record<string,unknown>){
    const r=await fetch('/api/pinterest-design',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({...data,approved:true})});
    return readGenerationResponse(r,s=>{if(s==='Preparing image…')setBusy(s);});
  }
  async function write(blobs:Blob[]){
    const {copy:draft}=await request({action:'copy',articleTitle:title,article:text,photos:await Promise.all(blobs.map(thumb))});
    setCopy(draft);return draft as Copy;
  }
  async function generate(){
    const refThumb=mode==='reference'&&ref?await thumb(ref):'';
    const images=await bytes();
    const c=copy.hook.trim()?copy:await write(images);
    let result;
    if(mode==='fixed'){
      setBusy('Preparing image…');
      result=await prepareClientImage(await composePin(style,images,c.headline,c.hook));
    }else{
      if(!ref)throw Error('Choose a reference design.');
      setBusy('Generating image…');
      result=await request({action:'reference',model,style,headline:c.headline,hook:c.hook,reference:refThumb,photos:await Promise.all(images.map(thumb))});
    }
    if(result.metadata?.state!=='verified'||!result.imageUrl)throw Error('Verification did not complete. Retry preparation.');
    setOut({imageUrl:result.imageUrl,removed:result.metadata.c2pa.action==='removed'});
  }
  const canWrite=!!(text.trim()&&title.trim()&&selected.length);
  const cost=estimateOpenAIImageOutput(model,'1024x1536','medium');
  return <section className="studio-panel space-y-5 rounded-2xl p-5" aria-label="Pinterest Design">
    <header><h1 className="text-3xl font-serif">Pinterest Design</h1><p className="mt-1 text-sm text-gray-600">Send a photo from an article or add your own photos below.</p></header>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]"><fieldset disabled={!!busy} className="min-w-0 space-y-4">
      <label className="block">Article title<input className={input} value={title} maxLength={500} onChange={e=>change(()=>setTitle(e.target.value))}/></label>
      <details open={!source.title}><summary>Article text</summary><textarea className={input} rows={5} maxLength={40000} aria-label="Article text" value={text} onChange={e=>change(()=>setText(e.target.value))}/></details>
      <label className="block">Article photos <span className="text-sm text-gray-600">· choose up to three in display order</span>
        <input className={input} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(!files.length)return;void run('Reading photos…',async()=>{
          const incoming=[];for(const f of files){const p=await prepareLocalPhoto(f);const url=URL.createObjectURL(p.blob);owned.current.push(url);incoming.push({url,label:f.name});}
          setPhotos([...photos,...incoming]);select([...selected,...incoming.map((_,i)=>photos.length+i)].slice(0,3));
        });}}/></label>
      <div className="flex flex-wrap gap-2">{photos.map((p,i)=><button key={p.url} type="button" className={'relative overflow-hidden rounded-lg border-2 '+(selected.includes(i)?'border-blue-600':'border-gray-300')} aria-label={p.label} aria-pressed={selected.includes(i)} disabled={!selected.includes(i)&&selected.length>=3}
        onClick={()=>change(()=>select(selected.includes(i)?selected.filter(v=>v!==i):[...selected,i]))}><img src={p.url} alt={p.label} className="h-20 w-20 object-cover"/>{selected.includes(i)&&<span className="absolute bottom-0 right-0 rounded-tl bg-blue-700 px-2 text-white">{selected.indexOf(i)+1}</span>}</button>)}</div>
      <div><h2 className="font-semibold">Layout</h2><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{pinTemplates.map(t=><button key={t.id} type="button" aria-pressed={style===t.id} title={t.layout} className={'rounded-xl border-2 p-2 text-left text-sm '+(style===t.id?'border-blue-600':'border-gray-200')} onClick={()=>change(()=>setStyle(t.id))}><span aria-hidden="true" className={'pin-swatch pin-'+t.id} style={{backgroundColor:t.color}}><i/><i/><i/></span>{t.name}</button>)}</div></div>
      <label className="block">Design mode<select className={input} value={mode} onChange={e=>change(()=>setMode(e.target.value))}><option value="fixed">Fixed template · use exact photos</option><option value="reference">Generate from design reference</option></select></label>
      {mode==='reference'&&<><label className="block">Design reference<input className={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>change(()=>setRef(e.target.files?.[0]||null))}/></label><label className="block">Image model<select className={input} value={model} onChange={e=>change(()=>setModel(e.target.value))}>{OPENAI_IMAGE_MODEL_IDS.map(m=><option key={m}>{m}</option>)}</select></label></>}
      <button type="button" className={btn} disabled={!canWrite} onClick={()=>void run('Reviewing article…',async()=>{await write(await bytes());})}>Write hook and Pin copy · AI</button>
      {fields.map(f=><label key={f.key} className="block text-sm">{f.label}<textarea rows={f.key==='description'?3:1} className={input} maxLength={f.max} value={copy[f.key]} onChange={e=>change(()=>setCopy({...copy,[f.key]:e.target.value}))}/></label>)}
      <label className="block text-sm">Published article link<input className={input} type="url" placeholder="Add the public link once the article is published" value={link} onChange={e=>setLink(e.target.value)}/></label>
      <p className="text-sm text-gray-600">{copy.hook.trim()?'':'An empty hook starts one paid article-copy request. '}{mode==='fixed'?'Fixed templates use no image-generation credits.':'One paid image edit. '+(cost!=null?'Estimated image output $'+cost.toFixed(4)+' plus input.':'Input and output usage apply.')}</p>
      <button type="button" className={primary} disabled={!selected.length||(copy.hook.trim()?!copy.headline.trim():!canWrite)||(mode==='reference'&&!ref)} onClick={()=>void run('Preparing Pin…',generate)}>Create Pin design</button>
    </fieldset><aside className="min-w-0"><h2 className="mb-3 font-semibold">Pin preview</h2>{out?<><MetadataBadge c2pa={out.removed}/><img className="w-full rounded-xl" alt={copy.alt||copy.headline} src={out.imageUrl}/><a className={btn+' mt-3 inline-block'} href={out.imageUrl} download="pinterest-pin.png">Download PNG</a></>:<div className="grid aspect-[2/3] place-content-center rounded-xl border border-dashed p-6 text-center text-sm text-gray-600" role="status">{busy||'Your finished Pin appears here.'}</div>}{error&&<p role="alert" className="mt-3 text-red-600">{error}</p>}</aside></div>
  </section>;
}
