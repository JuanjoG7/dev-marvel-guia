import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE = getStore({ name: "marvel-marathon-media-v113-tmdb", consistency: "eventual" });
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30;
const FETCH_TIMEOUT = 9000;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_SCHEMA = 'v1';
const headers = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Vary": "Origin"
};
const json = (body, status=200, extra={}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
const text = v => String(v ?? "").trim();
const norm = v => text(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const firstYear = v => { const m=text(v).match(/\b(\d{4})\b/); return m ? Number(m[1]) : null; };
const keySafe = v => norm(v).replace(/[^a-z0-9]+/g, "-").slice(0,120);
const timeoutSignal = ms => { const c = new AbortController(); const t=setTimeout(()=>c.abort(),ms); return [c.signal,()=>clearTimeout(t)]; };

async function requestJson(url, opts={}) {
  const [signal, clear] = timeoutSignal(FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, signal, headers: { accept: "application/json", ...(opts.headers||{}) } });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clear(); }
}

function tmdbHeaders(token) { return { Authorization: `Bearer ${token}`, accept: "application/json" }; }

function scoreCandidate(c, title, year) {
  const titleKeys=[c?.title,c?.name,c?.original_title,c?.original_name].filter(Boolean).map(norm);
  const wanted=norm(title);
  let score=0;
  if(titleKeys.includes(wanted)) score+=100;
  else {
    for(const k of titleKeys){
      if(k===wanted) score+=95;
      else if(k.includes(wanted)||wanted.includes(k)) score+=60;
      const a=new Set(k.split(' ')), b=new Set(wanted.split(' '));
      const inter=[...a].filter(x=>b.has(x)).length;
      score+=inter*4;
    }
  }
  const y=Number(String(c?.release_date||c?.first_air_date||'').slice(0,4))||null;
  if(year && y){ const d=Math.abs(y-year); score += d===0 ? 25 : d===1 ? 8 : -Math.min(20,d*3); }
  score += Math.min(10, Number(c?.popularity)||0);
  return score;
}

async function tmdbSearch(token, type, title, year) {
  const endpoint = type==='movie' ? 'movie' : 'tv';
  const p=new URLSearchParams({ query:title, language:'es-ES', include_adult:'false', page:'1' });
  if(year) p.set(type==='movie'?'year':'first_air_date_year', String(year));
  const data=await requestJson(`https://api.themoviedb.org/3/search/${endpoint}?${p}`, {headers:tmdbHeaders(token)});
  const results=Array.isArray(data?.results)?data.results:[];
  return results.sort((a,b)=>scoreCandidate(b,title,year)-scoreCandidate(a,title,year))[0]||null;
}

async function tmdbDetails(token, type, id) {
  const endpoint=type==='movie'?`movie/${id}`:`tv/${id}`;
  const append=type==='movie'
    ? 'credits,images,external_ids,videos'
    : 'aggregate_credits,images,external_ids,videos';
  const p=new URLSearchParams({ language:'es-ES', append_to_response:append, include_image_language:'es,en,null', include_video_language:'es,en,null' });
  return requestJson(`https://api.themoviedb.org/3/${endpoint}?${p}`, {headers:tmdbHeaders(token)});
}

async function tmdbSeason(token, id, number) {
  const p=new URLSearchParams({ language:'es-ES', append_to_response:'images,credits,external_ids,videos', include_image_language:'es,en,null', include_video_language:'es,en,null' });
  return requestJson(`https://api.themoviedb.org/3/tv/${id}/season/${number}?${p}`, {headers:tmdbHeaders(token)});
}

function tmdbImage(path,size='w500'){ return path ? `https://image.tmdb.org/t/p/${size}${path}` : ''; }
function normalizeVideos(tmdb, scope='title', seasonNumber=null){
  const src=Array.isArray(tmdb?.videos?.results)?tmdb.videos.results:[];
  const reject=/\b(ai|fan[ -]?made|fan[ -]?edit|concept|fake|reaction|breakdown|explained|compilation|edit|parody|spoof|deepfake|recreated|recreation)\b/i;
  const yt=src.filter(v=>text(v?.site).toLowerCase()==='youtube' && text(v?.key) && !!v?.official && /^(trailer|teaser)$/i.test(text(v?.type)) && !reject.test(text(v?.name)));
  const kindRank=v=>{ const t=text(v?.type).toLowerCase(); return t==='trailer'?40:30; };
  const langRank=v=>{ const l=text(v?.iso_639_1).toLowerCase(); return l==='es'?300:l==='en'?200:100; };
  const seen=new Set();
  return yt.map(v=>({
    key:text(v.key), name:text(v.name)||'Vídeo oficial', type:(text(v.type)||'Video').replace(/^./,c=>c.toUpperCase()),
    official:true, language:text(v.iso_639_1).toLowerCase(), publishedAt:text(v.published_at), site:'YouTube',
    scope, seasonNumber:seasonNumber==null?null:Number(seasonNumber),
    subtitlesPreferred:text(v?.iso_639_1).toLowerCase()==='en',
    score:langRank(v)+kindRank(v)
  })).filter(v=>{ const k=`${v.scope}|${v.seasonNumber||''}|${v.key}`; if(seen.has(k))return false; seen.add(k); return true; })
    .sort((a,b)=>Number(b.score||0)-Number(a.score||0) || String(b.publishedAt||'').localeCompare(String(a.publishedAt||'')));
}
function selectTrailer(videos){
  const list=Array.isArray(videos)?videos:[];
  const eligible=list.filter(v=>v?.key && /^(Trailer|Teaser)$/i.test(String(v?.type||'')) && v?.official===true);
  if(!eligible.length)return null;
  return [...eligible].sort((a,b)=>Number(b.score||0)-Number(a.score||0) || (a.type==='Trailer'? -1:1) || String(b.publishedAt||'').localeCompare(String(a.publishedAt||'')))[0]||null;
}

function selectBestPoster(tmdb,canonical=false){
  const primary=text(tmdb?.poster_path);
  if(canonical && primary) return primary;
  const list=Array.isArray(tmdb?.images?.posters)?tmdb.images.posters.filter(x=>text(x?.file_path)) : [];
  const candidates=list.length?list:[{file_path:primary,iso_639_1:null,aspect_ratio:0.667,width:0,vote_average:0}].filter(x=>x.file_path);
  if(primary && !candidates.some(x=>x.file_path===primary)) candidates.push({file_path:primary,iso_639_1:null,aspect_ratio:0.667,width:0,vote_average:0});
  const score=x=>{
    const lang=text(x?.iso_639_1).toLowerCase();
    let s=lang==='es'?120:lang==='en'?105:lang===''||lang==='null'?85:35;
    if(text(x?.file_path)===primary)s+=35;
    const ar=Number(x?.aspect_ratio)||0.667;
    s+=Math.max(0,20-Math.abs(ar-(2/3))*80);
    s+=Math.min(10,(Number(x?.width)||0)/300);
    s+=Math.min(5,Number(x?.vote_average)||0);
    return s;
  };
  candidates.sort((a,b)=>score(b)-score(a));
  return candidates[0]?.file_path||primary||'';
}
async function tmdbDetailsLite(token,type,id){
  const endpoint=type==='movie'?`movie/${id}`:`tv/${id}`;
  const p=new URLSearchParams({language:'es-ES',append_to_response:'images,external_ids',include_image_language:'es,en,null'});
  return requestJson(`https://api.themoviedb.org/3/${endpoint}?${p}`,{headers:tmdbHeaders(token)});
}


function normalizeCast(tmdb,type) {
  let src=[];
  if(type==='movie') src=Array.isArray(tmdb?.credits?.cast)?tmdb.credits.cast:[];
  else src=Array.isArray(tmdb?.aggregate_credits?.cast)?tmdb.aggregate_credits.cast:[];
  return src.slice(0,28).map((x,i)=>({
    personId:Number(x?.id)||null,
    name:text(x?.name)||'Actor no indicado',
    character:type==='movie'
      ? text(x?.character)
      : text(Array.isArray(x?.roles) ? x.roles.map(r=>text(r?.character)).filter(Boolean).slice(0,3).join(' / ') : ''),
    episodeCount:type==='movie'
      ? null
      : Number(Array.isArray(x?.roles) ? x.roles.reduce((n,r)=>n+(Number(r?.episode_count)||0),0) : 0)||null,
    profileUrl:tmdbImage(x?.profile_path,'w185'),
    order:Number.isFinite(Number(x?.order))?Number(x.order):i
  }));
}

function normalizeSeasons(tmdbSeasons) {
  const out=[];
  for(const s of (Array.isArray(tmdbSeasons)?tmdbSeasons:[])){
    const sn=Number(s?.season_number);
    if(sn===0 || !Number.isInteger(sn)) continue;
    const episodes=Array.isArray(s?.episodes)?s.episodes.map((e,i)=>({
      number:Number(e?.episode_number)||i+1,
      name:text(e?.name)||`Episodio ${i+1}`,
      airDate:text(e?.air_date),
      runtime:Number(e?.runtime)||null,
      overview:text(e?.overview),
      stillUrl:tmdbImage(e?.still_path,'w300'),
      ids:{tmdb:Number(e?.id)||null,imdb:text(e?.external_ids?.imdb_id||e?.external_ids?.imdb)}
    })) : [];
    out.push({
      number:sn,
      name:text(s?.name)||`Temporada ${sn}`,
      airDate:text(s?.air_date),
      posterUrl:tmdbImage(s?.poster_path,'w342'),
      overview:text(s?.overview),
      episodeCount:Number(s?.episode_count)||episodes.length,
      episodes,
      videos:normalizeVideos(s,'season',sn)
    });
  }
  return out.sort((a,b)=>a.number-b.number);
}


const VERIFIED_OFFICIAL_VIDEO_OVERRIDES={
  1003596:[
    {key:'kZ2Nhqkx3-I',name:'Vengadores: Doomsday | Tráiler Oficial | 18 de diciembre solo en cines',type:'Trailer',language:'es',official:true,publishedAt:'2026-07-20',site:'YouTube',scope:'title',score:340,verifiedSource:'Marvel España'},
    {key:'gcjnEYJ4OB8',name:'Vengadores: Doomsday | Nuevo Tráiler Oficial | 18 de diciembre solo en cines',type:'Trailer',language:'es',official:true,publishedAt:'2026-08-15',site:'YouTube',scope:'title',score:340,verifiedSource:'Marvel España'}
  ]
};
const VERIFIED_RELATED_OFFICIAL_VIDEOS={
  1003596:[
    {key:'Ib847Q7C9AU',name:'Vengadores Endgame: Encore | Tráiler Oficial V.O.S.E. | 25 de septiembre solo en cines',type:'Trailer',language:'es',official:true,publishedAt:'2026-08-26',site:'YouTube',scope:'related',relatedLabel:'Avengers: Endgame Encore',subtitlesPreferred:false,score:335,verifiedSource:'Marvel España'},
    {key:'L2NAh3CIdig',name:'Avengers Endgame: Encore | Official Trailer | In Theaters Sep 25',type:'Trailer',language:'en',official:true,publishedAt:'2026-08-25',site:'YouTube',scope:'related',relatedLabel:'Avengers: Endgame Encore',subtitlesPreferred:true,score:235,verifiedSource:'Marvel Entertainment'}
  ]
};
function mergeOfficialVideos(videos, overrides=[], scopeFallback='title'){
  const out=[...(Array.isArray(videos)?videos:[])];
  for(const v of (Array.isArray(overrides)?overrides:[])){
    if(!out.some(x=>String(x?.key||'')===String(v?.key||'')))out.push({...v,scope:v.scope||scopeFallback,official:true});
  }
  return out.sort((a,b)=>Number(b.score||0)-Number(a.score||0) || String(b.publishedAt||'').localeCompare(String(a.publishedAt||'')));
}

function combine({local,title,year,type,tmdb,tmdbSeasons,canonical=false}) {
  const ids={
    tmdb:Number(tmdb?.id)||null,
    imdb:text(tmdb?.external_ids?.imdb_id),
    tvdb:Number(tmdb?.external_ids?.tvdb_id)||null,
    wikidata:text(tmdb?.external_ids?.wikidata_id)
  };
  const cast=normalizeCast(tmdb,type);
  const seasons=type==='show'?normalizeSeasons(tmdbSeasons):[];
  const remoteYear=String(type==='movie'?tmdb?.release_date:tmdb?.first_air_date||'').slice(0,4)||String(year||'');
  const runtime=type==='movie'
    ? Number(tmdb?.runtime)||0
    : Number(tmdb?.episode_run_time?.[0]||0);
  return {
    version:'1.19.6', fetchedAt:Date.now(), ids,
    title:text(type==='movie'?tmdb?.title:tmdb?.name)||title,
    originalTitle:text(type==='movie'?tmdb?.original_title:tmdb?.original_name),
    year:remoteYear,
    runtime,
    overview:text(tmdb?.overview)||text(local?.desc),
    tagline:text(tmdb?.tagline),
    type,
    genres:Array.isArray(tmdb?.genres)?tmdb.genres.map(g=>text(g?.name)).filter(Boolean):[],
    status:text(tmdb?.status),
    posterUrl:tmdbImage(selectBestPoster(tmdb,canonical),'w500'),
    backdropUrl:tmdbImage(tmdb?.backdrop_path,'w1280'),
    cast,
    seasons,
    tmdb:{
      rating:Number(tmdb?.vote_average)||null,
      votes:Number(tmdb?.vote_count)||null,
      popularity:Number(tmdb?.popularity)||null,
      homepage:text(tmdb?.homepage),
      originalLanguage:text(tmdb?.original_language)
    },
    countries:Array.isArray(tmdb?.production_countries)?tmdb.production_countries.map(x=>text(x?.name)).filter(Boolean):[],
    spokenLanguages:Array.isArray(tmdb?.spoken_languages)?tmdb.spoken_languages.map(x=>text(x?.name)).filter(Boolean):[],
    networks:Array.isArray(tmdb?.networks)?tmdb.networks.map(x=>({id:Number(x?.id)||null,name:text(x?.name),logoUrl:tmdbImage(x?.logo_path,'w154')})).filter(x=>x.name):[],
    productionCompanies:Array.isArray(tmdb?.production_companies)?tmdb.production_companies.map(x=>({id:Number(x?.id)||null,name:text(x?.name),logoUrl:tmdbImage(x?.logo_path,'w154'),country:text(x?.origin_country)})).filter(x=>x.name):[],
    videos:mergeOfficialVideos(normalizeVideos(tmdb,'title'),VERIFIED_OFFICIAL_VIDEO_OVERRIDES[Number(tmdb?.id)]||[],'title'),
    trailer:selectTrailer(mergeOfficialVideos(normalizeVideos(tmdb,'title'),VERIFIED_OFFICIAL_VIDEO_OVERRIDES[Number(tmdb?.id)]||[],'title')),
    relatedVideos:mergeOfficialVideos([],VERIFIED_RELATED_OFFICIAL_VIDEOS[Number(tmdb?.id)]||[],'related'),
    sourcePriority:'TMDB · vídeos oficiales YouTube'
  };
}

export default async function handler(req) {
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Accept'}});
  if(req.method!=='GET') return json({error:'Method not allowed'},405);
  const url=new URL(req.url);
  const action=text(url.searchParams.get('action')||'enrich');
  const tmdbToken=text(process.env.TMDB_API_READ_ACCESS_TOKEN);
  if(action==='status') return json({ok:true,configured:{tmdb:!!tmdbToken},cache:'Netlify Blobs · metadatos 30 días + imágenes persistentes',imageProxy:true,version:'1.19.6'});

  // Same-origin image proxy. V1.15.3 persists TMDB image bytes in Netlify Blobs so
  // devices no longer depend on a cold browser cache or direct TMDB fetches.
  if(action==='image') {
    const raw=text(url.searchParams.get('u'));
    try {
      const iu=new URL(raw);
      if(iu.protocol!=='https:' || iu.hostname!=='image.tmdb.org' || !iu.pathname.startsWith('/t/')) return json({ok:false,error:'Invalid image URL'},400);
      const blobKey=`image:${createHash('sha256').update(raw).digest('hex')}`;
      try {
        const cached=await STORE.getWithMetadata(blobKey,{consistency:'strong',type:'arrayBuffer'});
        const cachedData=cached?.data;
        const cachedType=text(cached?.metadata?.contentType)||'image/jpeg';
        if(cachedData instanceof ArrayBuffer && cachedData.byteLength>0 && cached?.metadata?.schema===IMAGE_SCHEMA){
          return new Response(cachedData,{status:200,headers:{'Content-Type':cachedType,'Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*','Timing-Allow-Origin':'*','X-Marvel-Media-Cache':'netlify-blob'}});
        }
      }catch{}
      const [signal,clear]=timeoutSignal(12000);
      try {
        const res=await fetch(iu,{signal,headers:{accept:'image/avif,image/webp,image/jpeg,image/png,image/*'}});
        if(!res.ok) return json({ok:false,error:`Image HTTP ${res.status}`},502);
        const ct=text(res.headers.get('content-type'))||'image/jpeg';
        const length=Number(res.headers.get('content-length'))||0;
        if(length>0 && length>IMAGE_MAX_BYTES){
          return new Response(res.body,{status:200,headers:{'Content-Type':ct,'Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*','Timing-Allow-Origin':'*'}});
        }
        const buffer=await res.arrayBuffer();
        if(buffer.byteLength>0 && buffer.byteLength<=IMAGE_MAX_BYTES){
          try{await STORE.set(blobKey,buffer,{onlyIfNew:true,metadata:{schema:IMAGE_SCHEMA,contentType:ct,sourceUrl:raw,storedAt:new Date().toISOString()}})}catch{}
        }
        return new Response(buffer,{status:200,headers:{'Content-Type':ct,'Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*','Timing-Allow-Origin':'*','X-Marvel-Media-Cache':'netlify-blob-populated'}});
      } finally { clear(); }
    } catch(e){ return json({ok:false,error:text(e?.message)||'Image unavailable'},502); }
  }

  const title=text(url.searchParams.get('title'));
  const typeParam=text(url.searchParams.get('type')).toLowerCase();
  const type=typeParam==='movie'||typeParam==='show'?typeParam:(/serie|series|animated|tv/i.test(typeParam)?'show':'movie');
  const year=firstYear(url.searchParams.get('year'));
  const tmdbIdRaw=String(url.searchParams.get('tmdbId')||'').trim();
  const tmdbId=tmdbIdRaw&&/^\d+$/.test(tmdbIdRaw)?Number(tmdbIdRaw):null;
  const collectionName=text(url.searchParams.get('collection'));
  const canonical=url.searchParams.get('canonical')==='1';
  const force=url.searchParams.get('refresh')==='1';
  if(!title && !tmdbId) return json({error:'Missing title or tmdbId'},400);
  if(!tmdbToken) return json({ok:false,cached:false,configured:{tmdb:false},source:{tmdb:{configured:false,ok:false}},errors:{tmdb:'TMDB no configurado'},fallback:true},200);

  if(action==='poster') {
    const pbase=collectionName?`collection:${keySafe(collectionName)}`:(tmdbId?String(tmdbId):keySafe(`${type}|${title}|${year||''}`));
    const pkey=`poster:tmdb:${pbase}${canonical?':canonical':''}`;
    if(!force){
      try{ const hit=await STORE.get(pkey,{type:'json'}); if(hit?.fetchedAt && Date.now()-Number(hit.fetchedAt)<CACHE_TTL) return json({ok:true,cached:true,configured:{tmdb:true},tmdbId:hit.tmdbId||tmdbId||null,posterUrl:hit.posterUrl||'',backdropUrl:hit.backdropUrl||''}); }catch{}
    }
    try {
      if(collectionName){
        const cp=new URLSearchParams({query:collectionName,language:'es-ES',page:'1'});
        const cdata=await requestJson(`https://api.themoviedb.org/3/search/collection?${cp}`,{headers:tmdbHeaders(tmdbToken)});
        const cres=Array.isArray(cdata?.results)?cdata.results:[];
        const coll=cres.find(x=>norm(x?.name)===norm(collectionName))||cres[0]||null;
        const posterPath=text(coll?.poster_path),backPath=text(coll?.backdrop_path);
        const payload={fetchedAt:Date.now(),tmdbId:null,posterUrl:tmdbImage(posterPath,'w500'),backdropUrl:tmdbImage(backPath,'w1280')};
        try{await STORE.setJSON(pkey,payload)}catch{}
        return json({ok:true,cached:false,configured:{tmdb:true},tmdbId:null,posterUrl:payload.posterUrl,backdropUrl:payload.backdropUrl,fallback:!payload.posterUrl});
      }
      const hit=tmdbId?await tmdbDetailsLite(tmdbToken,type,tmdbId):await tmdbSearch(tmdbToken,type,title,year);
      const actualId=Number(hit?.id)||null;
      const details=tmdbId?hit:(actualId?await tmdbDetailsLite(tmdbToken,type,actualId):null);
      if(!details) return json({ok:false,cached:false,configured:{tmdb:true},tmdbId:actualId,posterUrl:'',fallback:true});
      const posterUrl=tmdbImage(selectBestPoster(details,canonical),'w500');
      const backdropUrl=tmdbImage(text(details?.backdrop_path),'w1280');
      const payload={fetchedAt:Date.now(),tmdbId:Number(details?.id)||actualId,posterUrl,backdropUrl};
      try{await STORE.setJSON(pkey,payload)}catch{}
      return json({ok:true,cached:false,configured:{tmdb:true},tmdbId:payload.tmdbId,posterUrl,backdropUrl});
    } catch(e) { return json({ok:false,cached:false,configured:{tmdb:true},errors:{tmdb:text(e?.message)||'TMDB unavailable'},fallback:true}); }
  }
  const cacheKey=`media:tmdb:v3:${keySafe(`${type}|${tmdbId||''}|${title}|${year||''}${canonical?'|canonical':''}`)}`;
  if(!force){
    try{
      const hit=await STORE.get(cacheKey,{type:'json'});
      if(hit?.fetchedAt && Date.now()-Number(hit.fetchedAt)<CACHE_TTL) return json({ok:true,cached:true,configured:{tmdb:true},data:hit.data,source:hit.source||{tmdb:{configured:true,ok:true}}});
    }catch{}
  }

  const source={tmdb:{configured:true,ok:false}};
  let tmdb=null,tmdbError='';
  try {
    const hit=tmdbId?{id:tmdbId}:await tmdbSearch(tmdbToken,type,title,year);
    if(hit){ tmdb=await tmdbDetails(tmdbToken,type,hit.id); source.tmdb.ok=!!tmdb; }
    else tmdbError='No se encontró una coincidencia suficiente en TMDB';
  } catch(e) { tmdbError=text(e?.message)||'TMDB unavailable'; }

  if(!tmdb) return json({ok:false,cached:false,configured:{tmdb:true},source,errors:{tmdb:tmdbError},fallback:true},200);

  let tmdbSeasons=[];
  if(type==='show' && Array.isArray(tmdb?.seasons)){
    const nums=tmdb.seasons.map(s=>Number(s?.season_number)).filter(n=>Number.isInteger(n)&&n>0);
    const chunks=[];
    for(let i=0;i<nums.length;i+=4){
      const batch=await Promise.all(nums.slice(i,i+4).map(n=>tmdbSeason(tmdbToken,tmdb.id,n).catch(()=>null)));
      chunks.push(...batch.filter(Boolean));
    }
    tmdbSeasons=chunks;
  }

  const local={title,year,desc:''};
  const data=combine({local,title,year,type,tmdb,tmdbSeasons,canonical});
  const payload={data,source,fetchedAt:Date.now()};
  try { await STORE.setJSON(cacheKey,payload); } catch {}
  return json({ok:true,cached:false,configured:{tmdb:true},data,source,errors:{tmdb:tmdbError}});
}
