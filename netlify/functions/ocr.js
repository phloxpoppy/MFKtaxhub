'use strict';
const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp']);
const MAX_BASE64_LENGTH=8_000_000;
const DEFAULT_MODEL='gemini-2.5-flash';

exports.handler=async event=>{
  if(event.httpMethod==='OPTIONS')return response(204,null,{'Access-Control-Allow-Methods':'POST, OPTIONS'});
  if(event.httpMethod!=='POST')return response(405,{error:'Kaedah tidak dibenarkan. Gunakan POST.'});
  const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
  if(!apiKey)return response(503,{error:'Gemini belum dikonfigurasi.',code:'MISSING_API_KEY'});
  try{
    const payload=parseRequest(event.body);
    const model=sanitiseModel(process.env.GEMINI_MODEL||DEFAULT_MODEL);
    const apiUrl=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const upstream=await fetch(apiUrl,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify(buildGeminiRequest(payload)),signal:AbortSignal.timeout(30_000)});
    const raw=await upstream.text();const data=safeJson(raw);
    if(!upstream.ok){const msg=data?.error?.message||`HTTP ${upstream.status}`;console.error('Gemini upstream error',{status:upstream.status,model,message:msg.slice(0,500)});return mapGeminiError(upstream.status,msg);}
    const candidate=data?.candidates?.[0],finishReason=candidate?.finishReason||'';
    const text=candidate?.content?.parts?.map(p=>p.text||'').join('').trim();
    if(!text)return response(422,{error:finishReason==='SAFETY'?'Imej ditolak oleh penapis keselamatan Gemini.':'Gemini tidak menemui maklumat yang boleh dibaca.',code:'EMPTY_RESULT'});
    const extracted=normaliseResult(safeJson(stripCodeFence(text)));
    if(!extracted){console.error('Gemini invalid JSON',{model,sample:text.slice(0,300)});return response(422,{error:'Gambar dibaca tetapi format jawapan AI tidak lengkap. Cuba sekali lagi.',code:'INVALID_RESULT'});}
    return response(200,{...extracted,model});
  }catch(error){
    if(error?.name==='TimeoutError'||error?.name==='AbortError')return response(504,{error:'Gemini mengambil masa terlalu lama. Cuba sekali lagi.',code:'TIMEOUT'});
    console.error('OCR function error',{message:error?.message,name:error?.name});
    return response(error?.statusCode||500,{error:error?.publicMessage||'OCR gagal diproses. Semak Function logs.',code:error?.code||'OCR_ERROR'});
  }
};

function parseRequest(body){
  let data;try{data=JSON.parse(body||'{}');}catch{throw clientError('Format permintaan tidak sah.','INVALID_JSON');}
  const image=String(data.image||'').replace(/^data:image\/[^;]+;base64,/,'');
  const mimeType=String(data.mimeType||'').toLowerCase();
  if(!image)throw clientError('Gambar resit tidak diterima.','MISSING_IMAGE');
  if(!ALLOWED_TYPES.has(mimeType))throw clientError('Format gambar tidak disokong. Gunakan JPEG, PNG atau WebP.','INVALID_IMAGE_TYPE');
  if(image.length>MAX_BASE64_LENGTH)throw clientError('Gambar terlalu besar. Gunakan resolusi lebih rendah.','IMAGE_TOO_LARGE');
  if(!/^[A-Za-z0-9+/=\r\n]+$/.test(image))throw clientError('Data gambar tidak sah.','INVALID_IMAGE_DATA');
  return{image,mimeType,profileType:data.profileType==='business'?'business':'personal'};
}

function buildGeminiRequest({image,mimeType,profileType}){
  const categories=profileType==='business'?'Biz-Supplies, Biz-Utilities, Biz-Machines, Biz-Rental, Biz-Travel, Biz-Marketing, Biz-Others':'Lifestyle, Medical, Education, Tech, Insurance, Childcare, Sports, Others';
  const today=new Date().toISOString().slice(0,10);
  const prompt=`Anda ialah OCR dokumen kewangan Malaysia. Baca resit, invois, bukti pembayaran atau tangkap layar transaksi ini. Ekstrak store (nama vendor/penerima), date (YYYY-MM-DD; jika tiada gunakan ${today}), amount (nombor RM), items (ringkasan Bahasa Melayu), category (tepat satu daripada: ${categories}), confidence (0 hingga 1), uncertainFields (array medan yang kabur). Untuk pindahan bank gunakan nama penerima sebagai store. Jangan reka maklumat. Balas JSON sahaja.`;
  return{contents:[{role:'user',parts:[{text:prompt},{inlineData:{mimeType,data:image}}]}],generationConfig:{responseMimeType:'application/json',temperature:0.1,maxOutputTokens:1024}};
}

function normaliseResult(v){
  if(!v||typeof v!=='object')return null;
  const amount=Number(String(v.amount??'').replace(/[^0-9.-]/g,''));const store=String(v.store||'').trim();
  if(!store&&!Number.isFinite(amount))return null;
  return{store:store||'Vendor tidak dikenal pasti',date:/^\d{4}-\d{2}-\d{2}$/.test(v.date||'')?v.date:new Date().toISOString().slice(0,10),amount:Number.isFinite(amount)&&amount>=0?amount:0,items:String(v.items||'Transaksi / pembelian').trim(),category:String(v.category||'Others').trim(),confidence:Math.max(0,Math.min(1,Number(v.confidence)||0.5)),uncertainFields:Array.isArray(v.uncertainFields)?v.uncertainFields.filter(x=>['store','date','amount','items','category'].includes(x)):[]};
}

function mapGeminiError(status,detail){
  if(status===400)return response(400,{error:`Permintaan Gemini ditolak: ${cleanDetail(detail)}`,code:'GEMINI_BAD_REQUEST'});
  if(status===401||status===403)return response(502,{error:'Gemini menolak API key. Cipta authorization key baharu dan deploy semula.',code:'GEMINI_AUTH'});
  if(status===404)return response(502,{error:'Model Gemini tidak tersedia. Semak GEMINI_MODEL.',code:'GEMINI_MODEL'});
  if(status===429)return response(429,{error:'Kuota Gemini telah dicapai. Tunggu sebentar atau semak pelan API.',code:'GEMINI_QUOTA'});
  return response(502,{error:`Perkhidmatan Gemini gagal (${status}). Cuba semula.`,code:'GEMINI_UPSTREAM'});
}
function cleanDetail(v){return String(v||'').replace(/AIza[A-Za-z0-9_-]+|AQ\.[A-Za-z0-9_-]+/g,'[KEY]').slice(0,180);}
function sanitiseModel(v){v=String(v).trim();return/^[a-zA-Z0-9._-]+$/.test(v)?v:DEFAULT_MODEL;}
function safeJson(v){try{return JSON.parse(v);}catch{return null;}}
function stripCodeFence(v){return v.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();}
function clientError(publicMessage,code){const e=new Error(publicMessage);e.statusCode=400;e.publicMessage=publicMessage;e.code=code;return e;}
function response(statusCode,body,extra={}){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra},body:body===null?'':JSON.stringify(body)};}
exports._test={parseRequest,buildGeminiRequest,normaliseResult,mapGeminiError,sanitiseModel};
