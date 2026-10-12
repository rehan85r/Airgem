(async()=>{
'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let projects=[],selected=null,busy=false,trending=[],savedTrending=[];
const current=()=>projects.find(p=>String(p.id)===String(selected));
const msg=t=>{$('message').textContent=t};
function list(){const q=$('search').value.toLowerCase();$('count').textContent=projects.length+' projects';$('list').innerHTML=projects.filter(p=>p.name?.toLowerCase().includes(q)).map(p=>`<button type="button" class="entry ${String(p.id)===String(selected)?'active':''}" data-id="${esc(p.id)}"><b>${esc(p.name)}</b><br><small>${esc(p.task)} · ${esc(p.status)}</small></button>`).join('');$('list').querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=b.dataset.id;list();load()})}
function logoPreview(){const root=$('logoPreview');root.replaceChildren();const url=$('logoUrl').value.trim();if(url){const img=document.createElement('img');img.src=url;img.alt='Project logo';img.style.cssText='width:100%;height:100%;object-fit:contain';img.onerror=()=>root.textContent='?';root.append(img)}else root.textContent='?'}
function linksLoad(p){$('links').innerHTML='';for(const type of ['Website','Discord','X']){const found=(p.links||[]).find(l=>{const k=String(l.label||'').toLowerCase();return type==='Website'?['website','official website','official link'].includes(k):type==='Discord'?k.includes('discord'):k==='x'||k==='twitter'});const el=document.createElement('div');el.className='item';el.innerHTML=`<div class="field"><label>${type} URL</label><input class="link-url" data-type="${type}" placeholder="https://..." value="${esc(found?.url||'')}"></div>`;$('links').append(el)}}
function load(){const p=current();$('form').hidden=!p;$('remove').disabled=!p;if(!p){$('title').textContent='No projects';return}$('title').textContent='Edit '+p.name;for(const key of ['name','task','status','funding','cost','time','addedOn','color','logoUrl']){const el=$(key);if(el)el.value=p[key]??(key==='color'?'#1E90FF':'')}$('displayTag').value=p.displayTag||p.display_tag||'';linksLoad(p);const guide=(Array.isArray(p.guide)&&p.guide.length===1&&typeof p.guide[0]?.html==='string'?p.guide[0].html:null)??p.guideHtml??p.guide_html??p.descriptionHtml??p.description_html??(typeof p.description==='string'?p.description:'');$('guideEditor').innerHTML=guide||'';logoPreview();updateStepSelection()}
function collect(){const p=current();if(!p)throw Error('Select a project');const row={...p};for(const key of ['name','task','status','funding','cost','time','addedOn','color','logoUrl'])row[key]=$(key).value.trim();if(!row.name)throw Error('Project name required');row.displayTag=$('displayTag').value.trim();row.links=[...$('links').querySelectorAll('.link-url')].filter(x=>x.value.trim()).map(x=>{const url=x.value.trim();if(!/^https?:\/\//i.test(url))throw Error('Invalid '+x.dataset.type+' URL');return {label:x.dataset.type,url}});const copy=$('guideEditor').cloneNode(true);copy.querySelectorAll('.step-box-remove').forEach(el=>el.remove());copy.querySelectorAll('.selected-step-box').forEach(el=>el.classList.remove('selected-step-box'));const html=copy.innerHTML.trim();row.guide=[{html}];return row}
async function refresh(preferred=selected){projects=await dropyFetchProjects();selected=projects.find(p=>String(p.id)===String(preferred))?.id??projects[0]?.id??null;list();load();trendingUI()}
async function uploadLogo(file){if(!file.type.startsWith('image/'))throw Error('Select an image');if(file.size>5*1024*1024)throw Error('Logo maximum 5MB');const img=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=canvas.height=256;const scale=Math.min(256/img.width,256/img.height);canvas.getContext('2d').drawImage(img,(256-img.width*scale)/2,(256-img.height*scale)/2,img.width*scale,img.height*scale);img.close?.();const blob=await new Promise(r=>canvas.toBlob(r,'image/webp',.85));if(!blob)throw Error('Logo conversion failed');const path=crypto.randomUUID()+'.webp';const {error}=await dropyClient.storage.from('project-logos').upload(path,blob,{contentType:'image/webp'});if(error)throw error;return dropyClient.storage.from('project-logos').getPublicUrl(path).data.publicUrl}
function trendingUI(){const select=$('trendingSelect');select.innerHTML='<option value="">Select a project...</option>'+projects.filter(p=>!trending.some(id=>String(id)===String(p.id))).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');$('trendingState').textContent=trending.length+' / 5 selected';$('trendingCurrent').innerHTML=trending.length?trending.map((id,i)=>{const p=projects.find(p=>String(p.id)===String(id));return `<div class="item" style="display:flex;align-items:center;justify-content:space-between;gap:8px"><strong>${i+1}. ${esc(p?.name||'Deleted project')}</strong><div class="actions"><button type="button" class="btn light" data-move="${i}" data-dir="-1" ${i===0?'disabled':''} aria-label="Move up">↑</button><button type="button" class="btn light" data-move="${i}" data-dir="1" ${i===trending.length-1?'disabled':''} aria-label="Move down">↓</button><button type="button" class="btn danger" data-remove="${i}">✕</button></div></div>`}).join(''):'<div class="notice">No trending projects selected.</div>';$('trendingCurrent').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{trending.splice(+b.dataset.remove,1);trendingUI()});$('trendingCurrent').querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{const i=+b.dataset.move,j=i+(+b.dataset.dir);[trending[i],trending[j]]=[trending[j],trending[i]];trendingUI()})}
async function loadTrending(){const {data,error}=await dropyClient.from('site_trending_items').select('project_id,position').order('position',{ascending:true});if(error){$('trendingMessage').textContent='Run the supplied Supabase SQL first: '+error.message;return}trending=(data||[]).map(r=>r.project_id);savedTrending=[...trending];trendingUI()}
$('setTrending').onclick=()=>{const id=$('trendingSelect').value;if(!id)return;if(trending.length>=5){$('trendingMessage').textContent='Maximum 5 trending projects allowed.';return}trending.push(id);trendingUI();$('trendingMessage').textContent='Click Save Trending to publish.'};
$('clearTrending').onclick=()=>{trending=[];trendingUI();$('trendingMessage').textContent='Click Save Trending to remove all.'};
$('saveTrending').onclick=async()=>{const button=$('saveTrending');button.disabled=true;try{const {error:delErr}=await dropyClient.from('site_trending_items').delete().gte('position',1);if(delErr)throw delErr;if(trending.length){const {error}=await dropyClient.from('site_trending_items').insert(trending.map((id,i)=>({position:i+1,project_id:id})));if(error)throw error}savedTrending=[...trending];$('trendingMessage').textContent='Trending saved! Refresh homepage to see the slider.'}catch(e){$('trendingMessage').textContent='Error: '+e.message+' (If interrupted, press Save Trending again.)'}finally{button.disabled=false}};
$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginError').textContent='Signing in...';try{const {error}=await dropyClient.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;await initialize()}catch(err){$('loginError').textContent=err.message}};
$('logout').onclick=async()=>{await dropyClient.auth.signOut();location.reload()};
$('form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;try{const row=collect();msg('Publishing changes...');const payload=dropyToRow(row);const {error}=await dropyClient.from('projects').update(payload).eq('id',row.id).select('id').single();if(error)throw error;await refresh(row.id);msg('Published to live database!')}catch(err){msg('Error: '+err.message)}finally{busy=false}};
$('add').onclick=async()=>{if(busy)return;busy=true;try{const {data,error}=await dropyClient.from('projects').insert({name:'New Project',task:'Testnet',category:'Airdrop',status:'Potential'}).select('id').single();if(error)throw error;$('search').value='';await refresh(data.id);$('name').focus();msg('New project created. Edit and publish.')}catch(err){msg('Error: '+err.message)}finally{busy=false}};
$('remove').onclick=async()=>{const p=current();if(!p||busy||!confirm('Delete '+p.name+' permanently?'))return;busy=true;try{const {error}=await dropyClient.from('projects').delete().eq('id',p.id);if(error)throw error;selected=null;await refresh(null);msg('Project deleted')}catch(err){msg('Error: '+err.message)}finally{busy=false}};
$('search').oninput=list;$('logoUrl').oninput=logoPreview;$('logoFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{msg('Uploading logo...');$('logoUrl').value=await uploadLogo(file);logoPreview();msg('Logo uploaded. Publish to save.')}catch(err){msg('Error: '+err.message)}};$('clearLogo').onclick=()=>{$('logoUrl').value='';logoPreview()};
const editor=$('guideEditor');let selectedBox=null;
// Keep the editing caret in a real paragraph after inserting a guide component.
function focusGuideParagraph(paragraph){
 if(!paragraph)return;
 editor.focus();
 const selection=window.getSelection();const range=document.createRange();
 range.selectNodeContents(paragraph);range.collapse(false);
 selection.removeAllRanges();selection.addRange(range);
 paragraph.scrollIntoView({block:'nearest',behavior:'instant'});
}
function insertGuideComponent(component){
 // Insert after the current guide block when possible, rather than always at the end.
 const selection=window.getSelection();let anchor=selection&&selection.rangeCount?selection.anchorNode:null;
 let block=anchor&&(anchor.nodeType===1?anchor:anchor.parentElement);
 if(block&&!editor.contains(block))block=null;
 while(block&&block.parentElement!==editor)block=block.parentElement;
 // Never insert inside a link or a step box.
 if(block&&block.parentElement===editor)block.after(component);
 else editor.append(component);
 const paragraph=document.createElement('p');paragraph.append(document.createElement('br'));
 component.after(paragraph);
 focusGuideParagraph(paragraph);
 return paragraph;
}
function updateStepSelection(){if(selectedBox&&!editor.contains(selectedBox))selectedBox=null;$('guideDeleteStepBox').disabled=!selectedBox;$('guideEditStepBox').disabled=!selectedBox}
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
 const box=makeStepBox(text.trim(),url.trim());insertGuideComponent(box);
 editor.querySelectorAll('.selected-step-box').forEach(x=>x.classList.remove('selected-step-box'));
 selectedBox=box;box.classList.add('selected-step-box');updateStepSelection();
};
$('guideEditStepBox').onclick=()=>{
 if(!selectedBox)return;
 const label=selectedBox.querySelector('strong');const existing=selectedBox.querySelector('a[href]');
 const text=prompt('Edit step button text:',label?.textContent||selectedBox.textContent.replace('×','').trim());if(text===null)return;
 const url=prompt('Edit button link (leave empty for no link):',existing?.getAttribute('href')||'');if(url===null)return;
 if(url.trim()&&!/^https?:\/\//i.test(url.trim())){msg('Please enter a valid https:// link');return}
 const replacement=makeStepBox(text.trim(),url.trim());replacement.classList.add('selected-step-box');selectedBox.replaceWith(replacement);selectedBox=replacement;updateStepSelection();
};
$('guideDeleteStepBox').onclick=()=>{selectedBox?.remove();selectedBox=null;updateStepSelection()};
function insertGuideInfo(type){const box=document.createElement('div');box.className='dh-info-box '+(type==='daily'?'dh-daily-box':'dh-note-box');box.textContent=type==='daily'?'New tasks added daily at 5:00 PM (Asia/Karachi)':'Add your important note here.';insertGuideComponent(box);msg('Box added. The cursor is ready below it; tap box text to edit.');}
$('guideDaily').onclick=()=>insertGuideInfo('daily');
$('guideNote').onclick=()=>insertGuideInfo('note');

editor.addEventListener('keydown',e=>{
 if(e.key!=='Enter'||e.shiftKey)return;
 const selection=window.getSelection();const node=selection?.anchorNode;
 const element=node&&(node.nodeType===1?node:node.parentElement);
 const box=element?.closest('.guide-step-box');
 if(box&&editor.contains(box)){
  e.preventDefault();
  let next=box.nextElementSibling;
  if(!next||next.tagName!=='P'){
   next=document.createElement('p');next.append(document.createElement('br'));box.after(next);
  }
  focusGuideParagraph(next);
 }
});
$('guideToolbar').querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>{editor.focus();document.execCommand(b.dataset.cmd,false,b.dataset.val||null)});
$('guideLink').onclick=()=>{const url=prompt('Enter https:// link:');if(url&&/^https?:\/\//i.test(url)){editor.focus();document.execCommand('createLink',false,url)}};
$('guideImage').onclick=()=>{const url=prompt('Image URL (https://):');if(url&&/^https?:\/\//i.test(url)){editor.focus();document.execCommand('insertImage',false,url)}};
$('guideClear').onclick=()=>{editor.focus();document.execCommand('removeFormat')};
async function initialize(){const {data:{user}}=await dropyClient.auth.getUser();if(!user){$('loginBox').hidden=false;$('dashboard').hidden=true;return}const {data,error}=await dropyClient.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle();if(error||!data){$('loginBox').hidden=false;$('dashboard').hidden=true;$('loginError').textContent=error?.message||'Not authorized as admin';return}$('loginBox').hidden=true;$('dashboard').hidden=false;try{await refresh();await loadTrending()}catch(e){msg('Error: '+e.message)}}await initialize();
})();
