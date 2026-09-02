'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const STORAGE = { receipts:'mytax_v2_receipts', profiles:'mytax_v2_profiles', pending:'mytax_v2_pending', theme:'mytax_theme' };
const PERSONAL = {
  Lifestyle:{label:'Gaya hidup',limit:2500}, Medical:{label:'Perubatan',limit:10000}, Education:{label:'Pendidikan sendiri',limit:7000},
  Tech:{label:'Peranti & teknologi',limit:2500}, Insurance:{label:'Insurans / takaful',limit:3000}, Childcare:{label:'Penjagaan anak',limit:3000},
  Sports:{label:'Aktiviti sukan',limit:1000}, Others:{label:'Lain-lain / bukan tuntutan',limit:1}
};
const BUSINESS = {
  'Biz-Supplies':{label:'Bekalan operasi',limit:25000}, 'Biz-Utilities':{label:'Utiliti',limit:20000}, 'Biz-Machines':{label:'Mesin & penyelenggaraan',limit:50000},
  'Biz-Rental':{label:'Sewa premis',limit:50000}, 'Biz-Travel':{label:'Perjalanan bisnes',limit:15000}, 'Biz-Marketing':{label:'Pemasaran',limit:15000}, 'Biz-Others':{label:'Lain-lain',limit:25000}
};
const PROFILE_TYPES = {'Faisal':'personal','Nita':'personal','Aryan Laundry':'business'};
const defaults = {
  Faisal:{name:'Faisal',ic:'',tin:'',ref:''}, Nita:{name:'Nita',ic:'',tin:'',ref:''},
  'Aryan Laundry':{name:'Aryan Laundry',ic:'',tin:'',ref:''}
};

const state = {
  activeProfile:'Faisal', year:new Date().getFullYear(), receipts:read(STORAGE.receipts,[]), profiles:read(STORAGE.profiles,defaults),
  pending:read(STORAGE.pending,[]), supabase:null, user:null, cloud:false, installPrompt:null, imageRotation:0, editingImages:[], gallery:[], galleryIndex:0
};

document.addEventListener('DOMContentLoaded', init);

async function init(){
  applyTheme(); fillYears(); bindEvents(); await configureCloud(); updateOnlineState(); routeFromUrl(); renderAll(); registerPWA();
}

function bindEvents(){
  $$('[data-view]').forEach(el=>el.addEventListener('click',()=>showView(el.dataset.view)));
  $$('[data-action="scan"]').forEach(el=>el.addEventListener('click',()=>openReceipt()));
  $$('[data-close]').forEach(el=>el.addEventListener('click',()=>document.getElementById(el.dataset.close).close()));
  $('#profileSelect').addEventListener('change',e=>{state.activeProfile=e.target.value;renderAll();});
  $('#settingsBtn').addEventListener('click',()=>showView('profile'));
  $('#yearSelect').addEventListener('change',e=>{state.year=Number(e.target.value);renderAll();});
  $('#searchInput').addEventListener('input',renderReceipts); $('#categoryFilter').addEventListener('change',renderReceipts); $('#monthFilter').addEventListener('change',renderReceipts);
  $('#receiptProfile').addEventListener('change',e=>fillCategories(e.target.value)); $('#receiptFile').addEventListener('change',handleImage);
  $('#receiptForm').addEventListener('submit',saveReceipt); $('#profileForm').addEventListener('submit',saveProfile);
  $('#themeBtn').addEventListener('click',toggleTheme); $('#printBtn').addEventListener('click',()=>window.print()); $('#csvBtn').addEventListener('click',exportCSV);
  $('#backupBtn').addEventListener('click',backupJSON); $('#restoreInput').addEventListener('change',restoreJSON); $('#syncBtn').addEventListener('click',syncNow);
  $('#installBtn').addEventListener('click',installPWA); $('#logoutBtn').addEventListener('click',logout);
  $('#authForm').addEventListener('submit',login); $('#signupBtn').addEventListener('click',signup);
  $('#rotateImageBtn').addEventListener('click',()=>{state.imageRotation=(state.imageRotation+90)%360;$('#fullReceiptImage').style.transform=`rotate(${state.imageRotation}deg)`;});
  $('#prevImageBtn').addEventListener('click',()=>stepGallery(-1));$('#nextImageBtn').addEventListener('click',()=>stepGallery(1));
  window.addEventListener('online',()=>{updateOnlineState();syncNow(true);}); window.addEventListener('offline',updateOnlineState);
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;$('#installBtn').classList.remove('hidden');});
}

async function configureCloud(){
  try{
    const cfg=await fetch('/api/config',{cache:'no-store'}).then(r=>r.ok?r.json():null);
    if(!cfg?.supabaseUrl||!cfg?.supabaseAnonKey||!window.supabase){setMode('local');return;}
    state.supabase=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
    const {data}=await state.supabase.auth.getSession(); state.user=data.session?.user||null;
    state.supabase.auth.onAuthStateChange(async(_event,session)=>{state.user=session?.user||null;if(state.user){$('#authDialog').open&&$('#authDialog').close();await loadCloud();}updateAuthUI();});
    if(state.user) await loadCloud(); else {$('#authDialog').showModal();setMode('secure');}
    updateAuthUI();
  }catch(err){console.warn(err);setMode('local');}
}

function setMode(mode){
  state.cloud=mode==='cloud';
  const badge=$('#syncBadge'),info=$('#modeInfo');
  if(mode==='cloud'){badge.className='sync-badge synced';badge.innerHTML='<i class="fa-solid fa-cloud-arrow-up"></i><span>Cloud sync</span>';info.textContent='Data diselaraskan dengan akaun Supabase anda.';}
  else if(mode==='secure'){badge.className='sync-badge';badge.innerHTML='<i class="fa-solid fa-lock"></i><span>Log masuk</span>';info.textContent='Log masuk diperlukan untuk menggunakan cloud.';}
  else{badge.className='sync-badge';badge.innerHTML='<i class="fa-solid fa-mobile-screen"></i><span>Dalam peranti</span>';info.textContent='Mod peranti: data disimpan dalam pelayar ini. Konfigurasi Netlify untuk cloud sync.';}
}

async function loadCloud(){
  if(!state.user)return; setMode('cloud');
  const [pr,rr]=await Promise.all([
    state.supabase.from('tax_profiles').select('*').eq('owner_id',state.user.id),
    state.supabase.from('receipts').select('*').eq('owner_id',state.user.id).order('date',{ascending:false})
  ]);
  if(pr.error||rr.error){toast('Cloud tidak dapat dimuatkan. Menggunakan salinan peranti.',true);return;}
  if(pr.data?.length) pr.data.forEach(p=>state.profiles[p.profile_key]={name:p.name,ic:p.ic||'',tin:p.tin||'',ref:p.reference||''});
  if(rr.data?.length){state.receipts=rr.data.map(mapCloudReceipt);await Promise.all(state.receipts.map(async r=>{r.images=await Promise.all(r.imagePaths.map(async path=>{const {data}=await state.supabase.storage.from('receipts').createSignedUrl(path,3600);return data?.signedUrl||'';}));r.image=r.images[0]||'';}));}
  persist(); await syncNow(true); renderAll();
}

function mapCloudReceipt(r){const paths=r.image_paths?.length?r.image_paths:(r.image_url?[r.image_url]:[]);return{id:r.id,user:r.profile_key,date:r.date,store:r.store,category:r.category,items:r.items,amount:Number(r.amount),image:'',images:[],imagePath:paths[0]||'',imagePaths:paths,needsReview:!!r.needs_review,updatedAt:r.updated_at||new Date().toISOString()};}

function updateAuthUI(){
  $('#logoutBtn').classList.toggle('hidden',!state.user); if(state.user)setMode('cloud');
}

async function login(e){e.preventDefault();setButton($('#loginBtn'),true,'Log masuk');hide('#authError');const {error}=await state.supabase.auth.signInWithPassword({email:$('#authEmail').value.trim(),password:$('#authPassword').value});setButton($('#loginBtn'),false,'Log masuk');if(error)authError(error.message);}
async function signup(){setButton($('#signupBtn'),true,'Daftar');hide('#authError');const {error}=await state.supabase.auth.signUp({email:$('#authEmail').value.trim(),password:$('#authPassword').value});setButton($('#signupBtn'),false,'Daftar');if(error)authError(error.message);else toast('Akaun didaftarkan. Semak e-mel jika pengesahan diaktifkan.');}
async function logout(){await state.supabase?.auth.signOut();state.user=null;setMode('secure');$('#authDialog').showModal();}
function authError(msg){const el=$('#authError');el.textContent=msg;el.classList.remove('hidden');}

function showView(name){
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`${name}View`));
  $$('.bottom-nav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $$('.desktop-nav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  if(name==='reports')renderReport(); if(name==='profile')renderProfile(); window.scrollTo({top:0,behavior:'smooth'});
}

function routeFromUrl(){const p=new URLSearchParams(location.search);if(p.get('view'))showView(p.get('view'));if(p.get('action')==='scan')setTimeout(()=>openReceipt(),250);}

function fillYears(){const el=$('#yearSelect');for(let y=new Date().getFullYear()+1;y>=2020;y--)el.add(new Option(`Tahun ${y}`,y));el.value=state.year;const months=['Semua bulan','Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];$('#monthFilter').innerHTML=months.map((m,i)=>`<option value="${i||'ALL'}">${m}</option>`).join('');}

function renderAll(){
  $('#profileSelect').value=state.activeProfile;$('#activeProfileLabel').textContent=state.activeProfile;$('#yearSelect').value=state.year;$('#yearLabel').textContent=state.year;
  $('#welcomeName').textContent=state.profiles[state.activeProfile]?.name?.split(' ')[0]||state.activeProfile;fillCategories(state.activeProfile);renderDashboard();renderReceipts();renderReport();renderProfile();
}

function yearReceipts(profile=state.activeProfile){return state.receipts.filter(r=>r.user===profile&&new Date(`${r.date}T00:00:00`).getFullYear()===state.year);}
function categoryMap(profile=state.activeProfile){return PROFILE_TYPES[profile]==='business'?BUSINESS:PERSONAL;}
function isClaim(r){return PROFILE_TYPES[r.user]==='business'||r.category!=='Others';}
function money(n){return new Intl.NumberFormat('ms-MY',{style:'currency',currency:'MYR'}).format(Number(n)||0);}
function formatDate(d){return new Intl.DateTimeFormat('ms-MY',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${d}T00:00:00`));}

function renderDashboard(){
  const rows=yearReceipts(),claim=rows.filter(isClaim).reduce((s,r)=>s+r.amount,0),non=rows.filter(r=>!isClaim(r)).reduce((s,r)=>s+r.amount,0),review=rows.filter(r=>r.needsReview).length;
  $('#totalClaim').textContent=money(claim);$('#totalNonClaim').textContent=money(non);$('#totalReceipts').textContent=rows.length;$('#reviewCaption').textContent=`${review} perlu disemak`;
  $('#claimCaption').textContent=PROFILE_TYPES[state.activeProfile]==='business'?'Perbelanjaan direkodkan':'Berdasarkan kategori';
  const monthly=Array(12).fill(0);rows.forEach(r=>monthly[new Date(`${r.date}T00:00:00`).getMonth()]+=r.amount);const max=Math.max(...monthly,1);const labels=['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogo','Sep','Okt','Nov','Dis'];
  $('#monthChart').innerHTML=monthly.map((n,i)=>`<div class="month-column" title="${labels[i]}: ${money(n)}"><div class="month-bar" style="height:${Math.max(2,n/max*100)}%"></div><small>${labels[i]}</small></div>`).join('');
  const attention=rows.filter(r=>r.needsReview||!r.image).slice(0,4);$('#attentionList').innerHTML=attention.length?attention.map(r=>`<div class="attention-item"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${esc(r.store)}</strong><span>${r.needsReview?'Maklumat OCR perlu disemak':'Tiada gambar resit'}</span></div></div>`).join(''):'<div class="empty-mini"><i class="fa-solid fa-circle-check"></i><br>Semua rekod kelihatan lengkap.</div>';
  const cats=categoryMap();$('#limitsTitle').textContent=PROFILE_TYPES[state.activeProfile]==='business'?'Ringkasan kategori perniagaan':'Had pelepasan cukai';
  $('#limitsGrid').innerHTML=Object.entries(cats).filter(([k])=>k!=='Others').map(([key,c])=>{const spent=rows.filter(r=>r.category===key).reduce((s,r)=>s+r.amount,0),pct=Math.min(100,spent/c.limit*100);return`<div class="limit-card"><div class="limit-top"><strong>${esc(c.label)}</strong><span>Had ${money(c.limit)}</span></div><div class="progress"><span style="width:${pct}%"></span></div><div class="limit-bottom"><span>Rekod ${money(spent)}</span><span>Baki ${money(Math.max(0,c.limit-spent))}</span></div></div>`}).join('');
}

function fillCategories(profile){
  const selectedProfile=profile||$('#receiptProfile').value||state.activeProfile;
  const map=categoryMap(profile),current=$('#receiptCategory').value;$('#receiptCategory').innerHTML=Object.entries(map).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');if(map[current])$('#receiptCategory').value=current;
  $('#categoryFilter').innerHTML='<option value="ALL">Semua kategori</option>'+Object.entries(categoryMap()).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#receiptProfile').innerHTML=Object.keys(PROFILE_TYPES).map(p=>`<option value="${esc(p)}">${esc(p)} · ${PROFILE_TYPES[p]==='business'?'Bisnes':'Peribadi'}</option>`).join('');
  $('#receiptProfile').value=selectedProfile;
}

function filteredReceipts(){const q=$('#searchInput').value.toLowerCase(),cat=$('#categoryFilter').value,month=$('#monthFilter').value;return yearReceipts().filter(r=>(!q||`${r.store} ${r.items} ${r.amount}`.toLowerCase().includes(q))&&(cat==='ALL'||r.category===cat)&&(month==='ALL'||new Date(`${r.date}T00:00:00`).getMonth()+1===Number(month)));}

function renderReceipts(){
  const rows=filteredReceipts(),list=$('#receiptList');$('#emptyState').classList.toggle('hidden',rows.length>0);list.innerHTML=rows.map(r=>`<article class="receipt-card"><button class="receipt-thumb view-image" data-id="${r.id}" aria-label="Lihat gambar"><img src="${safeImage(r.image)}" alt=""></button><div class="receipt-main"><h3>${esc(r.store)}</h3><p>${esc(r.items)}</p><div class="receipt-meta"><span class="tag">${esc(categoryMap(r.user)[r.category]?.label||r.category)}</span>${r.needsReview?'<span class="tag review">Semak</span>':''}</div></div><div class="receipt-amount"><strong>${money(r.amount)}</strong><small>${formatDate(r.date)}</small></div><div class="receipt-actions"><button class="edit-receipt" data-id="${r.id}" aria-label="Edit"><i class="fa-solid fa-pen"></i></button><button class="delete-receipt" data-id="${r.id}" aria-label="Padam"><i class="fa-solid fa-trash"></i></button></div></article>`).join('');
  $$('.view-image').forEach(b=>b.addEventListener('click',()=>viewImage(b.dataset.id)));$$('.edit-receipt').forEach(b=>b.addEventListener('click',()=>openReceipt(b.dataset.id)));$$('.delete-receipt').forEach(b=>b.addEventListener('click',()=>deleteReceipt(b.dataset.id)));
}

function openReceipt(id=''){
  $('#receiptForm').reset();$('#receiptId').value=id;state.editingImages=[];clearUncertain();
  const r=id?state.receipts.find(x=>x.id===id):null;$('#dialogEyebrow').textContent=r?'Kemaskini rekod':'Resit baharu';$('#dialogTitle').textContent=r?'Edit resit':'Imbas & semak resit';
  $('#receiptProfile').value=r?.user||state.activeProfile;fillCategories($('#receiptProfile').value);$('#receiptDate').value=r?.date||new Date().toISOString().slice(0,10);$('#receiptStore').value=r?.store||'';$('#receiptCategory').value=r?.category||Object.keys(categoryMap($('#receiptProfile').value))[0];$('#receiptItems').value=r?.items||'';$('#receiptAmount').value=r?.amount||'';
  state.editingImages=r?.images?.length?[...r.images]:(r?.image?[r.image]:[]);if(state.editingImages.length){$('#receiptPreview').src=state.editingImages[0];show('#receiptPreview');hide('#uploadPrompt');showImageCount();}else{hide('#receiptPreview');hide('#imageCount');show('#uploadPrompt');}hide('#ocrStatus');$('#receiptDialog').showModal();
}

async function handleImage(e){
  const files=[...e.target.files];if(!files.length)return;if(files.some(f=>f.size>7*1024*1024)){toast('Salah satu gambar melebihi 7 MB.',true);e.target.value='';return;}
  try{state.editingImages=await Promise.all(files.map(f=>compressImage(f,1600,.78)));$('#receiptPreview').src=state.editingImages[0];show('#receiptPreview');hide('#uploadPrompt');showImageCount();statusOCR('AI sedang membaca muka surat pertama…',true);const base64=state.editingImages[0].split(',')[1];const res=await fetch('/api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:base64,mimeType:'image/jpeg',profileType:PROFILE_TYPES[$('#receiptProfile').value]})});const out=await res.json();if(!res.ok)throw new Error(out.error);applyOCR(out);statusOCR('Bacaan siap — sila semak maklumat.',false);}catch(err){statusOCR('AI tidak dapat membaca. Isi maklumat secara manual.',false);toast(err.message||'OCR gagal',true);}
}
function showImageCount(){const el=$('#imageCount');el.textContent=`${state.editingImages.length} gambar`;el.classList.toggle('hidden',!state.editingImages.length);}

function applyOCR(o){
  if(o.store)$('#receiptStore').value=o.store;if(/^\d{4}-\d{2}-\d{2}$/.test(o.date||''))$('#receiptDate').value=o.date;if(Number(o.amount)>0)$('#receiptAmount').value=Number(o.amount).toFixed(2);if(o.items)$('#receiptItems').value=o.items;
  if([...$('#receiptCategory').options].some(x=>x.value===o.category))$('#receiptCategory').value=o.category;
  const uncertain=(o.uncertainFields||[]);if(Number(o.confidence)<.75&&!uncertain.length)uncertain.push('store','date','amount','items');uncertain.forEach(k=>({store:'#receiptStore',date:'#receiptDate',amount:'#receiptAmount',items:'#receiptItems',category:'#receiptCategory'}[k]&&$(({store:'#receiptStore',date:'#receiptDate',amount:'#receiptAmount',items:'#receiptItems',category:'#receiptCategory'})[k]).parentElement.classList.add('field-uncertain')));$('#uncertainAlert').classList.toggle('hidden',!uncertain.length);
}
function clearUncertain(){$$('.field-uncertain').forEach(e=>e.classList.remove('field-uncertain'));hide('#uncertainAlert');}
function statusOCR(text,spin){const el=$('#ocrStatus');el.innerHTML=`${spin?'<i class="fa-solid fa-spinner fa-spin"></i> ':''}${esc(text)}`;show('#ocrStatus');}

async function saveReceipt(e){
  e.preventDefault();const btn=$('#saveReceiptBtn');setButton(btn,true,'Menyimpan…');const id=$('#receiptId').value||crypto.randomUUID(),existing=state.receipts.find(r=>r.id===id),profile=$('#receiptProfile').value;
  const receipt={id,user:profile,date:$('#receiptDate').value,store:$('#receiptStore').value.trim(),category:$('#receiptCategory').value,items:$('#receiptItems').value.trim(),amount:Number($('#receiptAmount').value),image:state.editingImages[0]||'',images:state.editingImages,imagePath:existing?.imagePath||'',imagePaths:existing?.imagePaths||[],needsReview:$$('.field-uncertain').length>0,updatedAt:new Date().toISOString()};
  const duplicate=state.receipts.find(r=>r.id!==id&&r.user===receipt.user&&r.date===receipt.date&&Math.abs(r.amount-receipt.amount)<.01&&r.store.toLowerCase()===receipt.store.toLowerCase());
  if(duplicate&&!confirm('Resit dengan tarikh, premis dan jumlah yang sama sudah wujud. Simpan juga?')){setButton(btn,false,'Simpan resit');return;}
  const idx=state.receipts.findIndex(r=>r.id===id);if(idx>=0)state.receipts[idx]=receipt;else state.receipts.unshift(receipt);queue({type:'upsert',id});persist();renderAll();$('#receiptDialog').close();toast(existing?'Resit berjaya dikemas kini.':'Resit berjaya disimpan.');setButton(btn,false,'Simpan resit');if(navigator.onLine)await syncNow(true);
}

async function deleteReceipt(id){
  const r=state.receipts.find(x=>x.id===id);if(!r||!confirm(`Padam resit “${r.store}”? Tindakan ini tidak boleh dibatalkan.`))return;state.receipts=state.receipts.filter(x=>x.id!==id);queue({type:'delete',id,imagePaths:r.imagePaths||[]});persist();renderAll();toast('Resit telah dipadam.');if(navigator.onLine)await syncNow(true);
}

function viewImage(id){const r=state.receipts.find(x=>x.id===id);state.gallery=r?.images?.length?r.images:(r?.image?[r.image]:[]);if(!state.gallery.length){toast('Gambar resit tidak tersedia.',true);return;}state.galleryIndex=0;state.galleryReceipt=r;renderGallery();$('#imageDialog').showModal();}
function stepGallery(delta){if(!state.gallery.length)return;state.galleryIndex=(state.galleryIndex+delta+state.gallery.length)%state.gallery.length;renderGallery();}
function renderGallery(){const src=state.gallery[state.galleryIndex];state.imageRotation=0;$('#fullReceiptImage').style.transform='rotate(0deg)';$('#fullReceiptImage').src=src;$('#galleryCount').textContent=`${state.galleryIndex+1} / ${state.gallery.length}`;$('#downloadImageBtn').href=src;$('#downloadImageBtn').download=`resit-${state.galleryReceipt.date}-${slug(state.galleryReceipt.store)}-${state.galleryIndex+1}.jpg`;$('#prevImageBtn').classList.toggle('hidden',state.gallery.length<2);$('#nextImageBtn').classList.toggle('hidden',state.gallery.length<2);}

async function syncNow(silent=false){
  if(!state.cloud||!state.user||!navigator.onLine){if(!silent)toast(state.cloud?'Tiada internet. Sync akan dibuat kemudian.':'Cloud belum dikonfigurasi.',!state.cloud);return;}
  const badge=$('#syncBadge');badge.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i><span>Sync</span>';
  try{
    for(const job of [...state.pending]){
      if(job.type==='delete'){const {error}=await state.supabase.from('receipts').delete().eq('id',job.id).eq('owner_id',state.user.id);if(error)throw error;if(job.imagePaths?.length)await state.supabase.storage.from('receipts').remove(job.imagePaths);}
      else{const r=state.receipts.find(x=>x.id===job.id);if(!r)continue;let paths=r.imagePaths||[],images=r.images?.length?r.images:(r.image?[r.image]:[]);if(images.some(x=>x.startsWith('data:'))){const uploaded=await uploadImages(r,images);paths=uploaded.paths;r.images=uploaded.urls;r.image=uploaded.urls[0]||'';r.imagePaths=paths;r.imagePath=paths[0]||'';}const {error}=await state.supabase.from('receipts').upsert({id:r.id,owner_id:state.user.id,profile_key:r.user,date:r.date,store:r.store,category:r.category,items:r.items,amount:r.amount,image_url:paths[0]||'',image_paths:paths,needs_review:r.needsReview,updated_at:r.updatedAt});if(error)throw error;}
      state.pending=state.pending.filter(x=>!(x.type===job.type&&x.id===job.id));persist();
    }
    setMode('cloud');if(!silent)toast('Semua data telah diselaraskan.');
  }catch(err){badge.className='sync-badge error';badge.innerHTML='<i class="fa-solid fa-triangle-exclamation"></i><span>Sync gagal</span>';if(!silent)toast(`Sync gagal: ${err.message}`,true);}
}

async function uploadImages(r,images){const paths=[],urls=[];for(let i=0;i<images.length;i++){if(!images[i].startsWith('data:')&&r.imagePaths?.[i]){paths.push(r.imagePaths[i]);urls.push(images[i]);continue;}const blob=await fetch(images[i]).then(x=>x.blob()),path=`${state.user.id}/${r.id}-${i+1}.jpg`;const {error}=await state.supabase.storage.from('receipts').upload(path,blob,{contentType:'image/jpeg',upsert:true});if(error)throw error;const {data}=await state.supabase.storage.from('receipts').createSignedUrl(path,3600);paths.push(path);urls.push(data?.signedUrl||images[i]);}return{paths,urls};}
function queue(job){state.pending=state.pending.filter(x=>!(x.type===job.type&&x.id===job.id));state.pending.push(job);}

function renderProfile(){const p=state.profiles[state.activeProfile]||defaults[state.activeProfile];$('#profileName').value=p.name||'';$('#profileIC').value=p.ic||'';$('#profileTIN').value=p.tin||'';$('#profileRef').value=p.ref||'';}
async function saveProfile(e){e.preventDefault();const p={name:$('#profileName').value.trim(),ic:$('#profileIC').value.trim(),tin:$('#profileTIN').value.trim(),ref:$('#profileRef').value.trim()};state.profiles[state.activeProfile]=p;persist();if(state.cloud&&state.user){const {error}=await state.supabase.from('tax_profiles').upsert({owner_id:state.user.id,profile_key:state.activeProfile,name:p.name,ic:p.ic,tin:p.tin,reference:p.ref},{onConflict:'owner_id,profile_key'});if(error){toast(error.message,true);return;}}renderAll();toast('Profil berjaya disimpan.');}

function renderReport(){
  const p=state.profiles[state.activeProfile]||{},rows=yearReceipts(),total=rows.reduce((s,r)=>s+r.amount,0);$('#reportIdentity').innerHTML=`<strong>${esc(p.name||state.activeProfile)}</strong><br>No. KP / SSM: ${esc(mask(p.ic))}<br>No. TIN: ${esc(mask(p.tin))}<br>No. Rujukan: ${esc(mask(p.ref))}<br>Tahun: ${state.year}`;
  $('#reportSummary').innerHTML=`<div><small>Jumlah resit</small><strong>${rows.length}</strong></div><div><small>Boleh tuntut / rekod bisnes</small><strong>${money(rows.filter(isClaim).reduce((s,r)=>s+r.amount,0))}</strong></div><div><small>Jumlah keseluruhan</small><strong>${money(total)}</strong></div>`;
  $('#reportRows').innerHTML=rows.length?rows.map(r=>`<tr><td>${formatDate(r.date)}</td><td><strong>${esc(r.store)}</strong><br>${esc(r.items)}</td><td>${esc(categoryMap(r.user)[r.category]?.label||r.category)}</td><td>${money(r.amount)}</td></tr>`).join(''):'<tr><td colspan="4">Tiada rekod.</td></tr>';
}

function exportCSV(){const rows=yearReceipts(),csv=[['Tarikh','Profil','Premis','Kategori','Butiran','Jumlah (RM)','Perlu Semak'],...rows.map(r=>[r.date,r.user,r.store,r.category,r.items,r.amount.toFixed(2),r.needsReview?'Ya':'Tidak'])].map(row=>row.map(csvCell).join(',')).join('\n');download(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),`resit-${slug(state.activeProfile)}-${state.year}.csv`);toast('Fail CSV telah disediakan.');}
function backupJSON(){download(new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),profiles:state.profiles,receipts:state.receipts},null,2)],{type:'application/json'}),`mytax-backup-${new Date().toISOString().slice(0,10)}.json`);}
async function restoreJSON(e){try{const data=JSON.parse(await e.target.files[0].text());if(!Array.isArray(data.receipts)||!data.profiles)throw new Error('Format backup tidak sah');if(!confirm(`Restore ${data.receipts.length} resit? Data semasa akan digantikan.`))return;state.receipts=data.receipts;state.profiles=data.profiles;state.receipts.forEach(r=>queue({type:'upsert',id:r.id}));persist();renderAll();toast('Backup berjaya dipulihkan.');if(navigator.onLine)syncNow(true);}catch(err){toast(err.message,true);}finally{e.target.value='';}}

function toggleTheme(){document.documentElement.classList.remove('dark');localStorage.setItem(STORAGE.theme,'light');}
function applyTheme(){document.documentElement.classList.remove('dark');localStorage.setItem(STORAGE.theme,'light');$('#themeBtn i').className='fa-solid fa-sun';}
function updateOnlineState(){$('#offlineBar').classList.toggle('hidden',navigator.onLine);}

function registerPWA(){if('serviceWorker'in navigator)navigator.serviceWorker.register('/service-worker.js').catch(console.warn);}
async function installPWA(){if(!state.installPrompt){toast('Gunakan menu browser dan pilih “Add to Home Screen”.');return;}state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;hide('#installBtn');}

function compressImage(file,max=1600,quality=.78){return new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{let{width,height}=img;if(Math.max(width,height)>max){const s=max/Math.max(width,height);width=Math.round(width*s);height=Math.round(height*s);}const c=document.createElement('canvas');c.width=width;c.height=height;c.getContext('2d').drawImage(img,0,0,width,height);URL.revokeObjectURL(url);resolve(c.toDataURL('image/jpeg',quality));};img.onerror=reject;img.src=url;});}
function persist(){localStorage.setItem(STORAGE.receipts,JSON.stringify(state.receipts));localStorage.setItem(STORAGE.profiles,JSON.stringify(state.profiles));localStorage.setItem(STORAGE.pending,JSON.stringify(state.pending));}
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))||structuredClone(fallback);}catch{return structuredClone(fallback);}}
function safeImage(src){return src&&(/^(data:image\/|blob:|https:\/\/)/).test(src)?src:'/assets/receipt-placeholder.svg';}
function mask(v=''){if(!v)return'Belum diisi';if(v.length<5)return'••••';return`${v.slice(0,2)}${'•'.repeat(Math.min(8,v.length-4))}${v.slice(-2)}`;}
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function slug(v){return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function csvCell(v){return`"${String(v??'').replace(/"/g,'""')}"`;}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function show(s){$(s).classList.remove('hidden');}function hide(s){$(s).classList.add('hidden');}
function setButton(btn,busy,label){btn.disabled=busy;btn.innerHTML=busy?`<i class="fa-solid fa-spinner fa-spin"></i> ${label}`:label;}
function toast(message,error=false){const el=document.createElement('div');el.className=`toast${error?' error':''}`;el.textContent=message;$('#toastRegion').append(el);setTimeout(()=>el.remove(),3500);}
