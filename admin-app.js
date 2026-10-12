(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let projects = [], selected = null, busy = false;
  function message(text) {
    const el = $('message');
    if (el) el.textContent = text;
    if (/^(Error:|Cannot )/.test(text)) alert(text);
  }
  const current = () => projects.find(p => String(p.id) === String(selected)) || null;
  function list() {
    const q = $('search').value.toLowerCase();
    $('count').textContent = `${projects.length} projects`;
    $('list').innerHTML = projects.filter(p => String(p.name || '').toLowerCase().includes(q))
      .map(p => `<button type="button" class="entry ${String(p.id) === String(selected) ? 'active' : ''}" data-id="${esc(p.id)}"><b>${esc(p.name)}</b><br><small>${esc(p.task)} · ${esc(p.status)}</small></button>`).join('');
    $('list').querySelectorAll('button').forEach(button => {
      button.onclick = () => { selected = button.dataset.id; list(); load(); };
    });
  }
  function linkRow(link = {}) {
    const el = document.createElement('div');
    el.className = 'item';
    const type = link.label || 'Website';
    el.innerHTML = `<div class="fields"><div class="field"><label>${esc(type)} URL</label><input class="link-url" data-type="${esc(type)}" value="${esc(link.url || '')}" placeholder="https://..."></div></div>`;
    $('links').append(el);
  }
  function legacyGuide(guide) {
    if (!Array.isArray(guide)) return '';
    if (guide.length === 1 && typeof guide[0]?.html === 'string') return guide[0].html;
    return guide.map((s,i) => `<h3>${esc(s.title || 'Step ' + (i+1))}</h3><p>${esc(s.text || '').replace(/\n/g,'<br>')}</p>`).join('');
  }
  function cleanGuide(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const allowed = new Set(['P','DIV','BR','H2','H3','H4','STRONG','B','EM','I','U','A','IMG','UL','OL','LI','BLOCKQUOTE']);
    function sanitize(el) {
      for (const child of [...el.childNodes]) {
        if (child.nodeType === 8) { child.remove(); continue; }
        if (child.nodeType !== 1) continue;
        if (!allowed.has(child.tagName)) { const fragment=doc.createDocumentFragment(); while(child.firstChild)fragment.appendChild(child.firstChild);child.replaceWith(fragment);sanitize(el);continue; }
        const href=child.getAttribute('href'),src=child.getAttribute('src'),alt=child.getAttribute('alt');
        for(const attr of [...child.attributes])child.removeAttribute(attr.name);
        if(child.tagName==='A' && /^https?:\/\//i.test(href||'')){child.setAttribute('href',href);child.setAttribute('target','_blank');child.setAttribute('rel','noopener noreferrer');}
        if(child.tagName==='IMG') {if(/^https?:\/\//i.test(src||'')){child.setAttribute('src',src);child.setAttribute('alt',alt||'Guide image');child.setAttribute('loading','lazy');}else {child.remove();continue;}}
        sanitize(child);
      }
    }
    sanitize(doc.body);
    return doc.body.innerHTML;
  }
  function load() {
    const p = current();
    $('form').hidden = !p;
    $('remove').disabled = !p;
    if (!p) { $('title').textContent = 'No projects'; return; }
    $('title').textContent = 'Edit ' + p.name;
    for (const key of ['name','task','status','funding','cost','time','addedOn','color']) {
      const field = $(key);
      if (field) field.value = p[key] ?? (key === 'color' ? '#2563eb' : '');
    }
    $('logoUrl').value = p.logoUrl || '';
    $('links').innerHTML = '';
    $('guideEditor').innerHTML = cleanGuide(legacyGuide(p.guide || []));
    const existingLinks = p.links || [];
    ['Website','Discord','X'].forEach(type => {
      const found = existingLinks.find(l => {
        const label = String(l.label || '').toLowerCase().trim();
        return type === 'Website' ? ['website','official website','official link'].includes(label) : type === 'Discord' ? label.includes('discord') : label === 'x' || label === 'twitter';
      });
      linkRow({label:type,url:found?.url || ''});
    });
    const preview = $('logoPreview');
    if (preview) {
      preview.replaceChildren();
      if (p.logoUrl) {
        const img = document.createElement('img');
        img.src = p.logoUrl;
        img.alt = 'Project logo';
        img.style.cssText = 'width:100%;height:100%;object-fit:contain';
        img.onerror = () => { preview.textContent = '?'; };
        preview.append(img);
      } else preview.textContent = '?';
    }
  }
  function collect() {
    const p = current();
    if (!p) throw Error('No project selected. Please select a project before publishing.');
    const name = $('name').value.trim();
    if (!name) throw Error('Project name required');
    const links = [];
    for (const input of $('links').querySelectorAll('.link-url')) {
      const label = input.dataset.type;
      const url = input.value.trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) throw Error('Use a valid http(s) link for ' + label);
      links.push({label,url});
    }
    const row = {...p};
    for (const key of ['name','task','status','funding','cost','time','addedOn','color']) { const field = $(key); if (field) row[key] = field.value.trim(); }
    row.logoUrl = $('logoUrl').value.trim();
    row.links = links;
    const html = cleanGuide($('guideEditor').innerHTML.trim());
    row.guide = (html.replace(/<[^>]+>/g,'').trim() || /<img\b/i.test(html)) ? [{html}] : [];
    return row;
  }
  async function refresh(preferredId = selected) {
    projects = await dropyFetchProjects();
    selected = projects.find(p => String(p.id) === String(preferredId))?.id ?? projects[0]?.id ?? null;
    list(); load();
  }
  async function uploadLogo(file) {
    if (!file.type.startsWith('image/')) throw Error('Select an image');
    if (file.size > 5 * 1024 * 1024) throw Error('Logo maximum 5MB');
    const img = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const scale = Math.min(256 / img.width, 256 / img.height);
    ctx.drawImage(img, (256-img.width*scale)/2, (256-img.height*scale)/2, img.width*scale, img.height*scale);
    img.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob) throw Error('Unable to convert logo');
    const path = `${crypto.randomUUID()}.webp`;
    const {error} = await dropyClient.storage.from('project-logos').upload(path, blob, {contentType:'image/webp'});
    if (error) throw error;
    return dropyClient.storage.from('project-logos').getPublicUrl(path).data.publicUrl;
  }
  $('loginForm').onsubmit = async event => {
    event.preventDefault();
    $('loginError').textContent = 'Signing in...';
    try {
      const {error} = await dropyClient.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
      if (error) throw error;
      await initialize();
    } catch (error) { $('loginError').textContent = error.message; }
  };
  $('logout').onclick = async () => { await dropyClient.auth.signOut(); location.reload(); };
  $('form').onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const row = collect();
      message('Publishing changes...');
      const {error} = await dropyClient.from('projects').update(dropyToRow(row)).eq('id',row.id).select('id').single();
      if (error) throw error;
      await refresh(row.id);
      message('Published to live database!');
    } catch (error) { message('Error: ' + error.message); }
    finally { busy = false; }
  };
  $('add').onclick = async () => {
    if (busy) return;
    busy = true;
    $('add').disabled = true;
    try {
      message('Creating project...');
      const {data,error} = await dropyClient.from('projects').insert({name:'New Project',task:'Testnet',category:'Airdrop',status:'Potential'}).select('id').single();
      if (error) throw error;
      if (!data?.id) throw Error('Database did not return project ID');
      $('search').value = '';
      await refresh(data.id);
      if (!current()) throw Error('Project created but could not be loaded');
      $('name').focus();
      message('New project created. Fill the fields and click Publish Changes.');
    } catch (error) { message('Error: ' + error.message); }
    finally { busy = false; $('add').disabled = false; }
  };
  $('remove').onclick = async () => {
    const p = current();
    if (!p || busy || !confirm('Delete ' + p.name + ' permanently?')) return;
    busy = true;
    try {
      const {error} = await dropyClient.from('projects').delete().eq('id',p.id);
      if (error) throw error;
      selected = null;
      await refresh(null);
      message('Project deleted');
    } catch (error) { message('Error: ' + error.message); }
    finally { busy = false; }
  };
  const editor = $('guideEditor');
  let savedRange = null;
  const rememberSelection = () => { const s=window.getSelection(); if(s?.rangeCount && editor.contains(s.anchorNode)) savedRange=s.getRangeAt(0).cloneRange(); };
  editor.addEventListener('keyup',rememberSelection);
  editor.addEventListener('mouseup',rememberSelection);
  function focusEditor() {editor.focus();if(savedRange){const s=window.getSelection();s.removeAllRanges();s.addRange(savedRange);}}
  $('guideToolbar').querySelectorAll('[data-cmd]').forEach(btn => btn.addEventListener('click',()=>{focusEditor();document.execCommand(btn.dataset.cmd,false,btn.dataset.val||null);rememberSelection();}));
  $('guideClear').onclick=()=>{focusEditor();document.execCommand('removeFormat',false,null);};
  $('guideLink').onclick=()=>{rememberSelection();const url=prompt('Paste link URL (https://...)');if(!url)return;if(!/^https?:\/\//i.test(url)){message('Error: Use an https:// link');return;}focusEditor();const selection=window.getSelection();if(selection?.isCollapsed){document.execCommand('insertHTML',false,`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`);}else document.execCommand('createLink',false,url);rememberSelection();};
  function insertImage(url){focusEditor();document.execCommand('insertHTML',false,`<img src="${esc(url)}" alt="Guide image" loading="lazy"><p><br></p>`);rememberSelection();}
  $('guideImage').onclick=()=>{rememberSelection();const url=prompt('Image URL paste karein (https://...), ya Cancel karke gallery se upload karein.');if(url){if(!/^https?:\/\//i.test(url)){message('Error: Image URL https:// se shuru hona chahiye');return;}insertImage(url);}else $('guideImageFile').click();};
  $('guideImageFile').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;try{message('Uploading guide image...');const url=await uploadGuideImage(file);insertImage(url);message('Image inserted. Publish Changes to save guide.');}catch(error){message('Error: '+error.message);}finally{event.target.value='';}};
  async function uploadGuideImage(file){
    if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type))throw Error('Select PNG, JPG, WebP or GIF image');
    if(file.size>5*1024*1024)throw Error('Guide image maximum 5 MB');
    const img=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1200/img.width,1200/img.height);canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);img.close?.();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.84));if(!blob)throw Error('Image conversion failed');
    const path='guide-'+crypto.randomUUID()+'.webp';const {error}=await dropyClient.storage.from('project-logos').upload(path,blob,{contentType:'image/webp'});if(error)throw error;
    return dropyClient.storage.from('project-logos').getPublicUrl(path).data.publicUrl;
  }
  $('search').oninput = list;
  $('logoFile').onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    message('Uploading logo...');
    try { $('logoUrl').value = await uploadLogo(file); message('Logo uploaded. Click Publish Changes to save project.'); }
    catch (error) { message('Error: ' + error.message); }
  };
  $('clearLogo').onclick = () => { $('logoUrl').value = ''; message('Logo removed from form. Publish changes to save.'); };
  async function initialize() {
    const {data:{user},error:authError} = await dropyClient.auth.getUser();
    if (authError || !user) { $('loginBox').hidden = false; $('dashboard').hidden = true; $('loginError').textContent = ''; return; }
    const {data,error} = await dropyClient.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle();
    if (error || !data) {
      $('loginBox').hidden = false;
      $('dashboard').hidden = true;
      $('loginError').textContent = error ? 'Admin verification failed: ' + error.message : 'This account is not authorized as admin.';
      return;
    }
    $('loginBox').hidden = true;
    $('dashboard').hidden = false;
    try { await refresh(); } catch (error) { message('Error: Cannot load projects: ' + error.message); }
  }
  await initialize();
})();
