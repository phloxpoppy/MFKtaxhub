'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const STORAGE = { receipts:'mytax_v2_receipts', documents:'mytax_v3_documents', profiles:'mytax_v2_profiles', pending:'mytax_v3_pending', theme:'mytax_theme' };
const PERSONAL = {
  Lifestyle:{label:'Gaya hidup',limit:2500}, Medical:{label:'Perubatan',limit:10000}, Education:{label:'Pendidikan sendiri',limit:7000},
  Tech:{label:'Peranti & teknologi',limit:2500}, Insurance:{label:'Insurans / takaful',limit:3000}, Childcare:{label:'Penjagaan anak',limit:3000},
  Sports:{label:'Aktiviti sukan',limit:1000}, Others:{label:'Lain-lain / bukan tuntutan',limit:1}
};
const BUSINESS = {
  'Biz-Supplies':{label:'Bekalan operasi'}, 'Biz-Utilities':{label:'Utiliti'}, 'Biz-Machines':{label:'Aset / elaun modal'},
  'Biz-Rental':{label:'Sewa premis'}, 'Biz-Travel':{label:'Perjalanan bisnes'}, 'Biz-Marketing':{label:'Pemasaran'}, 'Biz-Others':{label:'Lain-lain / semakan cukai'}
};
const PROFILE_TYPES = {'Faisal':'personal','Nita':'personal','Aryan Laundry':'business'};
const defaults = {
  Faisal:{name:'Faisal',ic:'',tin:'',ref:''}, Nita:{name:'Nita',ic:'',tin:'',ref:''},
  'Aryan Laundry':{name:'Aryan Laundry',ic:'',tin:'',ref:''}
};

const state = {
  activeProfile:'Faisal', year:new Date().getFullYear(), receipts:read(STORAGE.receipts,[]), documents:read(STORAGE.documents,[]), profiles:read(STORAGE.profiles,defaults),
  pending:read(STORAGE.pending,[]), supabase:null, user:null, cloud:false, installPrompt:null, imageRotation:0, editingImages:[], gallery:[], galleryIndex:0
};

document.addEventListener('DOMContentLoaded', init);

async function init(){
  applyTheme(); fillYears(); bindEvents(); await configureCloud(); updateOnlineState(); routeFromUrl(); renderAll(); registerPWA();
}

function bindEvents(){
  $$('[data-view]').forEach(el=>el.addEventListener('click',()=>showView(el.dataset.view)));
  $$('[data-action="scan"]').forEach(el=>el.addEventListener('click',()=>openReceipt()));
  $$('[data-action="scan-cp500"]').forEach(el=>el.addEventListener('click',()=>openReceipt('', 'cp500')));
  $$('[data-action="scan-statement"]').forEach(el=>el.addEventListener('click',()=>openDocument('', 'bank_statement')));
  $$('[data-action="upload-document"]').forEach(el=>el.addEventListener('click',()=>openDocument()));
  $$('[data-close]').forEach(el=>el.addEventListener('click',()=>document.getElementById(el.dataset.close).close()));
  $('#profileSelect').addEventListener('change',e=>{state.activeProfile=e.target.value;renderAll();});
  $('#settingsBtn').addEventListener('click',()=>showView('profile'));
  $('#yearSelect').addEventListener('change',e=>{state.year=Number(e.target.value);renderAll();});
  $('#searchInput').addEventListener('input',renderReceipts); $('#documentTypeFilter').addEventListener('change',renderReceipts); $('#categoryFilter').addEventListener('change',renderReceipts); $('#monthFilter').addEventListener('change',renderReceipts);
  $('#receiptProfile').addEventListener('change',e=>fillCategories(e.target.value)); $('#receiptRecordType').addEventListener('change',toggleScannedRecordFields); $('#receiptCamera').addEventListener('change',handleImage); $('#receiptFile').addEventListener('change',handleImage);
  $('#receiptForm').addEventListener('submit',saveReceipt); $('#documentForm').addEventListener('submit',saveDocument); $('#documentType').addEventListener('change',toggleDocumentFields); $('#documentFile').addEventListener('change',handleDocumentOCR); $('#profileForm').addEventListener('submit',saveProfile);
  $('#themeBtn').addEventListener('click',toggleTheme); $('#printBtn').addEventListener('click',()=>window.print()); $('#csvBtn').addEventListener('click',exportCSV);
  $('#backupBtn').addEventListener('click',backupJSON); $('#restoreInput').addEventListener('change',restoreJSON); $('#syncBtn').addEventListener('click',syncNow);
  $('#evidenceMonth').addEventListener('change',updateEvidenceCount);$('#evidenceCategory').addEventListener('change',updateEvidenceCount);
  $('#downloadEvidenceBtn').addEventListener('click',downloadEvidencePDF);$('#printEvidenceBtn').addEventListener('click',printEvidenceBundle);
  $('#installBtn').addEventListener('click',installPWA); $('#logoutBtn').addEventListener('click',logout);
  $('#authForm').addEventListener('submit',login); $('#signupBtn').addEventListener('click',signup);
  $('#rotateImageBtn').addEventListener('click',()=>{state.imageRotation=(state.imageRotation+90)%360;$('#fullReceiptImage').style.transform=`rotate(${state.imageRotation}deg)`;});
  $('#printPdfBtn').addEventListener('click',printPdf);
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
  const [pr,rr,dr]=await Promise.all([
    state.supabase.from('tax_profiles').select('*').eq('owner_id',state.user.id),
    state.supabase.from('receipts').select('*').eq('owner_id',state.user.id).order('date',{ascending:false}),
    state.supabase.from('audit_documents').select('*').eq('owner_id',state.user.id).order('document_date',{ascending:false})
  ]);
  if(pr.error||rr.error||dr.error){toast('Cloud tidak dapat dimuatkan. Pastikan SQL versi Audit Hub telah dijalankan.',true);return;}
  if(pr.data?.length) pr.data.forEach(p=>state.profiles[p.profile_key]={name:p.name,ic:p.ic||'',tin:p.tin||'',ref:p.reference||''});
  if(rr.data?.length){state.receipts=rr.data.map(mapCloudReceipt);await Promise.all(state.receipts.map(async r=>{r.images=await Promise.all(r.imagePaths.map(async path=>{const {data}=await state.supabase.storage.from('receipts').createSignedUrl(path,3600);return data?.signedUrl||'';}));r.image=r.images[0]||'';}));}
  if(dr.data?.length){state.documents=dr.data.map(mapCloudDocument);await Promise.all(state.documents.map(async d=>{const {data}=await state.supabase.storage.from('audit-documents').createSignedUrl(d.filePath,3600);d.fileUrl=data?.signedUrl||'';}));}
  persist(); await syncNow(true); renderAll();
}

function mapCloudReceipt(r){const paths=r.image_paths?.length?r.image_paths:(r.image_url?[r.image_url]:[]);return{id:r.id,user:r.profile_key,date:r.date,store:r.store,category:r.category,items:r.items,amount:Number(r.amount),image:'',images:[],imagePath:paths[0]||'',imagePaths:paths,needsReview:!!r.needs_review,updatedAt:r.updated_at||new Date().toISOString()};}
function mapCloudDocument(d){return{id:d.id,user:d.profile_key,type:d.document_type,date:d.document_date,title:d.title,amount:Number(d.amount)||0,notes:d.notes||'',month:d.statement_month||'',bankName:d.bank_name||'',accountLast4:d.account_last4||'',cp500Installment:d.cp500_installment||'',cp500Reference:d.cp500_reference||'',filePath:d.file_path,fileUrl:'',mimeType:d.mime_type||'',updatedAt:d.updated_at||new Date().toISOString()};}

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
function yearDocuments(profile=state.activeProfile){return state.documents.filter(d=>d.user===profile&&new Date(`${d.date}T00:00:00`).getFullYear()===state.year);}
function categoryMap(profile=state.activeProfile){return PROFILE_TYPES[profile]==='business'?BUSINESS:PERSONAL;}
function isClaim(r){return PROFILE_TYPES[r.user]==='business'||r.category!=='Others';}
function money(n){return new Intl.NumberFormat('ms-MY',{style:'currency',currency:'MYR'}).format(Number(n)||0);}
function formatDate(d){return new Intl.DateTimeFormat('ms-MY',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${d}T00:00:00`));}

function renderDashboard(){
  const rows=yearReceipts(),docs=yearDocuments(),claim=rows.filter(isClaim).reduce((s,r)=>s+r.amount,0),non=rows.filter(r=>!isClaim(r)).reduce((s,r)=>s+r.amount,0),review=rows.filter(r=>r.needsReview).length;
  $('#totalClaim').textContent=money(claim);$('#totalNonClaim').textContent=money(non);$('#totalReceipts').textContent=rows.length+docs.length;$('#reviewCaption').textContent=`${docs.filter(d=>d.type==='cp500').length} CP500 · ${docs.filter(d=>d.type==='bank_statement').length} penyata`;
  $('#claimCaption').textContent=PROFILE_TYPES[state.activeProfile]==='business'?'Rekod perniagaan—semak kelayakan cukai':'Berdasarkan kategori';
  const monthly=Array(12).fill(0);rows.forEach(r=>monthly[new Date(`${r.date}T00:00:00`).getMonth()]+=r.amount);const max=Math.max(...monthly,1);const labels=['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogo','Sep','Okt','Nov','Dis'];
  $('#monthChart').innerHTML=monthly.map((n,i)=>`<div class="month-column" title="${labels[i]}: ${money(n)}"><div class="month-bar" style="height:${Math.max(2,n/max*100)}%"></div><small>${labels[i]}</small></div>`).join('');
  const attention=rows.filter(r=>r.needsReview||!r.image).slice(0,4);$('#attentionList').innerHTML=attention.length?attention.map(r=>`<div class="attention-item"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${esc(r.store)}</strong><span>${r.needsReview?'Maklumat OCR perlu disemak':'Tiada gambar resit'}</span></div></div>`).join(''):'<div class="empty-mini"><i class="fa-solid fa-circle-check"></i><br>Semua rekod kelihatan lengkap.</div>';
  const cats=categoryMap();$('#limitsTitle').textContent=PROFILE_TYPES[state.activeProfile]==='business'?'Ringkasan kategori perniagaan':'Had pelepasan cukai';
  $('#limitsGrid').innerHTML=Object.entries(cats).filter(([k])=>k!=='Others').map(([key,c])=>{const spent=rows.filter(r=>r.category===key).reduce((s,r)=>s+r.amount,0);if(PROFILE_TYPES[state.activeProfile]==='business')return`<div class="limit-card"><div class="limit-top"><strong>${esc(c.label)}</strong><span>Rekod</span></div><div class="limit-bottom"><span>${money(spent)}</span><span>Semak kelayakan</span></div></div>`;const pct=Math.min(100,spent/c.limit*100);return`<div class="limit-card"><div class="limit-top"><strong>${esc(c.label)}</strong><span>Had ${money(c.limit)}</span></div><div class="progress"><span style="width:${pct}%"></span></div><div class="limit-bottom"><span>Rekod ${money(spent)}</span><span>Baki ${money(Math.max(0,c.limit-spent))}</span></div></div>`}).join('');
}

function fillCategories(profile){
  const selectedProfile=profile||$('#receiptProfile').value||state.activeProfile;
  const map=categoryMap(profile),current=$('#receiptCategory').value;$('#receiptCategory').innerHTML=Object.entries(map).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');if(map[current])$('#receiptCategory').value=current;
  $('#categoryFilter').innerHTML='<option value="ALL">Semua kategori</option>'+Object.entries(categoryMap()).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#receiptProfile').innerHTML=Object.keys(PROFILE_TYPES).map(p=>`<option value="${esc(p)}">${esc(p)} · ${PROFILE_TYPES[p]==='business'?'Bisnes':'Peribadi'}</option>`).join('');
  $('#receiptProfile').value=selectedProfile;
}

function filteredReceipts(){const q=$('#searchInput').value.toLowerCase(),cat=$('#categoryFilter').value,month=$('#monthFilter').value,type=$('#documentTypeFilter').value;const receipts=yearReceipts().filter(r=>(type==='ALL'||type==='receipt')&&(!q||`${r.store} ${r.items} ${r.amount}`.toLowerCase().includes(q))&&(cat==='ALL'||r.category===cat)&&(month==='ALL'||new Date(`${r.date}T00:00:00`).getMonth()+1===Number(month))).map(r=>({...r,recordType:'receipt'}));const docs=yearDocuments().filter(d=>(type==='ALL'||d.type===type)&&(!q||`${d.title} ${d.notes} ${d.bankName} ${d.amount}`.toLowerCase().includes(q))&&(month==='ALL'||new Date(`${d.date}T00:00:00`).getMonth()+1===Number(month))).map(d=>({...d,recordType:'document'}));return[...receipts,...docs].sort((a,b)=>b.date.localeCompare(a.date));}

function renderReceipts(){
  const rows=filteredReceipts(),list=$('#receiptList');$('#emptyState').classList.toggle('hidden',rows.length>0);list.innerHTML=rows.map(r=>r.recordType==='receipt'?`<article class="receipt-card"><button class="receipt-thumb view-image" data-id="${r.id}" aria-label="Lihat gambar"><img src="${safeImage(r.image)}" alt=""></button><div class="receipt-main"><h3>${esc(r.store)}</h3><p>${esc(r.items)}</p><div class="receipt-meta"><span class="tag">${esc(categoryMap(r.user)[r.category]?.label||r.category)}</span>${r.needsReview?'<span class="tag review">Semak</span>':''}</div></div><div class="receipt-amount"><strong>${money(r.amount)}</strong><small>${formatDate(r.date)}</small></div><div class="receipt-actions"><button class="edit-receipt" data-id="${r.id}" aria-label="Edit"><i class="fa-solid fa-pen"></i></button><button class="delete-receipt" data-id="${r.id}" aria-label="Padam"><i class="fa-solid fa-trash"></i></button></div></article>`:documentCard(r)).join('');
  $$('.view-image').forEach(b=>b.addEventListener('click',()=>viewImage(b.dataset.id)));$$('.view-document').forEach(b=>b.addEventListener('click',()=>viewDocument(b.dataset.id)));$$('.edit-receipt').forEach(b=>b.addEventListener('click',()=>openReceipt(b.dataset.id)));$$('.edit-document').forEach(b=>b.addEventListener('click',()=>openDocument(b.dataset.id)));$$('.delete-receipt').forEach(b=>b.addEventListener('click',()=>deleteReceipt(b.dataset.id)));$$('.delete-document').forEach(b=>b.addEventListener('click',()=>deleteDocument(b.dataset.id)));
}

function documentCard(d){const cp=d.type==='cp500',label=cp?'Bayaran LHDN CP500':'Penyata bank',icon=cp?'fa-landmark':'fa-file-pdf',detail=cp?`${d.cp500Installment?`Ansuran ${d.cp500Installment} · `:''}${d.cp500Reference||'Bukti bayaran'}`:`${d.bankName||'Bank'}${d.accountLast4?` · •••• ${d.accountLast4}`:''}${d.month?` · ${d.month}`:''}`;return`<article class="receipt-card document-card"><button class="receipt-thumb ${d.mimeType==='application/pdf'?'pdf-thumb':'cp500-thumb'} view-document" data-id="${d.id}" aria-label="Lihat dokumen"><i class="fa-solid ${icon}"></i></button><div class="receipt-main"><h3>${esc(d.title)}</h3><p>${esc(detail)}</p><div class="receipt-meta"><span class="tag ${cp?'':'statement'}">${label}</span></div></div><div class="receipt-amount"><strong>${d.amount?money(d.amount):'PDF'}</strong><small>${formatDate(d.date)}</small></div><div class="receipt-actions"><button class="edit-document" data-id="${d.id}" aria-label="Edit"><i class="fa-solid fa-pen"></i></button><button class="delete-document" data-id="${d.id}" aria-label="Padam"><i class="fa-solid fa-trash"></i></button></div></article>`;}

function toggleDocumentFields(){const cp=$('#documentType').value==='cp500';$('#documentMonthField').classList.toggle('hidden',cp);$('#bankNameField').classList.toggle('hidden',cp);$('#accountLast4Field').classList.toggle('hidden',cp);$('#documentAmountField').classList.toggle('hidden',!cp);$('#cp500InstallmentField').classList.toggle('hidden',!cp);$('#cp500ReferenceField').classList.toggle('hidden',!cp);$('#documentTitle').placeholder=cp?'Contoh: CP500 Ansuran 1 Tahun 2026':'Contoh: Penyata Bank Mei 2026';}
async function handleDocumentOCR(e){const file=e.target.files[0];if(!file||!file.type.startsWith('image/'))return;try{toast('AI sedang membaca dokumen…');const image=await compressImage(file,1600,.8),res=await fetch('/api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:image.split(',')[1],mimeType:'image/jpeg',profileType:'business'})}),out=await res.json();if(!res.ok)throw new Error(out.error||'OCR gagal');if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(out.date||''))$('#documentDate').value=out.date;if(Number(out.amount)>0)$('#documentAmount').value=Number(out.amount).toFixed(2);if(out.items)$('#documentNotes').value=out.items;if($('#documentType').value==='cp500'){$('#documentTitle').value='Bukti bayaran LHDN CP500';$('#cp500Reference').value=out.reference||$('#cp500Reference').value;}else if(out.store)$('#documentTitle').value=`Penyata bank · ${out.store}`;toast('Bacaan AI siap. Sila semak maklumat sebelum simpan.');}catch(err){toast(`Dokumen disimpan secara manual: ${err.message}`,true);}}
function openDocument(id='',defaultType='cp500'){const d=id?state.documents.find(x=>x.id===id):null;$('#documentForm').reset();$('#documentId').value=id;$('#documentProfile').innerHTML=Object.keys(PROFILE_TYPES).map(p=>`<option value="${esc(p)}">${esc(p)} · ${PROFILE_TYPES[p]==='business'?'Bisnes':'Peribadi'}</option>`).join('');$('#documentType').value=d?.type||defaultType;$('#documentProfile').value=d?.user||state.activeProfile;$('#documentDate').value=d?.date||new Date().toISOString().slice(0,10);$('#documentMonth').value=d?.month||'';$('#documentTitle').value=d?.title||'';$('#documentAmount').value=d?.amount||'';$('#cp500Installment').value=d?.cp500Installment||'';$('#cp500Reference').value=d?.cp500Reference||'';$('#bankName').value=d?.bankName||'';$('#accountLast4').value=d?.accountLast4||'';$('#documentNotes').value=d?.notes||'';$('#documentFile').required=!d;toggleDocumentFields();$('#documentDialog').showModal();}
async function saveDocument(e){e.preventDefault();const btn=$('#saveDocumentBtn'),file=$('#documentFile').files[0],id=$('#documentId').value||crypto.randomUUID(),existing=state.documents.find(d=>d.id===id);if(file&&file.size>10*1024*1024){toast('Fail dokumen melebihi 10 MB.',true);return;}if(!file&&!existing){toast('Sila pilih fail dokumen.',true);return;}setButton(btn,true,'Menyimpan…');const fileData=file?await blobToDataURL(file):(existing?.fileData||'');const d={id,user:$('#documentProfile').value,type:$('#documentType').value,date:$('#documentDate').value,title:$('#documentTitle').value.trim(),amount:Number($('#documentAmount').value)||0,notes:$('#documentNotes').value.trim(),month:$('#documentMonth').value,bankName:$('#bankName').value.trim(),accountLast4:$('#accountLast4').value.trim(),cp500Installment:$('#cp500Installment').value,cp500Reference:$('#cp500Reference').value.trim(),filePath:existing?.filePath||'',fileUrl:fileData||(existing?.fileUrl||''),fileData,mimeType:file?.type||existing?.mimeType||'',updatedAt:new Date().toISOString()};const idx=state.documents.findIndex(x=>x.id===id);if(idx>=0)state.documents[idx]=d;else state.documents.unshift(d);queue({type:'document-upsert',id});persist();renderAll();$('#documentDialog').close();toast('Dokumen audit berjaya disimpan.');setButton(btn,false,'Simpan dokumen');if(navigator.onLine)await syncNow(false);}
function viewDocument(id){const d=state.documents.find(x=>x.id===id),src=d?.fileUrl||d?.fileData;if(!src){toast('Fail dokumen belum tersedia.',true);return;}if(d.mimeType==='application/pdf'||src.toLowerCase().includes('.pdf')||src.startsWith('data:application/pdf')){$('#pdfViewer').src=src;$('#downloadPdfBtn').href=src;$('#downloadPdfBtn').download=`${slug(d.title)||'dokumen'}.pdf`;$('#pdfDialog').showModal();return;}state.gallery=[src];state.galleryIndex=0;state.galleryReceipt={date:d.date,store:d.title};renderGallery();$('#imageDialog').showModal();}
function printPdf(){const frame=$('#pdfViewer');try{frame.contentWindow?.focus();frame.contentWindow?.print();}catch{const src=frame.src,win=window.open(src,'_blank');if(!win)toast('Benarkan popup untuk mencetak PDF.',true);}}
async function deleteDocument(id){const d=state.documents.find(x=>x.id===id);if(!d||!confirm(`Padam dokumen “${d.title}”? Tindakan ini tidak boleh dibatalkan.`))return;state.documents=state.documents.filter(x=>x.id!==id);queue({type:'document-delete',id,filePath:d.filePath});persist();renderAll();toast('Dokumen telah dipadam.');if(navigator.onLine)await syncNow(false);}

function toggleScannedRecordFields(){const cp=$('#receiptRecordType').value==='cp500';$('#receiptStoreField').classList.toggle('hidden',cp);$('#receiptCategoryField').classList.toggle('hidden',cp);$('#receiptCp500InstallmentField').classList.toggle('hidden',!cp);$('#receiptCp500ReferenceField').classList.toggle('hidden',!cp);$('#receiptStore').required=!cp;$('#receiptCategory').required=!cp;$('#receiptItems').placeholder=cp?'Contoh: Bayaran CP500 melalui FPX / kaunter':'Ringkasan barangan atau perkhidmatan';}

function openReceipt(id='',recordType='receipt'){
  $('#receiptForm').reset();$('#receiptId').value=id;state.editingImages=[];clearUncertain();
  const r=id?state.receipts.find(x=>x.id===id):null;$('#dialogEyebrow').textContent=r?'Kemaskini rekod':'Resit baharu';$('#dialogTitle').textContent=r?'Edit resit':'Imbas & semak resit';
  $('#receiptProfile').value=r?.user||state.activeProfile;fillCategories($('#receiptProfile').value);$('#receiptRecordType').value=recordType;toggleScannedRecordFields();$('#receiptDate').value=r?.date||new Date().toISOString().slice(0,10);$('#receiptStore').value=r?.store||'';$('#receiptCategory').value=r?.category||Object.keys(categoryMap($('#receiptProfile').value))[0];$('#receiptItems').value=r?.items||'';$('#receiptAmount').value=r?.amount||'';$('#receiptCp500Installment').value='';$('#receiptCp500Reference').value='';
  state.editingImages=r?.images?.length?[...r.images]:(r?.image?[r.image]:[]);if(state.editingImages.length){$('#receiptPreview').src=state.editingImages[0];show('#receiptPreview');hide('#uploadPrompt');showImageCount();}else{hide('#receiptPreview');hide('#imageCount');show('#uploadPrompt');}hide('#ocrStatus');$('#receiptDialog').showModal();
}

async function handleImage(e){
  const files=[...e.target.files];if(!files.length)return;if(files.some(f=>f.size>7*1024*1024)){toast('Salah satu gambar melebihi 7 MB.',true);e.target.value='';return;}
  try{statusOCR('Memproses gambar seperti scanner…',true);state.editingImages=await Promise.all(files.map(scanReceiptImage));$('#receiptPreview').src=state.editingImages[0];show('#receiptPreview');hide('#uploadPrompt');showImageCount();statusOCR('AI sedang membaca muka surat pertama…',true);const base64=state.editingImages[0].split(',')[1];const res=await fetch('/api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:base64,mimeType:'image/jpeg',profileType:PROFILE_TYPES[$('#receiptProfile').value]})});const raw=await res.text();let out;try{out=JSON.parse(raw);}catch{out={error:`Server memulangkan respons tidak sah (${res.status}).`};}if(!res.ok)throw new Error(out.error||`OCR gagal (${res.status})`);applyOCR(out);statusOCR('Scan siap — sila semak maklumat.',false);}catch(err){const message=err.message||'OCR gagal. Cuba semula.';statusOCR(message,false);toast(message,true);}finally{e.target.value='';}
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
  if($('#receiptRecordType').value==='cp500'){
    const image=state.editingImages[0]||'';
    if(!image){setButton(btn,false,'Simpan resit');toast('Sila ambil atau pilih gambar bukti bayaran CP500.',true);return;}
    const doc={id:crypto.randomUUID(),user:profile,type:'cp500',date:$('#receiptDate').value,title:`CP500${$('#receiptCp500Installment').value?` · Ansuran ${$('#receiptCp500Installment').value}`:''}`,amount:Number($('#receiptAmount').value)||0,notes:$('#receiptItems').value.trim(),month:'',bankName:'',accountLast4:'',cp500Installment:$('#receiptCp500Installment').value,cp500Reference:$('#receiptCp500Reference').value.trim(),filePath:'',fileUrl:image,fileData:image,mimeType:'image/jpeg',updatedAt:new Date().toISOString()};
    state.documents.unshift(doc);queue({type:'document-upsert',id:doc.id});persist();renderAll();$('#receiptDialog').close();toast('Bukti bayaran CP500 berjaya disimpan.');setButton(btn,false,'Simpan resit');if(navigator.onLine)await syncNow(false);return;
  }
  const receipt={id,user:profile,date:$('#receiptDate').value,store:$('#receiptStore').value.trim(),category:$('#receiptCategory').value,items:$('#receiptItems').value.trim(),amount:Number($('#receiptAmount').value),image:state.editingImages[0]||'',images:state.editingImages,imagePath:existing?.imagePath||'',imagePaths:existing?.imagePaths||[],needsReview:$$('.field-uncertain').length>0,updatedAt:new Date().toISOString()};
  const duplicate=state.receipts.find(r=>r.id!==id&&r.user===receipt.user&&r.date===receipt.date&&Math.abs(r.amount-receipt.amount)<.01&&r.store.toLowerCase()===receipt.store.toLowerCase());
  if(duplicate&&!confirm('Resit dengan tarikh, premis dan jumlah yang sama sudah wujud. Simpan juga?')){setButton(btn,false,'Simpan resit');return;}
  const idx=state.receipts.findIndex(r=>r.id===id);if(idx>=0)state.receipts[idx]=receipt;else state.receipts.unshift(receipt);queue({type:'upsert',id});persist();renderAll();$('#receiptDialog').close();toast(existing?'Resit berjaya dikemas kini.':'Resit berjaya disimpan.');setButton(btn,false,'Simpan resit');if(navigator.onLine)await syncNow(false);
}

async function deleteReceipt(id){
  const r=state.receipts.find(x=>x.id===id);if(!r||!confirm(`Padam resit “${r.store}”? Tindakan ini tidak boleh dibatalkan.`))return;state.receipts=state.receipts.filter(x=>x.id!==id);queue({type:'delete',id,imagePaths:r.imagePaths||[]});persist();renderAll();toast('Resit telah dipadam.');if(navigator.onLine)await syncNow(false);
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
      else if(job.type==='document-delete'){const {error}=await state.supabase.from('audit_documents').delete().eq('id',job.id).eq('owner_id',state.user.id);if(error)throw error;if(job.filePath)await state.supabase.storage.from('audit-documents').remove([job.filePath]);}
      else if(job.type==='document-upsert'){const d=state.documents.find(x=>x.id===job.id);if(!d)continue;if(d.fileData){const ext=d.mimeType==='application/pdf'?'pdf':d.mimeType==='image/png'?'png':'jpg',path=`${state.user.id}/${d.id}.${ext}`,blob=dataUrlToBlob(d.fileData),{error}=await state.supabase.storage.from('audit-documents').upload(path,blob,{contentType:d.mimeType,upsert:true});if(error)throw error;const signed=await state.supabase.storage.from('audit-documents').createSignedUrl(path,3600);d.filePath=path;d.fileUrl=signed.data?.signedUrl||d.fileUrl;delete d.fileData;}const {error}=await state.supabase.from('audit_documents').upsert({id:d.id,owner_id:state.user.id,profile_key:d.user,document_type:d.type,document_date:d.date,title:d.title,amount:d.amount,notes:d.notes,statement_month:d.month||null,bank_name:d.bankName,account_last4:d.accountLast4,cp500_installment:d.cp500Installment||null,cp500_reference:d.cp500Reference,file_path:d.filePath,mime_type:d.mimeType,updated_at:d.updatedAt});if(error)throw error;}
      else{const r=state.receipts.find(x=>x.id===job.id);if(!r)continue;let paths=r.imagePaths||[],images=r.images?.length?r.images:(r.image?[r.image]:[]);if(images.some(x=>x.startsWith('data:'))){const uploaded=await uploadImages(r,images);paths=uploaded.paths;r.images=uploaded.urls;r.image=uploaded.urls[0]||'';r.imagePaths=paths;r.imagePath=paths[0]||'';}const {error}=await state.supabase.from('receipts').upsert({id:r.id,owner_id:state.user.id,profile_key:r.user,date:r.date,store:r.store,category:r.category,items:r.items,amount:r.amount,image_url:paths[0]||'',image_paths:paths,needs_review:r.needsReview,updated_at:r.updatedAt});if(error)throw error;}
      state.pending=state.pending.filter(x=>!(x.type===job.type&&x.id===job.id));persist();
    }
    setMode('cloud');if(!silent)toast('Semua data telah diselaraskan.');
  }catch(err){badge.className='sync-badge error';badge.innerHTML='<i class="fa-solid fa-triangle-exclamation"></i><span>Sync gagal</span>';if(!silent)toast(`Sync gagal: ${err.message}`,true);}
}

async function uploadImages(r,images){const paths=[],urls=[];for(let i=0;i<images.length;i++){if(!images[i].startsWith('data:')&&r.imagePaths?.[i]){paths.push(r.imagePaths[i]);urls.push(images[i]);continue;}const blob=dataUrlToBlob(images[i]),path=`${state.user.id}/${r.id}-${i+1}.jpg`;const {error}=await state.supabase.storage.from('receipts').upload(path,blob,{contentType:blob.type||'image/jpeg',upsert:true});if(error)throw error;const {data}=await state.supabase.storage.from('receipts').createSignedUrl(path,3600);paths.push(path);urls.push(data?.signedUrl||images[i]);}return{paths,urls};}

function dataUrlToBlob(dataUrl){
  const match=/^data:([^;,]+);base64,(.+)$/.exec(dataUrl||'');
  if(!match)throw new Error('Format gambar tempatan tidak sah. Ambil gambar semula.');
  const binary=atob(match[2]),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:match[1]||'image/jpeg'});
}
function queue(job){state.pending=state.pending.filter(x=>!(x.type===job.type&&x.id===job.id));state.pending.push(job);}

function renderProfile(){const p=state.profiles[state.activeProfile]||defaults[state.activeProfile];$('#profileName').value=p.name||'';$('#profileIC').value=p.ic||'';$('#profileTIN').value=p.tin||'';$('#profileRef').value=p.ref||'';}
async function saveProfile(e){e.preventDefault();const p={name:$('#profileName').value.trim(),ic:$('#profileIC').value.trim(),tin:$('#profileTIN').value.trim(),ref:$('#profileRef').value.trim()};state.profiles[state.activeProfile]=p;persist();if(state.cloud&&state.user){const {error}=await state.supabase.from('tax_profiles').upsert({owner_id:state.user.id,profile_key:state.activeProfile,name:p.name,ic:p.ic,tin:p.tin,reference:p.ref},{onConflict:'owner_id,profile_key'});if(error){toast(error.message,true);return;}}renderAll();toast('Profil berjaya disimpan.');}

function renderReport(){
  const p=state.profiles[state.activeProfile]||{},rows=yearReceipts(),total=rows.reduce((s,r)=>s+r.amount,0);$('#reportIdentity').innerHTML=`<strong>${esc(p.name||state.activeProfile)}</strong><br>No. KP / SSM: ${esc(p.ic)}<br>No. TIN: ${esc(p.tin)}<br>No. Rujukan: ${esc(p.ref)}<br>Tahun: ${state.year}`;
  $('#reportSummary').innerHTML=`<div><small>Jumlah resit</small><strong>${rows.length}</strong></div><div><small>Boleh tuntut / rekod bisnes</small><strong>${money(rows.filter(isClaim).reduce((s,r)=>s+r.amount,0))}</strong></div><div><small>Jumlah keseluruhan</small><strong>${money(total)}</strong></div>`;
  $('#reportRows').innerHTML=rows.length?rows.map(r=>`<tr><td>${formatDate(r.date)}</td><td><strong>${esc(r.store)}</strong><br>${esc(r.items)}</td><td>${esc(categoryMap(r.user)[r.category]?.label||r.category)}</td><td>${money(r.amount)}</td></tr>`).join(''):'<tr><td colspan="4">Tiada rekod.</td></tr>';
  renderEvidenceFilters();
}

function renderEvidenceFilters(){
  const month=$('#evidenceMonth').value||'ALL',category=$('#evidenceCategory').value||'ALL';
  const months=['Semua bulan','Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
  $('#evidenceMonth').innerHTML=months.map((m,i)=>`<option value="${i||'ALL'}">${m}</option>`).join('');
  $('#evidenceCategory').innerHTML='<option value="ALL">Semua kategori</option>'+Object.entries(categoryMap()).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#evidenceMonth').value=[...$('#evidenceMonth').options].some(o=>o.value===month)?month:'ALL';
  $('#evidenceCategory').value=[...$('#evidenceCategory').options].some(o=>o.value===category)?category:'ALL';
  updateEvidenceCount();
}

function evidenceReceipts(){
  const month=$('#evidenceMonth').value,category=$('#evidenceCategory').value;
  return yearReceipts().filter(r=>(month==='ALL'||new Date(`${r.date}T00:00:00`).getMonth()+1===Number(month))&&(category==='ALL'||r.category===category));
}

function updateEvidenceCount(){const rows=evidenceReceipts();$('#evidenceCount').textContent=`${rows.length} resit · ${rows.reduce((n,r)=>n+(r.images?.length||(r.image?1:0)),0)} gambar`;}

async function downloadEvidencePDF(){
  const rows=evidenceReceipts();if(!rows.length){toast('Tiada resit untuk pilihan ini.',true);return;}
  if(!window.jspdf?.jsPDF){toast('Modul PDF belum dimuatkan. Semak internet atau gunakan butang Print.',true);return;}
  const btn=$('#downloadEvidenceBtn');setButton(btn,true,'Menjana PDF…');
  try{
    const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
    for(let i=0;i<rows.length;i++){if(i)doc.addPage('a4','portrait');await drawEvidencePage(doc,rows[i],i+1,rows.length);}
    doc.save(`audit-evidence-${slug(state.activeProfile)}-${state.year}.pdf`);toast(`${rows.length} halaman PDF berjaya disediakan.`);
  }catch(error){console.error(error);toast(`PDF gagal: ${error.message}`,true);}finally{setButton(btn,false,'Download PDF');}
}

async function drawEvidencePage(doc,r,page,total){
  const green=[7,95,70],gold=[184,145,71],images=r.images?.length?r.images:(r.image?[r.image]:[]),category=categoryMap(r.user)[r.category]?.label||r.category;
  doc.setFillColor(...green);doc.rect(0,0,210,22,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('AUDIT EVIDENCE - RECEIPT',15,13.5);
  doc.setFontSize(8);doc.setFont('helvetica','normal');doc.text(`Page ${page} of ${total}`,195,13.5,{align:'right'});
  doc.setTextColor(22,48,39);doc.setFont('helvetica','bold');doc.setFontSize(12);doc.text(pdfSafe(r.store),15,33);
  doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(92,108,101);doc.text(`Profile: ${pdfSafe(state.profiles[r.user]?.name||r.user)}`,15,40);doc.text(`Date: ${formatDate(r.date)}`,15,46);doc.text(`Category: ${pdfSafe(category)}`,82,46);doc.text(`Amount: RM ${Number(r.amount).toFixed(2)}`,195,46,{align:'right'});
  doc.setDrawColor(...gold);doc.setLineWidth(.6);doc.line(15,51,195,51);
  const top=57,bottom=280,gap=5,available=bottom-top;
  if(!images.length){doc.setDrawColor(210,220,216);doc.roundedRect(15,top,180,available,3,3,'S');doc.setTextColor(120,132,127);doc.text('No receipt image available',105,top+available/2,{align:'center'});}
  else{
    const slot=(available-gap*(images.length-1))/images.length;
    for(let j=0;j<images.length;j++){const data=await imageAsDataURL(images[j]);const size=await imageDimensions(data);const fitted=fitInside(size.width,size.height,180,slot);const x=15+(180-fitted.w)/2,y=top+j*(slot+gap)+(slot-fitted.h)/2,format=data.startsWith('data:image/png')?'PNG':'JPEG';doc.setDrawColor(222,231,227);doc.roundedRect(15,top+j*(slot+gap),180,slot,2,2,'S');doc.addImage(data,format,x,y,fitted.w,fitted.h,`receipt-${r.id}-${j}`,'FAST');}
  }
  doc.setFontSize(7);doc.setTextColor(120,132,127);doc.text(`Generated by MyTax & Biz Audit Hub · ${new Date().toLocaleDateString('ms-MY')}`,15,290);doc.text(`Receipt ID: ${pdfSafe(r.id)}`,195,290,{align:'right'});
}

async function printEvidenceBundle(){
  const rows=evidenceReceipts();if(!rows.length){toast('Tiada resit untuk pilihan ini.',true);return;}
  const win=window.open('','_blank');if(!win){toast('Popup disekat. Benarkan popup untuk mencetak.',true);return;}
  const pages=rows.map((r,i)=>{const images=r.images?.length?r.images:(r.image?[r.image]:[]),cat=categoryMap(r.user)[r.category]?.label||r.category;return`<section class="sheet"><header><div><small>AUDIT EVIDENCE</small><h1>${esc(r.store)}</h1></div><b>${i+1} / ${rows.length}</b></header><div class="meta"><span><b>Tarikh</b>${formatDate(r.date)}</span><span><b>Kategori</b>${esc(cat)}</span><span><b>Jumlah</b>${money(r.amount)}</span><span><b>Profil</b>${esc(state.profiles[r.user]?.name||r.user)}</span></div><main>${images.length?images.map(src=>`<img src="${safeImage(src)}">`).join(''):'<p>Tiada gambar resit</p>'}</main><footer>Receipt ID: ${esc(r.id)} · MyTax & Biz Audit Hub</footer></section>`}).join('');
  win.document.write(`<!doctype html><html><head><title>Audit Evidence ${state.year}</title><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#17382e;background:#ddd}.sheet{width:210mm;height:297mm;padding:14mm 15mm 10mm;background:#fff;page-break-after:always;display:flex;flex-direction:column}.sheet:last-child{page-break-after:auto}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #075f46;padding-bottom:5mm}header small{color:#087253;font-weight:bold;letter-spacing:1.5px}h1{font-size:18px;margin:2mm 0 0}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;padding:5mm 0}.meta span{font-size:10px;background:#f4f8f6;padding:3mm;border-radius:2mm}.meta b{display:block;font-size:8px;text-transform:uppercase;color:#68776f;margin-bottom:1mm}main{flex:1;min-height:0;border:1px solid #dde8e3;border-radius:3mm;padding:4mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3mm;overflow:hidden}main img{max-width:100%;max-height:100%;min-height:0;object-fit:contain;flex:1}main p{color:#888}footer{padding-top:4mm;font-size:8px;color:#7b8983}@media print{body{background:#fff}} </style></head><body>${pages}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`);win.document.close();
}

async function imageAsDataURL(src){if(src.startsWith('data:'))return src;const res=await fetch(src);if(!res.ok)throw new Error(`Gambar resit gagal dimuatkan (${res.status})`);return blobToDataURL(await res.blob());}
function blobToDataURL(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});}
function imageDimensions(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(new Error('Format gambar tidak dapat dibaca.'));img.src=src;});}
function fitInside(width,height,maxW,maxH){const scale=Math.min(maxW/width,maxH/height);return{w:width*scale,h:height*scale};}
function pdfSafe(value){return String(value??'').replace(/[^\x20-\x7E]/g,'-').slice(0,100);}

function exportCSV(){const rows=yearReceipts(),csv=[['Tarikh','Profil','Premis','Kategori','Butiran','Jumlah (RM)','Perlu Semak'],...rows.map(r=>[r.date,r.user,r.store,r.category,r.items,r.amount.toFixed(2),r.needsReview?'Ya':'Tidak'])].map(row=>row.map(csvCell).join(',')).join('\n');download(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),`resit-${slug(state.activeProfile)}-${state.year}.csv`);toast('Fail CSV telah disediakan.');}
function backupJSON(){download(new Blob([JSON.stringify({version:3,exportedAt:new Date().toISOString(),profiles:state.profiles,receipts:state.receipts,documents:state.documents},null,2)],{type:'application/json'}),`mytax-backup-${new Date().toISOString().slice(0,10)}.json`);}
async function restoreJSON(e){try{const data=JSON.parse(await e.target.files[0].text());if(!Array.isArray(data.receipts)||!data.profiles)throw new Error('Format backup tidak sah');if(!confirm(`Restore ${data.receipts.length} resit dan ${(data.documents||[]).length} dokumen? Data semasa akan digantikan.`))return;state.receipts=data.receipts;state.documents=data.documents||[];state.profiles=data.profiles;state.receipts.forEach(r=>queue({type:'upsert',id:r.id}));state.documents.forEach(d=>queue({type:'document-upsert',id:d.id}));persist();renderAll();toast('Backup berjaya dipulihkan.');if(navigator.onLine)syncNow(true);}catch(err){toast(err.message,true);}finally{e.target.value='';}}

function toggleTheme(){document.documentElement.classList.remove('dark');localStorage.setItem(STORAGE.theme,'light');}
function applyTheme(){document.documentElement.classList.remove('dark');localStorage.setItem(STORAGE.theme,'light');$('#themeBtn i').className='fa-solid fa-sun';}
function updateOnlineState(){$('#offlineBar').classList.toggle('hidden',navigator.onLine);}

function registerPWA(){
  if(!('serviceWorker'in navigator))return;
  const build=window.MYTAX_BUILD||'current',workerUrl=`/service-worker.js?build=${encodeURIComponent(build)}`;
  navigator.serviceWorker.register(workerUrl,{updateViaCache:'none'}).then(registration=>{
    registration.update().catch(()=>{});
    const activate=worker=>{if(worker?.state==='installed'&&navigator.serviceWorker.controller)worker.postMessage('SKIP_WAITING');};
    activate(registration.waiting);registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>activate(worker));});
  }).catch(console.warn);
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    const key=`mytax-reloaded-${build}`;
    if(sessionStorage.getItem(key))return;
    sessionStorage.setItem(key,'1');
    location.replace(`${location.pathname}?v=${encodeURIComponent(build)}`);
  });
}
async function installPWA(){if(!state.installPrompt){toast('Gunakan menu browser dan pilih “Add to Home Screen”.');return;}state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;hide('#installBtn');}

function compressImage(file,max=1600,quality=.78){return new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{let{width,height}=img;if(Math.max(width,height)>max){const s=max/Math.max(width,height);width=Math.round(width*s);height=Math.round(height*s);}const c=document.createElement('canvas');c.width=width;c.height=height;c.getContext('2d').drawImage(img,0,0,width,height);URL.revokeObjectURL(url);resolve(c.toDataURL('image/jpeg',quality));};img.onerror=reject;img.src=url;});}
function scanReceiptImage(file){return new Promise((resolve,reject)=>{const image=new Image(),url=URL.createObjectURL(file);image.onload=()=>{try{let{width,height}=image;if(Math.max(width,height)>2200){const scale=2200/Math.max(width,height);width=Math.round(width*scale);height=Math.round(height*scale);}const source=document.createElement('canvas'),ctx=source.getContext('2d',{willReadFrequently:true});source.width=width;source.height=height;ctx.drawImage(image,0,0,width,height);URL.revokeObjectURL(url);const pixels=ctx.getImageData(0,0,width,height),data=pixels.data;const sample=(x,y)=>{const p=(y*width+x)*4;return[data[p],data[p+1],data[p+2]]};const corners=[sample(3,3),sample(width-4,3),sample(3,height-4),sample(width-4,height-4)];const background=[0,1,2].map(channel=>corners.reduce((sum,c)=>sum+c[channel],0)/corners.length);let minX=width,minY=height,maxX=0,maxY=0,foreground=0;for(let y=0;y<height;y++){for(let x=0;x<width;x++){const p=(y*width+x)*4,r=data[p],g=data[p+1],b=data[p+2],distance=Math.hypot(r-background[0],g-background[1],b-background[2]);if(distance>52){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);foreground++;}}}const cropLooksUseful=foreground>width*height*.04&&(maxX-minX)>width*.45&&(maxY-minY)>height*.45;if(cropLooksUseful){const padding=Math.round(Math.min(width,height)*.025),x=Math.max(0,minX-padding),y=Math.max(0,minY-padding),w=Math.min(width-x,maxX-minX+padding*2),h=Math.min(height-y,maxY-minY+padding*2),cropped=ctx.getImageData(x,y,w,h);source.width=w;source.height=h;ctx.putImageData(cropped,0,0);width=w;height=h;}const out=ctx.getImageData(0,0,width,height),output=out.data;for(let i=0;i<output.length;i+=4){const r=output[i],g=output[i+1],b=output[i+2],distance=Math.hypot(r-background[0],g-background[1],b-background[2]),lum=(r*.299+g*.587+b*.114);let value;if(distance<48)value=255;else value=Math.max(0,Math.min(255,(lum-110)*1.7+110));if(value>225)value=255;output[i]=output[i+1]=output[i+2]=value;output[i+3]=255;}ctx.putImageData(out,0,0);resolve(source.toDataURL('image/jpeg',.92));}catch(error){reject(error);}};image.onerror=reject;image.src=url;});}
function persist(){localStorage.setItem(STORAGE.receipts,JSON.stringify(state.receipts));localStorage.setItem(STORAGE.documents,JSON.stringify(state.documents));localStorage.setItem(STORAGE.profiles,JSON.stringify(state.profiles));localStorage.setItem(STORAGE.pending,JSON.stringify(state.pending));}
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
