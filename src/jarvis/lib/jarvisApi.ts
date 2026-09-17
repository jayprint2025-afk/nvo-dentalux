const BASE=(import.meta.env.VITE_JARVIS_API_URL||'').replace(/\/$/,'');
export async function jarvisApi<T=any>(path:string,options:RequestInit={}):Promise<T>{
 if(!BASE) throw new Error('VITE_JARVIS_API_URL no configurado');
 const p=path.startsWith('/')?path:`/${path}`;
 const r=await fetch(`${BASE}${p}`,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
 if(!r.ok) throw new Error(`Jarvis API ${r.status}: ${await r.text()}`);
 return (r.status===204?null:await r.json()) as T;
}
