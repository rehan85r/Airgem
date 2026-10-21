(async()=>{
'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let projects=[],selected=null,busy=false,trending=[],savedTrending=[];
const current=()=>projects.find(p=>String(p.id)===String(selected));
const msg=t=>{$('message').textContent=t};
function list(){const q=$('search').value.toLowerCase();$('count').textContent=projects.length+' Projects';$('list').innerHTML=projects.filter(p=>p.name?.toLowerCase().includes(q)).map(p=>`<button type="button" class="entry ${String(p.id)===String(selected)?'active':''}" data-id="${esc(p.id)}"><b>${esc(p.name)}</b><br><small>${esc(p.task)} · ${esc(p.status)}</small></button>`).join('');$('list').querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=b.dataset.id;list();load()})}
function logoPreview(){const root=$('logoPreview');root.replaceChildren();const url=$('logoUrl').value.trim();if(url){const img=document.createElement('img');img.src=url;img.alt='Project logo';img.style.cssText='width:100%;height:100%;object-fit:contain';img.onerror=()=>root.textContent='?';root.append(img)}else root.textContent='?'}
function linksLoad(p){$('links').innerHTML='';for(const type of ['Website','Discord','X']){const found=(p.links||[]).find(l=>{const k=String(l.label||'').toLowerCase();return type==='Website'?['website','official website','official link'].includes(k):type==='Discord'?k.includes('discord'):k==='x'||k==='twitter'});const el=document.createElement('div');el.className='item';el.innerHTML=`<div class="field"><label>${type} URL</label><input class="link-url" data-type="${type}" placeholder="https://..." value="${esc(found?.url||'')}"></div>`;$('links').append(el)}}
function cleanGuideHTML(html){
 const doc=new DOMParser().parseFromString(String(html),'text/html');
 const allowed=new Set(['P','DIV','BR','H2','H3','H4','STRONG','B','EM','I','U','A','IMG','UL','OL','LI','BLOCKQUOTE','SPAN']);
 const classes=new Set(['guide-step-box','dh-custom-title','dh-custom-body','dh-daily-box','dh-note-box','dh-info-box']);
 function safeURL(value){try{const u=new URL(value);return u.protocol==='https:'||u.protocol==='http:'?u.href:null}catch{return null}}
 function walk(parent){for(const node of [...parent.childNodes]){
  if(node.nodeType===8){node.remove();continue}
  if(node.nodeType!==1)continue;
  if(!allowed.has(node.tagName)){const fragment=doc.createDocumentFragment();while(node.firstChild)fragment.appendChild(node.firstChild);node.replaceWith(fragment);walk(parent);continue}
  const classNames=[...node.classList].filter(c=>classes.has(c));
  const href=node.getAttribute('href'),src=node.getAttribute('src'),alt=node.getAttribute('alt');
  const align=node.style.textAlign,whiteSpace=node.style.whiteSpace;
  for(const attr of [...node.attributes])node.removeAttribute(attr.name);
  if(classNames.length)node.className=classNames.join(' ');
  if(['left','center','right'].includes(align))node.style.textAlign=align;
  if(whiteSpace==='pre-wrap')node.style.whiteSpace='pre-wrap';
  if(node.tagName==='A'&&safeURL(href)){node.href=safeURL(href);node.rel='noopener noreferrer';node.target='_blank'}
  if(node.tagName==='IMG'){const url=safeURL(src);if(!url){node.remove();continue}node.src=url;node.alt=alt||'Guide image';node.loading='lazy'}
  walk(node);
 }}walk(doc.body);return doc.body.innerHTML;
}
let taskDrafts=[],taskSelected=0;
function saveTaskDraft(){const t=taskDrafts[taskSelected];if(!t)return;t.title=$('agTaskTitle').value;t.status=$('agTaskStatus').value;t.subtitle=$('agTaskDate').value.trim();delete t.availableFrom;t.tag=$('agTaskTag').value;t.html=$('guideEditor').innerHTML}
function showTaskDraft(){const t=taskDrafts[taskSelected];if(!t)return;$('agTaskTabs').innerHTML='';taskDrafts.forEach((x,i)=>{const b=document.createElement('button');b.type='button';b.textContent=x.title||'Task '+(i+1);b.className=i===taskSelected?'active':'';b.onclick=()=>{saveTaskDraft();taskSelected=i;showTaskDraft()};$('agTaskTabs').append(b)});$('agTaskTitle').value=t.title||'';$('agTaskStatus').value=({Open:'Active','Coming Soon':'Upcoming'}[t.status]||t.status||'Active');$('agTaskDate').value=t.subtitle??(t.availableFrom?'Available from '+t.availableFrom:'');$('agTaskTag').value=t.tag||'';$('guideEditor').innerHTML=cleanGuideHTML(t.html||'');$('agTaskRemove').disabled=taskDrafts.length===1;updateStepSelection()}
$('agTaskAdd').onclick=()=>{saveTaskDraft();taskDrafts.push({title:'Task '+(taskDrafts.length+1),status:'Active',html:''});taskSelected=taskDrafts.length-1;showTaskDraft()};
$('agTaskRemove').onclick=()=>{if(taskDrafts.length<2)return;taskDrafts.splice(taskSelected,1);taskSelected=Math.min(taskSelected,taskDrafts.length-1);showTaskDraft()};
function load(){const p=current();$('form').hidden=!p;$('remove').disabled=!p;if(!p){$('title').textContent='No projects';return}$('title').textContent='Edit '+p.name;for(const key of ['name','task','status','funding','cost','time','addedOn','started','tge','ecosystem','color','logoUrl']){const el=$(key);if(el)el.value=p[key]??(key==='color'?'#1E90FF':'')}$('displayTag').value=p.displayTag||p.display_tag||'';linksLoad(p);const guide=(Array.isArray(p.guide)&&p.guide.length===1&&typeof p.guide[0]?.html==='string'?p.guide[0].html:null)??p.guideHtml??p.guide_html??p.descriptionHtml??p.description_html??(typeof p.description==='string'?p.description:'');taskDrafts=Array.isArray(p.guide)&&p.guide.length?p.guide.map((t,i)=>({...t,title:t.title||'Task '+(i+1),html:t.html||''})):[{title:'Full Airdrop Guide',status:'Active',html:guide||''}];taskSelected=0;showTaskDraft();logoPreview();updateStepSelection()}
function collect(){const p=current();if(!p)throw Error('Select a project');const row={...p};for(const key of ['name','task','status','funding','cost','time','addedOn','started','tge','ecosystem','color','logoUrl'])row[key]=$(key).value.trim();if(!row.name)throw Error('Project name required');row.displayTag=$('displayTag').value.trim();row.links=[...$('links').querySelectorAll('.link-url')].filter(x=>x.value.trim()).map(x=>{const url=x.value.trim();if(!/^https?:\/\//i.test(url))throw Error('Invalid '+x.dataset.type+' URL');return {label:x.dataset.type,url}});const copy=$('guideEditor').cloneNode(true);copy.querySelectorAll('.step-box-remove').forEach(el=>el.remove());copy.querySelectorAll('.selected-step-box').forEach(el=>el.classList.remove('selected-step-box'));saveTaskDraft();row.guide=taskDrafts.map(t=>({...t,html:cleanGuideHTML(t.html||'')}));return row}
async function refresh(preferred=selected){projects=await dropyFetchProjects();selected=projects.find(p=>String(p.id)===String(preferred))?.id??projects[0]?.id??null;list();load();trendingUI()}
async function uploadLogo(file){if(!file.type.startsWith('image/'))throw Error('Select an image');if(file.size>5*1024*1024)throw Error('Logo maximum 5MB');const img=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=canvas.height=256;const scale=Math.min(256/img.width,256/img.height);canvas.getContext('2d').drawImage(img,(256-img.width*scale)/2,(256-img.height*scale)/2,img.width*scale,img.height*scale);img.close?.();const blob=await new Promise(r=>canvas.toBlob(r,'image/webp',.85));if(!blob)throw Error('Logo conversion failed');const path=crypto.randomUUID()+'.webp';const {error}=await dropyClient.storage.from('project-logos').upload(path,blob,{contentType:'image/webp'});if(error)throw error;return dropyClient.storage.from('project-logos').getPublicUrl(path).data.publicUrl}
function trendingSearchUI(){const input=$('trendingSelect'),results=$('trendingSearchResults');if(!input||!results)return;const query=input.value.trim().toLocaleLowerCase();const matches=query?projects.filter(p=>!trending.some(id=>String(id)===String(p.id))&&String(p.name||'').toLocaleLowerCase().includes(query)).slice(0,20):[];results.hidden=!query;input.setAttribute('aria-expanded',String(!!query));results.innerHTML=query?(matches.length?matches.map(p=>`<button type="button" data-project-id="${esc(p.id)}">${esc(p.name)}</button>`).join(''):'<div class="trending-empty">No matching projects found.</div>'):'';results.querySelectorAll('[data-project-id]').forEach(button=>button.onclick=()=>{if(trending.length>=10){$('trendingMessage').textContent='Maximum 10 top projects allowed.';return}const id=button.dataset.projectId;if(trending.some(item=>String(item)===id))return;trending.push(id);input.value='';results.hidden=true;input.setAttribute('aria-expanded','false');trendingUI();$('trendingMessage').textContent='Project added. Click Save Top to publish.'})}
$('trendingSelect').addEventListener('input',trendingSearchUI);
function trendingUI(){trendingSearchUI();$('trendingState').textContent=trending.length+' / 10 Selected';const disclosureLabel=$('trendingDisclosureLabel');if(disclosureLabel)disclosureLabel.textContent='Selected Projects ('+trending.length+'/10)';$('trendingCurrent').innerHTML=trending.length?trending.map((id,i)=>{const p=projects.find(p=>String(p.id)===String(id));return `<div class="item" style="display:flex;align-items:center;justify-content:space-between;gap:8px"><strong>${i+1}. ${esc(p?.name||'Deleted project')}</strong><div class="actions"><button type="button" class="btn light" data-move="${i}" data-dir="-1" ${i===0?'disabled':''} aria-label="Move up">↑</button><button type="button" class="btn light" data-move="${i}" data-dir="1" ${i===trending.length-1?'disabled':''} aria-label="Move down">↓</button><button type="button" class="btn danger" data-remove="${i}">✕</button></div></div>`}).join(''):'<div class="notice">No trending projects selected.</div>';$('trendingCurrent').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{trending.splice(+b.dataset.remove,1);trendingUI()});$('trendingCurrent').querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{const i=+b.dataset.move,j=i+(+b.dataset.dir);[trending[i],trending[j]]=[trending[j],trending[i]];trendingUI()})}
async function loadTrending(){const {data,error}=await dropyClient.from('site_trending_items').select('project_id,position').order('position',{ascending:true});if(error){$('trendingMessage').textContent='Run the supplied Supabase SQL first: '+error.message;return}trending=(data||[]).map(r=>r.project_id);savedTrending=[...trending];trendingUI()}
$('clearTrending').onclick=()=>{trending=[];trendingUI();$('trendingMessage').textContent='Click Save Top to remove all.'};
$('saveTrending').onclick=async()=>{const button=$('saveTrending');button.disabled=true;try{const {error:delErr}=await dropyClient.from('site_trending_items').delete().gte('position',1);if(delErr)throw delErr;if(trending.length){const {error}=await dropyClient.from('site_trending_items').insert(trending.map((id,i)=>({position:i+1,project_id:id})));if(error)throw error}savedTrending=[...trending];$('trendingMessage').textContent='Trending saved! Refresh homepage to see the slider.'}catch(e){$('trendingMessage').textContent='Error: '+e.message+' (If interrupted, press Save Trending again.)'}finally{button.disabled=false}};
// CAPTCHA stays inactive until a real Cloudflare Turnstile site key is configured.
// Do not enable Supabase Auth CAPTCHA before this frontend is configured and tested.
let turnstileWidgetId=null,turnstileToken='';
const turnstileSiteKey=String(window.AIRGEM_TURNSTILE_SITE_KEY||'').trim();
if(turnstileSiteKey){
 $('turnstileContainer').hidden=false;
 const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;
 script.onload=()=>{turnstileWidgetId=window.turnstile.render('#airgemTurnstile',{sitekey:turnstileSiteKey,callback:token=>{turnstileToken=token},'expired-callback':()=>{turnstileToken=''},'error-callback':()=>{turnstileToken=''}})};
 script.onerror=()=>{$('loginError').textContent='Security check could not load. Please reload the page.'};
 document.head.append(script);
}
$('loginForm').onsubmit=async e=>{e.preventDefault();if(turnstileSiteKey&&!turnstileToken){$('loginError').textContent='Complete The Security Check First.';return}$('loginError').textContent='Signing in...';try{const options={email:$('email').value.trim(),password:$('password').value};if(turnstileSiteKey)options.options={captchaToken:turnstileToken};const {error}=await dropyClient.auth.signInWithPassword(options);if(error)throw error;await initialize()}catch(err){$('loginError').textContent=err.message}finally{if(turnstileSiteKey&&turnstileWidgetId!==null){turnstileToken='';window.turnstile?.reset(turnstileWidgetId)}}};
$('logout').onclick=async()=>{await dropyClient.auth.signOut();window.location.replace('/admin')};
$('form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;try{const row=collect();msg('Publishing changes...');const payload=dropyToRow(row);const {error}=await dropyClient.from('projects').update(payload).eq('id',row.id).select('id').single();if(error)throw error;await refresh(row.id);msg('Published to live database!')}catch(err){msg('Error: '+err.message)}finally{busy=false}};
$('add').onclick=async()=>{if(busy)return;busy=true;try{const {data,error}=await dropyClient.from('projects').insert({name:'New Project',task:'Testnet',category:'Airdrop',status:'Potential'}).select('id').single();if(error)throw error;$('search').value='';await refresh(data.id);$('name').focus();msg('New project created. Edit and publish.')}catch(err){msg('Error: '+err.message)}finally{busy=false}};
$('remove').onclick=async()=>{const p=current();if(!p||busy||!confirm('Delete '+p.name+' permanently?'))return;busy=true;try{const {error}=await dropyClient.from('projects').delete().eq('id',p.id);if(error)throw error;selected=null;await refresh(null);msg('Project deleted')}catch(err){msg('Error: '+err.message)}finally{busy=false}};
$('search').oninput=list;$('logoUrl').oninput=logoPreview;$('logoFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{msg('Uploading logo...');$('logoUrl').value=await uploadLogo(file);logoPreview();msg('Logo uploaded. Publish to save.')}catch(err){msg('Error: '+err.message)}};$('clearLogo').onclick=()=>{$('logoUrl').value='';logoPreview()};
const editor=$('guideEditor');let selectedBox=null;function updateStepSelection(){if(selectedBox&&!editor.contains(selectedBox))selectedBox=null;if($('guideDeleteStepBox'))$('guideDeleteStepBox').disabled=!selectedBox;if($('guideEditStepBox'))$('guideEditStepBox').disabled=!selectedBox}
editor.addEventListener('click',e=>{if(e.target.closest('.guide-step-box a'))e.preventDefault();if(e.target.closest('.step-box-remove')){e.target.closest('.guide-step-box')?.remove();selectedBox=null;updateStepSelection();return}editor.querySelectorAll('.selected-step-box').forEach(x=>x.classList.remove('selected-step-box'));selectedBox=e.target.closest('.guide-step-box');if(selectedBox)selectedBox.classList.add('selected-step-box');updateStepSelection()});
function makeStepBox(text,url){
 const box=document.createElement('div');box.className='guide-step-box';
 const label=document.createElement('strong');label.textContent=text||'Join Now';
 if(url){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.append(label);box.append(link)}else box.append(label);
 const remove=document.createElement('button');remove.type='button';remove.className='step-box-remove';remove.textContent='×';remove.setAttribute('contenteditable','false');box.append(remove);return box;
}
$('guideStepBox').onclick=()=>{
 const text=prompt('Step button text:','Join Now');if(text===null)return;
 const url=prompt('Button link (https://... or leave empty):','');if(url===null)return;
 if(url.trim()&&!/^https?:\/\//i.test(url.trim())){msg('Please enter a valid https:// link');return}
 const box=makeStepBox(text.trim(),url.trim());editor.append(box);editor.append(document.createElement('p'));
 editor.querySelectorAll('.selected-step-box').forEach(x=>x.classList.remove('selected-step-box'));
 selectedBox=box;box.classList.add('selected-step-box');updateStepSelection();
};
if($('guideEditStepBox'))$('guideEditStepBox').onclick=()=>{
 if(!selectedBox)return;
 const label=selectedBox.querySelector('strong');const existing=selectedBox.querySelector('a[href]');
 const text=prompt('Edit step button text:',label?.textContent||selectedBox.textContent.replace('×','').trim());if(text===null)return;
 const url=prompt('Edit button link (leave empty for no link):',existing?.getAttribute('href')||'');if(url===null)return;
 if(url.trim()&&!/^https?:\/\//i.test(url.trim())){msg('Please enter a valid https:// link');return}
 const replacement=makeStepBox(text.trim(),url.trim());replacement.classList.add('selected-step-box');selectedBox.replaceWith(replacement);selectedBox=replacement;updateStepSelection();
};
if($('guideDeleteStepBox'))$('guideDeleteStepBox').onclick=()=>{selectedBox?.remove();selectedBox=null;updateStepSelection()};
function insertGuideInfo(type){
 const isUpdate=type==='daily';
 const title=isUpdate?prompt('Update Box title:', 'Daily Task Update'):null;
 if(isUpdate&&title===null)return;
 const bodyText=prompt(isUpdate?'Update Box text (you can edit it later):':'Important Note text:',isUpdate?'Write your update here...':'Write your important note here...');
 if(bodyText===null)return;
 const box=document.createElement('div');box.className='dh-info-box '+(isUpdate?'dh-daily-box':'dh-note-box');
 if(isUpdate){
  const heading=document.createElement('div');heading.className='dh-custom-title';heading.textContent=title.trim()||'Daily Task Update';
  const body=document.createElement('div');body.className='dh-custom-body';body.style.whiteSpace='pre-wrap';body.textContent=bodyText;
  box.append(heading,body);
 }else box.textContent=bodyText;
 editor.append(box,document.createElement('p'));
 msg('Box added. Title and text can also be edited directly. Publish Changes to save.');
}
if($('guideDaily'))$('guideDaily').onclick=()=>insertGuideInfo('daily');
$('guideNote').onclick=()=>insertGuideInfo('note');

$('guideToolbar').querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>{editor.focus();document.execCommand(b.dataset.cmd,false,b.dataset.val||null)});
$('guideLink').onclick=()=>{const url=prompt('Enter https:// link:');if(url&&/^https?:\/\//i.test(url)){editor.focus();document.execCommand('createLink',false,url)}};
$('guideImage').onclick=()=>{const url=prompt('Image URL (https://):');if(url&&/^https?:\/\//i.test(url)){editor.focus();document.execCommand('insertImage',false,url)}};
$('guideClear').addEventListener('click',e=>{
 e.preventDefault();e.stopPropagation();
 editor.replaceChildren();selectedBox=null;updateStepSelection();
 editor.dispatchEvent(new Event('input',{bubbles:true}));
 msg('Entire guide cleared. Click Publish Changes to save the empty guide.');
 editor.focus();
});
let pendingMfa=null;
function mfaView(show){$('mfaBox').hidden=!show;$('dashboard').hidden=true;$('loginBox').hidden=true;$('logout').hidden=false}
function mfaMessage(message){$('mfaError').textContent=message}
async function startMfaSetup(){
 try{
  mfaMessage('Preparing authenticator setup...');
  const {data,error}=await dropyClient.auth.mfa.enroll({factorType:'totp',friendlyName:'Airgem Admin'});
  if(error)throw error;
  pendingMfa={id:data.id,mode:'enroll'};
  $('mfaHeading').textContent='Set Up Authenticator';
  $('mfaInstructions').textContent='Scan This QR Code In Google Authenticator Or Another TOTP App. Then Enter The 6-Digit Code.';
  $('mfaQr').src=data.totp.qr_code;$('mfaQr').hidden=false;
  $('mfaSecret').textContent='Manual Setup Key: '+data.totp.secret;
  $('mfaCancel').textContent='Cancel Setup';
  $('mfaCode').value='';mfaView(true);mfaMessage('');
 }catch(e){mfaMessage('Unable to start MFA setup: '+e.message);mfaView(true)}
}
$('mfaSetup').onclick=startMfaSetup;
$('mfaCancel').onclick=async()=>{
 if(pendingMfa?.mode==='enroll'){try{await dropyClient.auth.mfa.unenroll({factorId:pendingMfa.id})}catch{}pendingMfa=null;await initialize()}
 else{await dropyClient.auth.signOut();window.location.replace('/admin')}
};
$('mfaForm').onsubmit=async e=>{
 e.preventDefault();const code=$('mfaCode').value.trim();
 if(!/^[0-9]{6}$/.test(code)){mfaMessage('Enter a valid 6-digit code.');return}
 const button=$('mfaForm').querySelector('button');button.disabled=true;mfaMessage('Verifying...');
 try{
  if(!pendingMfa?.id)throw Error('MFA session expired. Please sign in again.');
  const {data:challenge,error:challengeError}=await dropyClient.auth.mfa.challenge({factorId:pendingMfa.id});
  if(challengeError)throw challengeError;
  const {error}=await dropyClient.auth.mfa.verify({factorId:pendingMfa.id,challengeId:challenge.id,code});
  if(error)throw error;
  pendingMfa=null;$('mfaQr').hidden=true;$('mfaSecret').textContent='';$('mfaCode').value='';
  await initialize();
 }catch(err){mfaMessage(err.message)}finally{button.disabled=false}
};
async function initialize(){const {data:{user}}=await dropyClient.auth.getUser();if(!user){$('loginBox').hidden=false;$('dashboard').hidden=true;return}const {data,error}=await dropyClient.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle();if(error||!data){$('loginBox').hidden=false;$('dashboard').hidden=true;$('mfaBox').hidden=true;$('logout').hidden=false;$('loginError').textContent=error?.message||'Not authorized as admin';return}
 const {data:factorData,error:factorError}=await dropyClient.auth.mfa.listFactors();
 if(factorError){$('loginError').textContent='MFA check failed: '+factorError.message;$('loginBox').hidden=false;$('dashboard').hidden=true;return}
 const verified=factorData.totp?.filter(f=>f.status==='verified')||[];
 const {data:assurance,error:aalError}=await dropyClient.auth.mfa.getAuthenticatorAssuranceLevel();
 if(aalError){$('loginError').textContent='MFA assurance check failed: '+aalError.message;$('loginBox').hidden=false;$('dashboard').hidden=true;return}
 if(verified.length&&assurance.currentLevel!=='aal2'){
  pendingMfa={id:verified[0].id,mode:'verify'};
  $('mfaHeading').textContent='Verify Your Identity';$('mfaInstructions').textContent='Enter The 6-Digit Code From Your Authenticator App.';
  $('mfaQr').hidden=true;$('mfaSecret').textContent='';$('mfaCancel').textContent='Log Out';$('mfaCode').value='';mfaMessage('');mfaView(true);return;
 }
 $('mfaBox').hidden=true;$('loginBox').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;$('mfaSetup').hidden=verified.length>0;try{await refresh();await loadTrending()}catch(e){msg('Error: '+e.message)}}await initialize();
})();
