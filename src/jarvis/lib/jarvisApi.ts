const BASE=String(import.meta.env.VITE_API_BASE||'https://nvo-dentalux.onrender.com').replace(/\/$/,'');
const TOKEN_KEY='dentalux_auth_token';
export const jarvisBase=BASE;
export function jarvisToken(){return localStorage.getItem(TOKEN_KEY)||'';}
export async function jarvisApi<T=any>(path:string,options:RequestInit={}):Promise<T>{
 const p=path.startsWith('/')?path:`/${path}`;
 const token=jarvisToken();
 const headers:any={...(options.headers||{})};
 if(token) headers.Authorization=`Bearer ${token}`;
 if(options.body && !(options.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type']='application/json';
 const r=await fetch(`${BASE}${p}`,{...options,headers,credentials:'omit'});
 if(r.status===401){window.dispatchEvent(new Event('dentalux:auth-expired'));throw new Error('Sesión expirada');}
 if(!r.ok) throw new Error(`Jarvis API ${r.status}: ${await r.text()}`);
 return (r.status===204?null:await r.json()) as T;
}
