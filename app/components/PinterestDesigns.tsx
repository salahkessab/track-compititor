'use client';
import { useEffect, useRef, useState } from 'react';
import { composePin, pinTemplates, type PinArticle, type PinStyle } from '@/lib/pinterestDesign';
import { analysisThumbnail, prepareLocalPhoto } from '@/lib/recipeDesignPhoto';
import { prepareClientImage } from '@/lib/preparedImageClient';
import { readGenerationResponse } from '@/lib/generationResponse';
import { OPENAI_IMAGE_MODEL_IDS, DEFAULT_OPENAI_IMAGE_MODEL } from '@/lib/openaiImageSettings';
import { estimateOpenAIImageOutput } from '@/lib/imagePricing';
import styles from './PinterestDesigns.module.css';
import { MetadataBadge } from './VerifiedImage';

const input='mt-1 block w-full rounded-xl border border-gray-300 bg-white p-2.5 text-sm';
const btn='rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-40';
type PinOutput={imageUrl:string;removed:boolean};
const empty:PinArticle={title:'',text:'',link:'',photos:[],first:0};
const blankCopy={headline:'',hook:'',title:'',description:'',alt:''};
type Copy=typeof blankCopy;
type SearchBrief={searchPhrase:string;evidence:string;evidenceKind?:'article'|'photo';hooks:string[]};
const fields:{key:keyof Copy;label:string;max:number}[]=[
  {key:'headline',label:'Headline on the image',max:100},{key:'hook',label:'Hook on the image',max:76},
  {key:'title',label:'Pin title',max:100},{key:'description',label:'Description',max:800},{key:'alt',label:'Alt text',max:500}];

export function PinterestDesigns(){
  const [source,setSource]=useState({article:empty,revision:0});
  function clear(){sessionStorage.removeItem('pin-article');setSource(old=>({article:empty,revision:old.revision+1}));}
  useEffect(()=>{
    function load(){try{const a=JSON.parse(sessionStorage.getItem('pin-article')||'null');if(a?.photos)setSource(old=>({article:a,revision:old.revision+1}));}catch{}}
    load();window.addEventListener('pin-article-changed',load);window.addEventListener('article-library-cleared',clear);
    return()=>{window.removeEventListener('pin-article-changed',load);window.removeEventListener('article-library-cleared',clear);};
  },[]);
  return <Editor key={source.revision} source={source.article} reset={clear}/>;
}
function Editor({source,reset}:{source:PinArticle;reset:()=>void}){
  const [photos,setPhotos]=useState(source.photos),[selected,select]=useState<number[]>(source.photos[source.first]?[source.first]:[]);
  const [title,setTitle]=useState(source.title),[text,setText]=useState(source.text),[link,setLink]=useState(source.link);
  const [loadingArticle,setLoadingArticle]=useState(!!source.textUrl);
  const [editedArticle,setEditedArticle]=useState(false);
  const linkedPhoto=selected.some(i=>source.photos.includes(photos[i]));
  const articleText=editedArticle||linkedPhoto?text.trim():'';
  const waitingForArticle=linkedPhoto&&loadingArticle;
  const [copy,setCopy]=useState<Copy>({...blankCopy,headline:source.title.slice(0,100),title:source.title.slice(0,100)});
  const [manualCopy,setManualCopy]=useState(false);
  const [writing,setWriting]=useState<{sourceKey:string;brief:SearchBrief}|null>(null);
  const detailsRef=useRef<HTMLDetailsElement>(null);
  const sourceKey=JSON.stringify([title,articleText,selected.map(i=>photos[i].url)]);
  const brief=writing?.sourceKey===sourceKey?writing.brief:null;
  const [dragging,setDragging]=useState(false);
  const [style,setStyle]=useState<PinStyle>('retro'),[ref,setRef]=useState<File|null>(null),[mode,setMode]=useState('fixed');
  const [model,setModel]=useState<string>(DEFAULT_OPENAI_IMAGE_MODEL),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const [out,setOut]=useState<PinOutput|null>(null);
  const fixedResults=useRef(new Map<string,PinOutput>());
  const owned=useRef<string[]>([]),lock=useRef(false);
  useEffect(()=>{const urls=owned.current;return()=>urls.forEach(URL.revokeObjectURL);},[]);
  useEffect(()=>{
    if(!source.textUrl)return;
    const ac=new AbortController();
    fetch(source.textUrl,{signal:ac.signal}).then(async r=>{if(!r.ok)throw Error('Open the saved article again or paste its text below.');const s=await r.text();if(!ac.signal.aborted)setText(s.slice(0,40000));})
      .catch(e=>{if(!ac.signal.aborted)setError(e.message);})
      .finally(()=>{if(!ac.signal.aborted)setLoadingArticle(false);});
    return()=>ac.abort();
  },[source.textUrl]);
  function change(fn:()=>void){setOut(null);setError('');fn();}
  async function run(label:string,fn:()=>Promise<void>,keepPreview=false){
    if(lock.current)return;lock.current=true;setBusy(label);setError('');if(!keepPreview)setOut(null);
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
    const {copy:draft,searchBrief}=await request({action:'copy',articleTitle:title,article:articleText,photos:await Promise.all(blobs.map(thumb))});
    setWriting({sourceKey,brief:searchBrief});
    if(detailsRef.current)detailsRef.current.open=true;
    setCopy(draft);return draft as Copy;
  }
  function fixedKey(layout:PinStyle,headline:string,hook:string){
    return JSON.stringify([layout,selected.map(i=>photos[i].url),headline,hook]);
  }
  async function generate(layout:PinStyle=style){
    let refThumb:string|undefined;
    if(mode==='reference'){
      if(ref) refThumb=await thumb(ref);
      else {
        const example=await fetch('/pin-layouts/'+layout+'.webp');
        if(!example.ok)throw Error('Could not load the selected template. Select another layout or upload a reference.');
        refThumb=await thumb(await example.blob());
      }
    }
    const images=await bytes();
    const c=autoCopy?await write(images):{...copy,headline:headline};
    let result;
    if(mode==='fixed'){
      setBusy('Preparing image…');
      const previous=fixedResults.current.get(fixedKey(layout,c.headline,c.hook));
      if(previous){setOut(previous);return;}
      result=await prepareClientImage(await composePin(layout,images,c.headline,c.hook));
    }else{
      setBusy('Generating image…');
      result=await request({action:'reference',model,style:layout,headline:c.headline,hook:c.hook,reference:refThumb,photos:await Promise.all(images.map(thumb))});
    }
    if(result.metadata?.state!=='verified'||!result.imageUrl)throw Error('Verification did not complete. Retry preparation.');
    const output={imageUrl:result.imageUrl,removed:result.metadata.c2pa.action==='removed'};
    if(mode==='fixed')fixedResults.current.set(fixedKey(layout,c.headline,c.hook),output);
    setOut(output);
  }
  const canWrite=!!(title.trim()&&selected.length&&!waitingForArticle);
  const headline=copy.headline.trim()||title.trim().slice(0,100);
  const autoCopy=canWrite && !!articleText && !copy.hook.trim() && !manualCopy;
  const cost=estimateOpenAIImageOutput(model,'1024x1536','medium');
  const template=pinTemplates.find(t=>t.id===style)!;
  const canGenerate=!waitingForArticle && selected.length>0 && (headline||autoCopy);
  function chooseLayout(next:PinStyle){
    if(style===next||lock.current)return;
    setStyle(next);setError('');
    const cached=mode==='fixed' && fixedResults.current.get(fixedKey(next,headline,copy.hook));
    if(cached){setOut(cached);return;}
    if(out && mode==='fixed' && !autoCopy){void run('Preparing image…',()=>generate(next));return;}
    setOut(null);
  }
  function releasePhoto(url:string){
    const index=owned.current.indexOf(url);
    if(index>=0){owned.current.splice(index,1);URL.revokeObjectURL(url);}
  }
  function removePhoto(index:number){
    change(()=>{
      setPhotos(photos.filter((_,i)=>i!==index));
      select(selected.filter(i=>i!==index).map(i=>i>index?i-1:i));
      releasePhoto(photos[index].url);
    });
  }
  async function addPhotos(files:File[],replaceIndex?:number){
    if(!files.length)return;
    await run('Reading photos…',async()=>{
      const prepared=[];
      for(const file of files){
        prepared.push({blob:(await prepareLocalPhoto(file)).blob,label:file.name});
      }
      const incoming=prepared.map(({blob,label})=>{
        const url=URL.createObjectURL(blob);owned.current.push(url);return {url,label};
      });
      setOut(null);
      if(replaceIndex!==undefined){
        setPhotos(photos.map((p,i)=>i===replaceIndex?incoming[0]:p));
        releasePhoto(photos[replaceIndex].url);
        return;
      }
      setPhotos([...photos,...incoming]);
      select([...selected,...incoming.map((_,i)=>photos.length+i)].slice(0,3));
    },true);
  }
  function clearFields(){
    if(!window.confirm('Clear all text fields in this Pin and keep its photos?'))return;
    change(()=>{setTitle('');setText('');setEditedArticle(true);setLink('');setCopy({...blankCopy});setWriting(null);setManualCopy(false);});
  }
  function movePhoto(i:number,offset:number){
    const next=[...selected];
    [next[i],next[i+offset]]=[next[i+offset],next[i]];
    change(()=>select(next));
  }
  function copyField(f:typeof fields[number]){
    const artwork=f.key==='headline'||f.key==='hook';
    return <label className="pin-field" key={f.key}>{f.label}
      <textarea className={input} rows={f.key==='description'?3:1} maxLength={f.max}
        placeholder={f.key==='headline'?title.slice(0,100)||'Enter your headline':undefined}
        value={copy[f.key]} onChange={e=>{
          if(artwork){setOut(null);setManualCopy(true);}
          setCopy({...copy,[f.key]:e.target.value});
        }}/></label>;
  }
  return <section className={`studio-panel ${styles.root}`} aria-label="Pinterest Design">
    <header className="pin-editor-head"><div><h1>Pinterest Design</h1><p>Build a Pin from your article photos.</p></div>
      <button type="button" className="pin-clear" disabled={!!busy} onClick={()=>{if(window.confirm('Clear the entire Pin draft, including text, photos and design settings?'))reset();}}>Clear all</button>
    </header>
    <div className="pin-columns">
      <fieldset disabled={!!busy} className="pin-controls">
        <section className="pin-block" aria-labelledby="pin-writer-title"><div className="pin-block-title"><h2 id="pin-writer-title">Pinterest search writer</h2>
          <button className="pin-clear" type="button" disabled={loadingArticle||!(title||text||link||Object.values(copy).some(Boolean))} onClick={clearFields}>Clear fields</button></div>
          <button type="button" className="pin-writer-action" disabled={!canWrite} aria-describedby="pin-writer-help" onClick={()=>void run('Writing Pin copy…',async()=>{await write(await bytes());})}>Write title, description &amp; hooks · AI</button>
          <small id="pin-writer-help" className="pin-note">{waitingForArticle?'Loading the linked article…':canWrite?(articleText?'One paid writing request uses the article and your selected photos.':'One paid writing request uses your title and selected photos.'):<>Add a title and select <a href="#pin-article-photos" className="underline">at least one photo</a>.</>}</small>
          <label className="pin-field">Article title<input className={input} value={title} maxLength={500} onChange={e=>change(()=>setTitle(e.target.value))}/></label>
          <details className="pin-fold"><summary>Article text (optional)</summary><textarea className={input} rows={5} aria-label="Article text" disabled={loadingArticle} maxLength={40000} value={linkedPhoto||editedArticle?text:''} onChange={e=>change(()=>{setEditedArticle(true);setText(e.target.value);})}/></details>
          {writing&&!brief&&<p role="status" className="pin-note">The source changed. Review the existing copy or run the writer again.</p>}
          {brief&&<div className="space-y-2"><p><strong>Suggested search phrase</strong> · {brief.searchPhrase}</p>
            <details className="pin-fold"><summary>{brief.evidenceKind==='photo'?'Detail from the selected photos':'Supporting article passage'}</summary><p>{brief.evidence}</p></details>
            <fieldset><legend className="text-sm font-semibold">Choose your hook</legend><div className="mt-2 flex flex-wrap gap-2">
              {brief.hooks.map(h=><button key={h} type="button" className={btn} aria-pressed={copy.hook===h} onClick={()=>{
                if(copy.hook!==h)change(()=>{setCopy({...copy,hook:h});setManualCopy(true);});
              }}>{h}</button>)}</div></fieldset>
          </div>}
          <div className="pin-row">{fields.slice(0,2).map(copyField)}</div>
        </section>
        <details ref={detailsRef} className="pin-block pin-fold"><summary>Pin details &amp; article link</summary>
          {fields.slice(2).map(copyField)}
          <label className="pin-field">Published article link<input className={input} type="url" placeholder="https://…" value={link} onChange={e=>setLink(e.target.value)}/></label>
        </details>
        <section id="pin-article-photos" className="pin-block"><div className="pin-block-title"><h2>Article photos</h2><span>{selected.length} / 3 selected</span></div>
          <label className={'pin-drop'+(dragging?' is-dragging':'')}
            onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
            onDrop={e=>{e.preventDefault();setDragging(false);if(!busy)void addPhotos(Array.from(e.dataTransfer.files));}}>
            <span aria-hidden="true">＋</span><span><strong>Add or drop photos</strong><small>JPG, PNG or WebP</small></span>
            <input aria-label="Add article photos" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';void addPhotos(files);}}/>
          </label>
          {photos.length>0&&<div className="pin-source-photos">{photos.map((p,i)=>{
            const n=selected.indexOf(i);
            return <div key={p.url+'-'+i} className="pin-photo-card"><button type="button" aria-label={p.label} aria-pressed={n>=0} disabled={n<0&&selected.length>=3}
              onClick={()=>change(()=>select(n>=0?selected.filter(v=>v!==i):[...selected,i]))}><img src={p.url} alt=""/>{n>=0&&<b>{n+1}</b>}</button>
              <div className="pin-photo-actions"><label>Replace<input type="file" aria-label={'Replace '+p.label} accept="image/jpeg,image/png,image/webp" onChange={e=>{
                const file=e.target.files?.[0];e.target.value='';if(file)void addPhotos([file],i);
              }}/></label><button type="button" aria-label={'Remove '+p.label+' from Pin'} onClick={()=>removePhoto(i)}>Remove</button></div></div>;
          })}</div>}
          {selected.length>0&&<ol className="pin-order">{selected.map((idx,i)=><li key={idx}>
            <b>{i===0?'Hero photo':'Detail '+i}</b><span title={photos[idx].label}>{photos[idx].label}</span>
            {selected.length>1&&<><button type="button" aria-label={'Move '+photos[idx].label+' earlier'} disabled={!i} onClick={()=>movePhoto(i,-1)}>↑</button>
            <button type="button" aria-label={'Move '+photos[idx].label+' later'} disabled={i===selected.length-1} onClick={()=>movePhoto(i,1)}>↓</button></>}
          </li>)}</ol>}
        </section>
        <section className="pin-block"><h2>Choose a layout</h2>
          <div className="pin-gallery">{pinTemplates.map(t=>
            <button type="button" className="pin-template" key={t.id} aria-pressed={style===t.id} title={t.layout}
              onClick={()=>chooseLayout(t.id)}>
              <span className="pin-cover"><img src={'/pin-layouts/'+t.id+'.webp'} alt="" width="600" height="900"/>
              {style===t.id&&<span className="pin-check" aria-hidden="true">✓</span>}</span><span>{t.name}</span>
            </button>)}</div>
          <label className="pin-field">Design mode<select className={input} value={mode} onChange={e=>change(()=>setMode(e.target.value))}><option value="fixed">Fixed template · use exact photos</option><option value="reference">Generate from design reference</option></select></label>
          {mode==='reference'&&<div className="pin-row"><label className="pin-field">Custom design reference (optional)<input className={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>change(()=>setRef(e.target.files?.[0]||null))}/></label>
            <label className="pin-field">Image model<select className={input} value={model} onChange={e=>change(()=>setModel(e.target.value))}>{OPENAI_IMAGE_MODEL_IDS.map(m=><option key={m}>{m}</option>)}</select></label></div>}
        </section>
      </fieldset>
      <aside className="pin-proof">
        <div className="pin-block-title"><h2>{out?'Your Pin':'Template preview'}</h2><span>{out?'PNG':'2 : 3'}</span></div>
        <div className="pin-mat">{out?<div><MetadataBadge c2pa={out.removed}/><img className="pin-art" alt={copy.alt||headline} src={out.imageUrl}/></div>:
          busy&&/Generating|Preparing/.test(busy)?<div className="pin-progress" role="status">{busy}</div>:
          <img className="pin-art" src={'/pin-layouts/'+style+'.webp'} alt={template.name+' example with casserole photographs'}/>}</div>
        <div className="pin-proof-caption"><strong>{template.name}</strong><p>{out?(mode==='fixed'?'Verified PNG · Choose another layout to compare.':'Verified PNG'):template.layout+'. Sample photos shown.'}</p></div>
        {out?<a className="pin-action" href={out.imageUrl} download="pinterest-pin.png">Download PNG</a>:
          <button type="button" className="pin-action" disabled={!!busy||!canGenerate} onClick={()=>void run('Preparing Pin…',generate)}>{busy|| (mode==='reference'?'Generate reference design':'Create Pin design')}</button>}
        {!out&&<small className="pin-note">{!selected.length?'Choose at least one article photo. ':!headline&&!autoCopy?'Enter an article title or headline. ':''}
        {mode==='reference'&&('Design reference: '+(ref?.name||template.name)+'. ')}{autoCopy?'Includes one paid article-copy request. ':''}{mode==='fixed'?'Fixed layouts use no image credits.':cost!=null?'Image edit from $'+cost.toFixed(4)+' plus input.':'Image generation charges apply.'}</small>}
        {error&&<p role="alert" className="text-red-600">{error}</p>}
      </aside>
    </div>
  </section>;
}
