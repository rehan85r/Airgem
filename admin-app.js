(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let projects = [], selected = null, busy = false, trendingId = null;
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
  function stepRow(step = {}) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<div class="heading"><b>Guide Step</b><button type="button" class="btn danger">Remove</button></div><div class="fields"><div class="field wide"><label>Step Title</label><input class="step-title" value="${esc(step.title)}"></div><div class="field wide"><label>Instructions</label><textarea class="step-text"></textarea></div></div>`;
    el.querySelector('textarea').value = step.text || '';
    el.querySelector('button').onclick = () => el.remove();
    $('steps').append(el);
  }
  function load() {
    const p = current();
    $('form').hidden = !p;
    $('remove').disabled = !p;
    if (!p) { $('title').textContent = 'No projects'; return; }
    $('title').textContent = 'Edit ' + p.name;
    for (const key of ['name','task','status','category','funding','investors','addedOn','color','description']) {
      $(key).value = p[key] || (key === 'color' ? '#2563eb' : '');
    }
    $('logoUrl').value = p.logoUrl || '';
    $('links').innerHTML = '';
    $('steps').innerHTML = '';
    const existingLinks = p.links || [];
    ['Website','Discord','X'].forEach(type => {
      const found = existingLinks.find(l => {
        const label = String(l.label || '').toLowerCase().trim();
        return type === 'Website' ? ['website','official website','official link'].includes(label) : type === 'Discord' ? label.includes('discord') : label === 'x' || label === 'twitter';
      });
      linkRow({label:type,url:found?.url || ''});
    });
    (p.guide || []).forEach(stepRow);
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
    for (const key of ['name','task','status','category','funding','investors','addedOn','color','description']) row[key] = $(key).value.trim();
    row.logoUrl = $('logoUrl').value.trim();
    row.links = links;
    row.guide = [...$('steps').children].map(el => ({title:el.querySelector('.step-title').value.trim(), text:el.querySelector('.step-text').value.trim()})).filter(s => s.title || s.text);
    return row;
  }
  async function refresh(preferredId = selected) {
    projects = await dropyFetchProjects();
    selected = projects.find(p => String(p.id) === String(preferredId))?.id ?? projects[0]?.id ?? null;
    const {data: trending, error: trendingError} = await dropyClient.from('site_trending').select('project_id').eq('slot',1).maybeSingle();
    if (trendingError) { message('Error: Trending setup missing. Run included SQL in Supabase first. ' + trendingError.message); }
    trendingId = trending?.project_id ?? null;
    list(); load(); renderTrendingManager();
  }
  function renderTrendingManager() {
    const currentTrending = projects.find(p => String(p.id) === String(trendingId));
    $('trendingCurrent').textContent = currentTrending?.name || 'No trending project selected';
    $('trendingState').textContent = currentTrending ? '1 Active' : 'Not set';
    const select = $('trendingSelect');
    select.innerHTML = '<option value="">Select a project...</option>' + projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    select.value = currentTrending ? String(currentTrending.id) : '';
    $('clearTrending').disabled = !currentTrending;
  }
  async function saveTrending(projectId) {
    if (busy) return;
    busy = true;
    $('setTrending').disabled = true;
    $('clearTrending').disabled = true;
    $('trendingMessage').textContent = 'Saving Trending Airdrop...';
    try {
      const {data,error} = await dropyClient.from('site_trending')
        .update({project_id:projectId,updated_at:new Date().toISOString()})
        .eq('slot',1).select('project_id').single();
      if (error) throw error;
      trendingId = data.project_id;
      renderTrendingManager();
      $('trendingMessage').textContent = projectId ? 'Trending Airdrop updated successfully!' : 'Trending Airdrop removed.';
    } catch (error) {
      $('trendingMessage').textContent = 'Error: ' + error.message;
    } finally { busy = false; $('setTrending').disabled = false; $('clearTrending').disabled = !trendingId; }
  }
  $('setTrending').onclick = () => {
    const id = $('trendingSelect').value;
    if (!id) { $('trendingMessage').textContent = 'Please select a project first.'; return; }
    saveTrending(id);
  };
  $('clearTrending').onclick = () => saveTrending(null);
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
  $('addStep').onclick = () => stepRow();
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
