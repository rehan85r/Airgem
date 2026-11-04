/* Airgem admin application. Database policies remain the authorization boundary. */
(async () => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const icons = () => window.lucide?.createIcons({ attrs: { 'stroke-width': 1.8 } });
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const state = {
    projects: [],
    selected: null,
    isNew: false,
    dirty: false,
    busy: false,
    uploads: 0,
    trending: [],
    savedTrending: [],
    pendingProjectDeletes: [],
    trendingLoaded: false,
    page: 1,
    pageSize: 5,
    category: '',
    view: 'projects',
    dataLoaded: false,
  };
  let editor,
    toastTimer,
    pendingMfa = null,
    turnstileWidget = null,
    turnstileToken = '';
  const siteKey = String(window.AIRGEM_TURNSTILE_SITE_KEY || '').trim();
  const locationKey = 'airgem-admin-location-v1';
  const saveLocation = (location) => {
    try { sessionStorage.setItem(locationKey, JSON.stringify(location)); } catch {}
  };
  const readLocation = () => {
    try { return JSON.parse(sessionStorage.getItem(locationKey) || 'null'); } catch { return null; }
  };
  const clearLocation = () => {
    try { sessionStorage.removeItem(locationKey); } catch {}
  };
  let currentPickerSection = 'dashboard';
  let restoringLocation = false;
  function restoreLocation() {
    const saved = readLocation();
    if (!saved || !state.dataLoaded) return;
    restoringLocation = true;
    try {
      const section = ['basic', 'details', 'guide'].includes(saved.section) ? saved.section : 'dashboard';
      if (section !== 'dashboard') {
        document.querySelector('[data-project-section="' + section + '"]')?.click();
      }
      if (saved.editor && saved.projectId != null) {
        const project = state.projects.find(item => String(item.id) === String(saved.projectId));
        if (project) editProject(project.id, section === 'dashboard' ? 'basic' : section);
      }
    } finally { restoringLocation = false; }
  }

  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const matchesProjectSearch = (project, query) =>
    String(project?.name || '').trim().toLowerCase().startsWith(query);
  const safeURL = (value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  };
  const message = (text, error = false) => {
    clearTimeout(toastTimer);
    $('message').textContent = text;
    $('message').classList.toggle('is-error', error);
    $('message').hidden = !text;
    if (text && !error)
      toastTimer = setTimeout(() => {
        $('message').hidden = true;
      }, 6500);
  };
  const mappedProject = (row) => ({
    ...row,
    addedOn: row.added_on || '',
    logoUrl: row.logo_url || '',
    displayTag: row.display_tag || '',
    activityStatus: row.activity_status || 'Active',
    started: row.launch_date || '',
    timeEstimate: row.time || '',
  });
  function payload(project) {
    // Only columns present in the existing schema are written. Extra row data stays intact.
    return {
      name: project.name,
      display_tag: project.displayTag || null,
      category: project.task || project.category,
      task: project.task || '',
      status: project.status || '',
      activity_status: project.activityStatus || 'Active',
      funding: project.funding || '',
      cost: project.cost || null,
      investors: project.investors || null,
      time: project.timeEstimate || null,
      ecosystem: project.ecosystem || null,
      launch_date: project.started || null,
      tge: project.tge || null,
      description: project.description || '',
      color: project.color || '#1E90FF',
      added_on: project.addedOn || null,
      logo_url: project.logoUrl || null,
      links: project.links || [],
      guide: project.guide || [],
    };
  }
  let activePublishAction = null;
  function updateBusy() {
    const blocked = state.busy || state.uploads > 0;
    // Keep the captured draft stable until a save or upload has completed.
    $('form').inert = blocked;
    $('form').setAttribute('aria-busy', String(blocked));
    $('publish').disabled = blocked;
    $('publish').setAttribute('aria-busy', String(blocked));
    $('publish').innerHTML =
      icon(state.busy ? 'loader-circle' : 'check') +
      (state.busy ? 'Saving…' : state.isNew ? 'Publish Project' : 'Publish Changes');
    $('remove').disabled = blocked || state.isNew;
    $('saveTrending').disabled = state.uploads > 0 || (state.busy && activePublishAction === 'top') || !state.trendingLoaded;
    $('publishAllAirdrops').disabled = state.uploads > 0 || (state.busy && activePublishAction === 'all');
    $('trendingSelect').disabled = state.busy || !state.trendingLoaded;
    document.querySelectorAll('[data-top-add], [data-top-remove], [data-top-drag]').forEach((button) => {
      button.disabled = state.busy;
    });
    $('editorProjectMeta').textContent = state.isNew
      ? 'New project · not published'
      : state.dirty
        ? 'You have unpublished changes'
        : 'Changes are saved to your live project';
    icons();
  }
  function setDirty() {
    state.dirty = true;
    updateBusy();
  }
  function canLeaveEditor() {
    if (state.busy || state.uploads) {
      message('Wait for the current save or upload to finish.', true);
      return false;
    }
    return !state.dirty || confirm('Discard your unpublished project changes?');
  }
  const trendingDirty = () =>
    JSON.stringify(state.trending.map(String)) !== JSON.stringify(state.savedTrending.map(String));
  function setEditorTab(tab) {
    const mobileTitle = $('mobileEditorSectionTitle');
    if (mobileTitle) mobileTitle.textContent = ({ basic: 'Basic Editor', details: 'Details Editor', links: 'Social Links', investors: 'Investors', guide: 'Guide Editor' })[tab] || 'Edit Project';
    $$('[data-editor-tab]').forEach((button) => {
      const active = button.dataset.editorTab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $$('[data-editor-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.editorPanel !== tab;
    });
  }
  function canLeaveView(nextView) {
    if ((state.busy || state.uploads) && nextView !== state.view) {
      message('Wait for the current save or upload to finish.', true);
      return false;
    }
    if (state.view === 'editor' && !canLeaveEditor()) return false;
    if (state.view === 'top' && nextView !== 'top' && trendingDirty()) {
      if (!confirm('Discard your unsaved top airdrop changes?')) return false;
      state.trending = [...state.savedTrending];
      renderTrending();
    }
    return true;
  }
  function navigate(view, { skipGuard = false } = {}) {
    if (!skipGuard && !canLeaveView(view)) return false;
    if (state.view === 'editor') state.dirty = false;
    state.view = view;
    if (!restoringLocation && view === 'projects') saveLocation({ section: currentPickerSection });
    document.body.dataset.adminView = view;
    for (const id of [
      'projectsView',
      'editorView',
      'settingsView',
      'libraryView',
    ])
      $(id).hidden = true;
    if (view === 'projects') {
      $('projectsView').hidden = false;
      $('pageTitle').innerHTML = 'Admin <span class="admin-panel-accent">Panel</span>';
      $('pageDescription').textContent = 'Manage Your Projects In One Place';
    } else if (view === 'editor') $('editorView').hidden = false;
    else if (view === 'top') {
      $('projectsView').hidden = false;
      renderTrending();
    } else if (view === 'settings') $('settingsView').hidden = false;
    else {
      $('libraryView').hidden = false;
      renderLibrary(view);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    return true;
  }
  function editProject(id, tab = 'basic') {
    if (!canLeaveView('editor')) return;
    const project = state.projects.find((item) => String(item.id) === String(id));
    if (!project) {
      message('That project is no longer available.', true);
      return;
    }
    state.selected = project.id;
    if (!restoringLocation) saveLocation({ section: tab, editor: true, projectId: String(project.id) });
    state.isNew = false;
    state.dirty = false;
    editor.load(project);
    $('title').textContent = `Edit ${project.name}`;
    $('previewProject').hidden = false;
    $('previewProject').href = `project.html?id=${encodeURIComponent(project.id)}`;
    // Keep the selected editor visible even if a previous view left stale hidden states.
    if (!navigate('editor', { skipGuard: true })) return;
    const editorPage = $('editorView');
    editorPage.classList.remove('airgem-editor-enter', 'airgem-editor-exit');
    void editorPage.offsetWidth;
    editorPage.classList.add('airgem-editor-enter');
    setEditorTab(tab);
    $('projectsView').hidden = true;
    $('editorView').hidden = false;
    $('panel-' + tab)?.removeAttribute('hidden');
    updateBusy();
  }
  async function getProjects() {
    const projects = [];
    const batchSize = 1000;
    for (let from = 0; ; from += batchSize) {
      const { data, error } = await dropyClient
        .from('projects')
        .select('*')
        .order('added_on', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .range(from, from + batchSize - 1);
      if (error) throw error;
      projects.push(...(data || []).map(mappedProject));
      if (!data || data.length < batchSize) break;
    }
    return projects;
  }
  async function refreshProjects() {
    const projects = await getProjects();
    state.projects = projects;
    state.dataLoaded = true;
    renderDashboard();
    // Re-render Top Airdrops after projects arrive; its parallel fetch may finish first.
    if (state.trendingLoaded) renderTrending();
    renderAllAirdrops();
    if ($('dataError')) $('dataError').hidden = true;
  }
  function avatar(project) {
    return `<span class="project-avatar">${safeURL(project.logoUrl) ? `<img src="${esc(project.logoUrl)}" alt="" loading="lazy">` : esc((project.name || 'A').slice(0, 1).toUpperCase())}</span>`;
  }
  function renderDashboard() {
    icons();
  }
  function mediaItems() {
    const media = new Map();
    const add = (url, project, label) => {
      if (safeURL(url) && !media.has(url)) media.set(url, { url, project, label });
    };
    state.projects.forEach((project) => {
      add(project.logoUrl, project, 'Project logo');
      window.AirgemEditor.parseInvestors(project.investors).forEach((investor) =>
        add(investor.logo, project, investor.title),
      );
      (Array.isArray(project.guide) ? project.guide : []).forEach((task) => {
        const doc = new DOMParser().parseFromString(
          window.AirgemEditor.cleanHTML(task.html || ''),
          'text/html',
        );
        doc
          .querySelectorAll('img[src]')
          .forEach((img) => add(img.src, project, task.title || 'Guide image'));
      });
    });
    return [...media.values()];
  }
  function renderLibrary(view) {
    const titles = { guides: 'Guides & Tasks', investors: 'Investors', media: 'Media Library' };
    const descriptions = {
      guides: 'Edit the guides and tasks attached to your projects.',
      investors: 'Investor records across your projects. Select a project to manage its investors.',
      media: 'Images referenced by your saved projects, investors and guides.',
    };
    $('libraryTitle').textContent = titles[view];
    $('libraryDescription').textContent = descriptions[view];
    const root = $('libraryList');
    root.className = view === 'media' ? 'media-grid' : 'library-grid';
    if (view === 'media')
      root.innerHTML = mediaItems()
        .map(
          (item) =>
            `<button type="button" class="media-item" data-edit-project="${esc(item.project.id)}"><img src="${esc(item.url)}" alt="${esc(item.label)}" loading="lazy"><strong>${esc(item.project.name)}</strong><small>${esc(item.label)}</small></button>`,
        )
        .join('');
    else
      root.innerHTML = state.projects
        .filter((project) =>
          view === 'guides'
            ? Array.isArray(project.guide) && project.guide.length
            : window.AirgemEditor.parseInvestors(project.investors).length ||
              String(project.investors || '')
                .trim()
                .toUpperCase() === 'N/A',
        )
        .map((project) => {
          const items =
            view === 'guides'
              ? (project.guide || []).map((task) => task.title || 'Untitled task')
              : String(project.investors || '')
                    .trim()
                    .toUpperCase() === 'N/A'
                ? ['N/A']
                : window.AirgemEditor.parseInvestors(project.investors).map((item) => item.title);
          return `<button type="button" class="library-card" data-edit-project="${esc(project.id)}" data-editor-section="${view === 'guides' ? 'guide' : 'investors'}">${avatar(project)}<span class="library-card-copy"><strong>${esc(project.name)}</strong><small>${esc(items.join(' · '))}</small><span>Edit ${view === 'guides' ? 'guides' : 'investors'} ${icon('arrow-up-right')}</span></span></button>`;
        })
        .join('');
    if (!root.children.length)
      root.innerHTML =
        '<div class="empty-state"><h3>No saved records yet</h3><p>Add content in the project editor and publish to see it here.</p></div>';
    icons();
  }
  async function removeProject(id) {
    if (state.busy || state.uploads) return;
    const project = state.projects.find((item) => String(item.id) === String(id));
    if (!project || !confirm(`Delete “${project.name}” permanently? This cannot be undone.`))
      return;
    state.busy = true;
    updateBusy();
    try {
      const { data, error } = await dropyClient
        .from('projects')
        .delete()
        .eq('id', project.id)
        .select('id');
      if (error) throw error;
      if (!data?.length)
        throw Error('The project could not be deleted. Check your authorization and reload.');
      state.dirty = false;
      await refreshProjects();
      await loadTrending();
      navigate('projects', { skipGuard: true });
      message('Project deleted.');
    } catch (error) {
      message(`Unable to delete project: ${error.message}`, true);
    } finally {
      state.busy = false;
      updateBusy();
    }
  }
  async function publish(event) {
    event.preventDefault();
    if (state.busy || state.uploads) return;
    $('name').setCustomValidity($('name').value.trim() ? '' : 'Enter a project name.');
    const invalid = $('form').querySelector('input:invalid, select:invalid');
    if (invalid) {
      const panel = invalid.closest('[data-editor-panel]');
      if (panel) setEditorTab(panel.dataset.editorPanel);
      invalid.focus();
      invalid.reportValidity();
      return;
    }
    let project;
    try {
      project = editor.collect();
    } catch (error) {
      message(error.message, true);
      return;
    }
    state.busy = true;
    updateBusy();
    try {
      const query = state.isNew
        ? dropyClient.from('projects').insert(payload(project))
        : dropyClient.from('projects').update(payload(project)).eq('id', state.selected);
      const { data, error } = await query.select('*').single();
      if (error) throw error;
      state.selected = data.id;
      state.isNew = false;
      state.dirty = false;
      editor.load(mappedProject(data));
      $('title').textContent = `Edit ${data.name}`;
      $('previewProject').hidden = false;
      $('previewProject').href = `project.html?id=${encodeURIComponent(data.id)}`;
      try {
        await refreshProjects();
        message('Project published successfully.');
      } catch (refreshError) {
        message(
          `Project was published, but the project list could not refresh: ${refreshError.message}`,
          true,
        );
      }
    } catch (error) {
      message(`Unable to publish: ${error.message}`, true);
    } finally {
      state.busy = false;
      updateBusy();
    }
  }
  async function uploadFile(file, logo) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))
      throw Error('Choose a PNG, JPG, WebP or GIF image.');
    if (file.size > 5 * 1024 * 1024) throw Error('Images must be 5 MB or smaller.');
    state.uploads++;
    updateBusy();
    try {
      let body = file,
        contentType = file.type,
        extension = {
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/webp': 'webp',
          'image/gif': 'gif',
        }[file.type];
      if (logo) {
        const image = await createImageBitmap(file),
          canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const scale = Math.min(256 / image.width, 256 / image.height);
        canvas
          .getContext('2d')
          .drawImage(
            image,
            (256 - image.width * scale) / 2,
            (256 - image.height * scale) / 2,
            image.width * scale,
            image.height * scale,
          );
        image.close?.();
        body = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
        if (!body) throw Error('Image conversion failed.');
        contentType = 'image/webp';
        extension = 'webp';
      }
      const path = `${logo ? '' : 'guide/'}${crypto.randomUUID()}.${extension}`;
      const bucket = dropyClient.storage.from('project-logos');
      const { error } = await bucket.upload(path, body, { contentType, upsert: false });
      if (error) throw error;
      return bucket.getPublicUrl(path).data.publicUrl;
    } finally {
      state.uploads--;
      updateBusy();
    }
  }
  function renderAllAirdrops() {
    const searchValue = $('allAirdropsSearch').value;
    const query = searchValue.trim().toLowerCase();
    $('allAirdropsSearchClear').hidden = searchValue.length === 0;
    const availableProjects = state.projects.filter((project) =>
      !state.trending.some((id) => String(id) === String(project.id)));
    const matches = availableProjects.filter((project) => matchesProjectSearch(project, query));
    const selectionCount = $('allAirdropsSelectionCount');
    if (selectionCount) {
      selectionCount.textContent = String(matches.length);
      selectionCount.hidden = searchValue.length > 0;
    }
    $('allAirdropsPending').textContent = '';
    $('publishAllAirdrops').disabled = state.uploads > 0 || (state.busy && activePublishAction === 'all');
    $('allAirdropsList').innerHTML = matches.map((project) => {
      const staged = state.pendingProjectDeletes.some((id) => String(id) === String(project.id));
      return `<div class="trending-item${staged ? ' is-pending-delete' : ''}">${avatar(project)}<span class="trending-item-copy"><strong>${esc(project.name)}</strong>${staged ? '<small>Pending Deletion · Not Published</small>' : ''}</span><div class="actions"><button type="button" class="icon-button" data-stage-delete="${esc(String(project.id))}" aria-label="${staged ? 'Undo deletion of' : 'Mark for deletion'} ${esc(project.name)}" title="${staged ? 'Undo Delete' : 'Delete Project'}">${icon(staged ? 'undo-2' : 'trash-2')}</button></div></div>`;
    }).join('') || '<div class="trending-empty">No matching projects.</div>';
    icons();
  }
  function toggleProjectDeletion(id) {
    if (state.busy || state.uploads) return;
    const project = state.projects.find((item) => String(item.id) === String(id));
    if (!project) return;
    const index = state.pendingProjectDeletes.findIndex((item) => String(item) === String(id));
    if (index >= 0) state.pendingProjectDeletes.splice(index, 1);
    else state.pendingProjectDeletes.push(project.id);
    showPublishStatus('allAirdropsMessage', 'Click Publish To Save', 'is-success');
    renderAllAirdrops();
  }
  async function publishAllAirdrops() {
    if (state.busy || state.uploads) return;
    if (!state.pendingProjectDeletes.length) return;
    const names = state.pendingProjectDeletes.map((id) =>
      state.projects.find((item) => String(item.id) === String(id))?.name || String(id));
    if (!confirm(`Permanently delete ${names.length} project${names.length === 1 ? '' : 's'} from Airgem and all categories? This cannot be undone.\n\n${names.join(', ')}`)) return;
    activePublishAction = 'all';
    state.busy = true;
    updateBusy();
    try {
      // Keep failed IDs staged; a partial success is never reported as a full publish.
      const ids = [...state.pendingProjectDeletes];
      for (const id of ids) {
        const { data, error } = await dropyClient.from('projects').delete().eq('id', id).select('id');
        if (error) throw error;
        if (!data?.length) throw Error(`Project ${id} was not deleted. Check permissions.`);
        state.pendingProjectDeletes = state.pendingProjectDeletes.filter((item) => String(item) !== String(id));
      }
      await refreshProjects();
      await loadTrending();
      showPublishStatus('allAirdropsMessage', 'Update Saved ✓', 'is-success');
    } catch (error) {
      showPublishStatus('allAirdropsMessage', 'Error Not Saved ×', 'is-error', `Publish incomplete: ${error.message}. Check remaining pending projects.`);
      await refreshProjects().catch(() => {});
      await loadTrending().catch(() => {});
    } finally {
      state.busy = false;
      activePublishAction = null;
      updateBusy();
      renderAllAirdrops();
    }
  }
  function renderTrendingSearch() {
    const query = $('trendingSelect').value.trim().toLowerCase();
    const hasSearchText = $('trendingSelect').value.length > 0;
    $('trendingSearchClear').hidden = !hasSearchText;
    $('trendingSelectionCount').hidden = hasSearchText;
    const matches = query
      ? state.projects
          .filter(
            (project) =>
              !state.trending.some((id) => String(id) === String(project.id)) &&
              matchesProjectSearch(project, query),
          )
          .slice(0, 20)
      : [];
    $('trendingSearchResults').hidden = !query || matches.length === 0;
    $('trendingSelect').setAttribute('aria-expanded', String(Boolean(query && matches.length)));
    $('trendingSearchResults').innerHTML = matches.length
      ? matches
          .map(
            (project) =>
              `<button type="button" data-top-add="${esc(project.id)}">${avatar(project)}<span class="trending-item-copy"><strong>${esc(project.name)}</strong></span>${icon('plus')}</button>`,
          )
          .join('')
      : '';
    icons();
  }
  function renderTrending() {
    if ($('trendingSelectionCount')) $('trendingSelectionCount').textContent = `${state.trending.length}/10`;
    $('trendingCurrent').innerHTML =
      state.trending
        .map((id, index) => {
          const project = state.projects.find((item) => String(item.id) === String(id));
          return `<div class="trending-item" data-top-row="${index}"><button type="button" class="top-drag-handle" data-top-drag="${index}" aria-label="Drag to reorder ${esc(project?.name || 'project')}" title="Drag to reorder" ${state.busy ? 'disabled' : ''}>${icon('grip-vertical')}</button>${project ? avatar(project) : ''}<span class="trending-item-copy"><strong>${esc(project?.name || 'Unavailable project')}</strong>${!project ? '<small>Remove this unavailable record</small>' : ''}</span><div class="actions"><button type="button" class="icon-button danger" data-top-remove="${index}" aria-label="Remove ${esc(project?.name || 'project')} from Top Airdrops" title="Remove from Top">${icon('trash-2')}</button></div></div>`;
        })
        .join('') ||
      '<div class="empty-state"><h3>No Top Airdrops Selected</h3><p>Search Above To Choose Up To 10 Projects.</p></div>';
    renderTrendingSearch();
    renderAllAirdrops();
    updateBusy();
  }
  const publishStatusTimers = new Map();
  function showPublishStatus(targetId, message, kind, detail = '') {
    clearTimeout(publishStatusTimers.get(targetId));
    const status = $(targetId);
    if (message === 'Update Saved ✓') status.innerHTML = `${icon('circle-check')}<span>Update Saved ✓</span>`;
    else if (message === 'Error Not Saved ×') status.innerHTML = `${icon('circle-x')}<span>Error Not Saved ×</span>`;
    else if (message === 'Click Publish To Save') status.innerHTML = `<span>Click Publish To Save</span>${icon('circle-check')}`;
    else status.textContent = message;
    if (message === 'Click Publish To Save') status.style.color = '#1E90FF';
    else status.style.removeProperty('color');
    status.classList.remove('is-success', 'is-error');
    if (kind) status.classList.add(kind);
    if (detail) status.title = detail;
    else status.removeAttribute('title');
    if (message) {
      publishStatusTimers.set(targetId, setTimeout(() => {
        status.textContent = '';
        status.classList.remove('is-success', 'is-error');
        status.removeAttribute('title');
      }, 5000));
    }
    icons();
  }
  function showTrendingStatus(message, kind, detail = '') {
    showPublishStatus('trendingMessage', message, kind, detail);
  }
  async function loadTrending() {
    const { data, error } = await dropyClient
      .from('site_trending_items')
      .select('project_id,position')
      .order('position', { ascending: true });
    if (error) {
      state.trendingLoaded = false;
      showTrendingStatus('Error Not Saved ×', 'is-error', `Unable to load top airdrops: ${error.message}`);
      updateBusy();
      return;
    }
    state.trending = (data || []).map((item) => item.project_id);
    state.savedTrending = [...state.trending];
    state.trendingLoaded = true;
    showTrendingStatus('', '');
    renderTrending();
    renderDashboard();
  }
  async function saveTrending() {
    if (state.busy || !state.trendingLoaded) return;
    activePublishAction = 'top';
    state.busy = true;
    updateBusy();
    const previous = [...state.savedTrending];
    let removed = false;
    let writeCompleted = false;
    try {
      const { error: deleteError } = await dropyClient
        .from('site_trending_items')
        .delete()
        .gte('position', 1);
      if (deleteError) throw deleteError;
      removed = true;
      if (state.trending.length) {
        const { error } = await dropyClient
          .from('site_trending_items')
          .insert(state.trending.map((id, index) => ({ position: index + 1, project_id: id })));
        if (error) throw error;
      }
      writeCompleted = true;
      const { data: persisted, error: readError } = await dropyClient
        .from('site_trending_items')
        .select('project_id,position')
        .order('position', { ascending: true });
      if (readError) throw readError;
      if (
        persisted.length !== state.trending.length ||
        persisted.some(
          (item, index) =>
            String(item.project_id) !== String(state.trending[index]) ||
            item.position !== index + 1,
        )
      ) {
        throw Error('The saved collection does not match your selection');
      }
      state.savedTrending = [...state.trending];
      showTrendingStatus('Update Saved ✓', 'is-success');
      renderDashboard();
    } catch (error) {
      let restoration = '';
      if (writeCompleted) {
        // A verification failure does not establish whether the write failed.
        // Avoid overwriting a possibly completed save or a concurrent admin's work.
        state.trendingLoaded = false;
        restoration = ' Reload to check the live collection before retrying.';
        renderDashboard();
      } else if (removed && previous.length) {
        const { error: restoreError } = await dropyClient
          .from('site_trending_items')
          .insert(previous.map((id, index) => ({ position: index + 1, project_id: id })));
        restoration = restoreError
          ? ' Previous selection could not be restored; reload and check before retrying.'
          : ' Previous selection was restored.';
      }
      showTrendingStatus('Error Not Saved ×', 'is-error', `Unable to save: ${error.message}.${restoration}`);
    } finally {
      state.busy = false;
      activePublishAction = null;
      updateBusy();
    }
  }
  function showAuth(view) {
    if ($('adminBoot')) $('adminBoot').hidden = true;
    $('loginBox').hidden = view !== 'login';
    $('mfaBox').hidden = view !== 'mfa';
    $('dashboard').hidden = view !== 'dashboard';
    if ($('authShell')) $('authShell').hidden = view === 'dashboard';
    $('logout').hidden = view === 'login';
    if (view === 'login' && siteKey && !turnstileWidget && !document.querySelector('script[data-airgem-turnstile]')) configureTurnstile();
  }
  async function initialize() {
    try {
      // Restore the persisted browser session before deciding which screen to show.
      // getSession reads the locally persisted session immediately; getUser then
      // validates the user with Supabase before granting access to the admin panel.
      const { data: sessionData, error: sessionError } = await dropyClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        showAuth('login');
        return;
      }
      const {
        data: { user },
        error: userError,
      } = await dropyClient.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        showAuth('login');
        return;
      }
      const { data, error } = await dropyClient
        .from('admin_users')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error || !data) {
        await dropyClient.auth.signOut();
        throw Error('Account Not Found');
      }
      // These independent MFA reads can run together to avoid an extra network round-trip.
      const [factorResult, assuranceResult] = await Promise.all([
        dropyClient.auth.mfa.listFactors(),
        dropyClient.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      const { data: factors, error: factorError } = factorResult;
      if (factorError) throw Error(`MFA check failed: ${factorError.message}`);
      const verified = factors.totp?.filter((factor) => factor.status === 'verified') || [];
      const { data: assurance, error: assuranceError } = assuranceResult;
      if (assuranceError) throw Error(`MFA assurance check failed: ${assuranceError.message}`);
      if (verified.length && assurance.currentLevel !== 'aal2') {
        pendingMfa = { id: verified[0].id, mode: 'verify' };
        $('mfaHeading').textContent = 'Authenticator';
        $('mfaInstructions').textContent = 'Enter The 6-Digit Code From Your Authenticator App';
        $('mfaQr').hidden = true;
        $('mfaSecret').textContent = '';
        $('mfaCancel').textContent = 'Log Out';
        $('mfaCode').value = '';
        $('mfaError').textContent = '';
        showAuth('mfa');
        return;
      }
      // Keep the boot screen visible until the saved page/editor is restored.
      $('mfaSetup').hidden = verified.length > 0;
      if ($('mfaStatus'))
        $('mfaStatus').textContent = verified.length
          ? 'Two-factor authentication is enabled.'
          : 'Add an authenticator app for another layer of security.';
      restoringLocation = true;
      navigate('projects', { skipGuard: true });
      restoringLocation = false;
      // Projects and Top Airdrops use independent tables, so fetch them in parallel.
      const [projectsResult, trendingResult] = await Promise.allSettled([
        refreshProjects(),
        loadTrending(),
      ]);
      if (projectsResult.status === 'rejected') {
        const error = projectsResult.reason;
        console.error('Airgem project loading failed:', error);
        message(`Unable to load projects: ${error.message}`, true);
        if ($('dataError')) {
          $('dataError').hidden = false;
          $('dataError').textContent =
            `Projects could not load. ${error.message} Reload to try again.`;
        }
      }
      if (state.dataLoaded) {
        try { restoreLocation(); }
        catch (error) {
          console.error('Airgem editor restoration failed:', error);
          message('Unable to restore the previous editor. Please select the project again.', true);
        }
      }
      if (trendingResult.status === 'rejected') {
        const error = trendingResult.reason;
        console.error('Airgem Top Airdrops loading failed:', error);
        showTrendingStatus('Unable to load Top Airdrops', 'is-error', error.message);
      }
      showAuth('dashboard');
    } catch (error) {
      showAuth('login');
      $('loginError').textContent = error.message;
    }
  }
  async function signOut() {
    if (state.view === 'editor' && !canLeaveEditor()) return;
    if (trendingDirty() && !confirm('Sign out and discard unsaved top airdrop changes?')) return;
    if (state.pendingProjectDeletes.length && !confirm('Sign out and discard pending All Airdrops deletions?')) return;
    const { error } = await dropyClient.auth.signOut();
    if (error) {
      message(`Unable to sign out: ${error.message}`, true);
      return;
    }
    clearLocation();
    state.dirty = false;
    state.projects = [];
    state.dataLoaded = false;
    state.trending = [];
    state.savedTrending = [];
    state.pendingProjectDeletes = [];
    state.trendingLoaded = false;
    showAuth('login');
  }
  async function startMfaSetup() {
    if (state.busy) return;
    try {
      $('mfaError').textContent = 'Preparing authenticator setup…';
      const { data, error } = await dropyClient.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Airgem Admin',
      });
      if (error) throw error;
      pendingMfa = { id: data.id, mode: 'enroll' };
      $('mfaHeading').textContent = 'Set up your authenticator';
      $('mfaInstructions').textContent =
        'Scan the QR code in your authenticator app, then enter its 6-digit code.';
      $('mfaQr').src = data.totp.qr_code;
      $('mfaQr').hidden = false;
      $('mfaSecret').textContent = `Manual setup key: ${data.totp.secret}`;
      $('mfaCancel').textContent = 'Cancel setup';
      $('mfaCode').value = '';
      $('mfaError').textContent = '';
      showAuth('mfa');
    } catch (error) {
      $('mfaError').textContent = `Unable to start MFA setup: ${error.message}`;
      showAuth('mfa');
    }
  }
  function positionTurnstileBetweenLoginOptions() {
    const container = $('turnstileContainer');
    const social = $('loginBox')?.querySelector('.auth-social-actions');
    const footnote = $('loginBox')?.querySelector('.auth-footnote');
    if (!container || container.hidden || !social || !footnote) return;
    const socialBottom = social.getBoundingClientRect().bottom;
    const footnoteTop = footnote.getBoundingClientRect().top;
    const availableGap = footnoteTop - socialBottom;
    const centerY = socialBottom + availableGap / 2;
    container.style.setProperty('--turnstile-center-y', `${centerY}px`);
  }
  function configureTurnstile() {
    if (!siteKey) return;
    $('turnstileContainer').hidden = false;
    const schedulePositionUpdate = () => requestAnimationFrame(positionTurnstileBetweenLoginOptions);
    requestAnimationFrame(positionTurnstileBetweenLoginOptions);
    window.addEventListener('resize', schedulePositionUpdate, { passive: true });
    window.visualViewport?.addEventListener('resize', schedulePositionUpdate, { passive: true });
    const loginBox = $('loginBox');
    const loginError = $('loginError');
    if (loginBox && window.ResizeObserver) {
      new ResizeObserver(schedulePositionUpdate).observe(loginBox);
    }
    if (loginError && window.MutationObserver) {
      new MutationObserver(schedulePositionUpdate).observe(loginError, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.dataset.airgemTurnstile = 'true';
    script.async = true;
    script.onload = () => {
      turnstileWidget = window.turnstile.render('#airgemTurnstile', {
        sitekey: siteKey,
        theme: 'light',
        size: 'normal',
        appearance: 'always',
        callback: (token) => {
          turnstileToken = token;
        },
        'expired-callback': () => {
          turnstileToken = '';
        },
        'error-callback': () => {
          turnstileToken = '';
        },
      });
      schedulePositionUpdate();
    };
    script.onerror = () => {
      $('loginError').textContent = 'The security check could not load. Reload to try again.';
    };
    document.head.append(script);
  }
  function bindEvents() {
    document.addEventListener('click', (event) => {
      const loginMenu = document.querySelector('body:not([data-view]) details.auth-menu');
      if (loginMenu?.open && !loginMenu.contains(event.target)) loginMenu.open = false;
      const addProject = event.target.closest('#addProjectButton');
      if (addProject) {
        if (!canLeaveView('editor')) return;
        state.selected = null;
        state.isNew = true;
        state.dirty = false;
        const draft = {
          name: '',
          displayTag: '',
          task: '',
          status: '',
          activityStatus: 'Active',
          funding: '',
          cost: '',
          investors: '[]',
          timeEstimate: '',
          addedOn: '',
          tge: '',
          ecosystem: '',
          started: '',
          color: '#1E90FF',
          logoUrl: '',
          links: [],
          guide: [],
        };
        editor.load(draft);
        $('title').textContent = 'Add Project';
        $('previewProject').hidden = true;
        if (!navigate('editor', { skipGuard: true })) return;
        const editorPage = $('editorView');
        editorPage.classList.remove('airgem-editor-enter', 'airgem-editor-exit');
        void editorPage.offsetWidth;
        editorPage.classList.add('airgem-editor-enter');
        setEditorTab('basic');
        $('projectsView').hidden = true;
        $('editorView').hidden = false;
        $('panel-basic')?.removeAttribute('hidden');
        updateBusy();
        return;
      }
      const edit = event.target.closest('[data-edit-project]');
      if (edit) {
        event.preventDefault();
        editProject(edit.dataset.editProject, edit.dataset.editorSection || 'basic');
        return;
      }
      const stagedDelete = event.target.closest('[data-stage-delete]');
      if (stagedDelete) {
        toggleProjectDeletion(stagedDelete.dataset.stageDelete);
        return;
      }
      const remove = event.target.closest('[data-delete-project]');
      if (remove) {
        removeProject(remove.dataset.deleteProject);
        return;
      }
      const tab = event.target.closest('[data-editor-tab]');
      if (tab) {
        setEditorTab(tab.dataset.editorTab);
        return;
      }
      const topAdd = event.target.closest('[data-top-add]');
      if (topAdd) {
        if (state.busy || !state.trendingLoaded) return;
        if (state.trending.length >= 10) {
          $('trendingMessage').textContent = 'You can select up to 10 projects.';
          return;
        }
        const project = state.projects.find((item) => String(item.id) === topAdd.dataset.topAdd);
        if (project && !state.trending.some((id) => String(id) === String(project.id)))
          state.trending.push(project.id);
        $('trendingSelect').value = '';
        showTrendingStatus('Click Publish To Save', 'is-success');
        renderTrending();
        return;
      }
      const topRemove = event.target.closest('[data-top-remove]');
      if (topRemove) {
        if (state.busy) return;
        state.trending.splice(Number(topRemove.dataset.topRemove), 1);
        renderTrending();
        showTrendingStatus('Click Publish To Save', 'is-success');
        return;
      }
    });
    // Move boxes live while dragging, with a short-lived visual highlight.
    let dragState = null;
    let dragHighlightTimer = null;
    const list = $('trendingCurrent');
    const clearDragHighlight = () => {
      clearTimeout(dragHighlightTimer);
      list.querySelectorAll('.is-dragging,.drag-target,.drag-recent').forEach((row) =>
        row.classList.remove('is-dragging', 'drag-target', 'drag-recent'));
    };
    const scheduleDragHighlightClear = () => {
      clearTimeout(dragHighlightTimer);
      dragHighlightTimer = setTimeout(clearDragHighlight, 5000);
    };
    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('#trendingCurrent [data-top-drag]') && !dragState)
        clearDragHighlight();
    }, true);
    list.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('[data-top-drag]');
      if (!handle || state.busy || !state.trendingLoaded || event.button !== 0) return;
      clearDragHighlight();
      const row = handle.closest('[data-top-row]');
      dragState = { pointerId: event.pointerId, row, originalOrder: [...state.trending] };
      // Capture on the stable list, not on a row that gets moved in the DOM.
      list.setPointerCapture(event.pointerId);
      row.classList.add('is-dragging');
      event.preventDefault();
    });
    list.addEventListener('pointermove', (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const { row } = dragState;
      const others = [...list.querySelectorAll('[data-top-row]')].filter((item) => item !== row);
      const next = others.find((item) => event.clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2);
      if (next) {
        if (row.nextElementSibling !== next) list.insertBefore(row, next);
      } else if (others.length && list.lastElementChild !== row) {
        list.appendChild(row);
      }
    });
    const finishDrag = (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const { row, originalOrder } = dragState;
      dragState = null;
      if (list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
      row.classList.remove('is-dragging');
      if (event.type === 'pointercancel') {
        state.trending = originalOrder;
        renderTrending();
        clearDragHighlight();
        return;
      }
      const order = [...list.querySelectorAll('[data-top-row]')].map((item) => originalOrder[Number(item.dataset.topRow)]);
      if (order.some((id, index) => String(id) !== String(originalOrder[index]))) {
        state.trending = order;
        renderTrending();
        showTrendingStatus('Click Publish To Save', 'is-success');
        const moved = list.querySelector('[data-top-row="' + order.findIndex((id) => String(id) === String(originalOrder[Number(row.dataset.topRow)])) + '"]');
        if (moved) moved.classList.add('drag-recent');
        scheduleDragHighlightClear();
      } else {
        clearDragHighlight();
      }
    };
    list.addEventListener('pointerup', finishDrag);
    list.addEventListener('pointercancel', finishDrag);
    let projectPickerTab = 'basic';
    const picker = $('adminProjectPicker');
    const pickerList = $('adminProjectPickerList');
    const renderProjectPicker = () => {
      $('adminProjectPickerSearchClear').hidden = !$('adminProjectPickerSearch').value.length;
      const query = $('adminProjectPickerSearch').value.trim().toLowerCase();
      const projects = state.projects.filter((project) => (project.name || '').toLowerCase().includes(query));
      pickerList.innerHTML = projects.map((project) =>
        `<button type="button" class="admin-project-picker-item trending-item" data-edit-project="${esc(String(project.id))}" data-editor-section="${projectPickerTab}">${avatar(project)}<span class="trending-item-copy"><strong>${esc(project.name)}</strong></span>${icon('chevron-right')}</button>`
      ).join('') || '<p class="trending-empty">No matching projects.</p>';
      icons();
    };
    document.querySelectorAll('[data-project-section]').forEach((button, index) => {
      button.addEventListener('click', () => {
        projectPickerTab = button.dataset.projectSection;
        currentPickerSection = projectPickerTab === 'basic' || projectPickerTab === 'details' || projectPickerTab === 'guide' ? projectPickerTab : 'dashboard';
        if (!restoringLocation) saveLocation({ section: currentPickerSection });
        $('adminProjectPickerTitle').textContent = ['All Projects', 'Basic', 'Details', 'Guide'][index];
        const pickerIcon = picker.querySelector('.top-airdrops-heading h2 svg, .top-airdrops-heading h2 i');
        if (pickerIcon) {
          const iconName = { basic: 'info', details: 'list-checks', guide: 'book-open' }[projectPickerTab] || 'layers';
          pickerIcon.outerHTML = '<i data-lucide="' + iconName + '" aria-hidden="true"></i>';
          icons();
        }
        document.querySelectorAll('[data-project-section]').forEach((item) => item.classList.toggle('active', item === button));
        const allProjects = index === 0;
        $('trendingManager').hidden = !allProjects;
        $('allAirdropsManager').hidden = !allProjects;
        picker.hidden = allProjects;
        if (!allProjects) {
          $('adminProjectPickerSearch').value = '';
          renderProjectPicker();
        }
      });
    });
    document.querySelector('[data-project-section]').classList.add('active');
    $('adminProjectPickerSearch').addEventListener('input', renderProjectPicker);
    if ($('adminProjectPickerSearchClear')) $('adminProjectPickerSearchClear').onclick = () => {
      $('adminProjectPickerSearch').value = '';
      renderProjectPicker();
      $('adminProjectPickerSearch').focus();
    };
    $('allAirdropsSearch').addEventListener('input', renderAllAirdrops);
    if ($('allAirdropsSearchClear')) $('allAirdropsSearchClear').onclick = () => {
      $('allAirdropsSearch').value = '';
      renderAllAirdrops();
      $('allAirdropsSearch').focus();
    };
    const closeEditorWithMotion = () => {
      if (!canLeaveView('projects')) return;
      const page = $('editorView');
      const finish = () => {
        page.classList.remove('airgem-editor-exit', 'airgem-editor-enter');
        navigate('projects', { skipGuard: true });
        if (currentPickerSection !== 'dashboard') document.querySelector('[data-project-section="' + currentPickerSection + '"]')?.click();
      };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finish();
        return;
      }
      page.classList.remove('airgem-editor-enter');
      page.classList.add('airgem-editor-exit');
      page.addEventListener('animationend', finish, { once: true });
    };
    if ($('backToProjects')) $('backToProjects').onclick = closeEditorWithMotion;
    if ($('cancelEdit')) $('cancelEdit').onclick = closeEditorWithMotion;
    if ($('mobileEditorBack')) $('mobileEditorBack').onclick = closeEditorWithMotion;
    if ($('mobileEditorClose')) $('mobileEditorClose').onclick = closeEditorWithMotion;
    if ($('remove')) $('remove').onclick = () => removeProject(state.selected);
    if ($('form')) $('form').onsubmit = publish;
    if ($('trendingSelect')) $('trendingSelect').oninput = renderTrendingSearch;
    if ($('trendingSearchClear')) $('trendingSearchClear').onclick = () => {
      $('trendingSelect').value = '';
      renderTrendingSearch();
      $('trendingSelect').focus();
    };
    if ($('saveTrending')) $('saveTrending').onclick = saveTrending;
    if ($('publishAllAirdrops')) $('publishAllAirdrops').onclick = publishAllAirdrops;
    if ($('logout')) $('logout').onclick = signOut;
    const adminMenu = $('adminMenu');
    const adminMenuBackdrop = $('adminMenuBackdrop');
    const adminMenuOpen = $('adminMenuOpen');
    const closeAdminMenu = () => {
      if (!adminMenu || !adminMenuBackdrop) return;
      adminMenu.classList.remove('is-open');
      adminMenuBackdrop.classList.remove('is-visible');
      adminMenu.setAttribute('aria-hidden', 'true');
      adminMenuOpen?.setAttribute('aria-expanded', 'false');
      window.setTimeout(() => {
        adminMenu.hidden = true;
        adminMenuBackdrop.hidden = true;
      }, 220);
    };
    const openAdminMenu = () => {
      if (!adminMenu || !adminMenuBackdrop) return;
      adminMenu.hidden = false;
      adminMenuBackdrop.hidden = false;
      requestAnimationFrame(() => {
        adminMenu.classList.add('is-open');
        adminMenuBackdrop.classList.add('is-visible');
      });
      adminMenu.setAttribute('aria-hidden', 'false');
      adminMenuOpen?.setAttribute('aria-expanded', 'true');
    };
    adminMenuOpen?.addEventListener('click', openAdminMenu);
    adminMenuBackdrop?.addEventListener('click', closeAdminMenu);
    $('adminMenuSettings')?.addEventListener('click', () => {
      closeAdminMenu();
      navigate('settings');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && adminMenu && !adminMenu.hidden) closeAdminMenu();
    });
    if ($('mfaSetup')) $('mfaSetup').onclick = startMfaSetup;
    if ($('passkeySetup')) $('passkeySetup').onclick = async () => {
      const button = $('passkeySetup');
      const status = $('passkeyStatus');
      button.disabled = true;
      status.textContent = 'Preparing passkey setup…';
      try {
        if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) {
          throw Error('Passkeys require a supported browser and a secure HTTPS connection.');
        }
        const { data, error } = await dropyClient.auth.registerPasskey();
        if (error) throw error;
        status.textContent = data?.friendly_name
          ? `Passkey added: ${data.friendly_name}`
          : 'Passkey added successfully.';
      } catch (error) {
        const code = error.code || error.error_code || '';
        status.textContent = code === 'passkey_disabled'
          ? 'Passkey authentication must first be enabled in Supabase.'
          : error.message || 'Unable to set up passkey.';
      } finally {
        button.disabled = false;
      }
    };
    document.addEventListener('keydown', (event) => {
      const tab = event.target.closest('[data-editor-tab]');
      if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const tabs = $$('[data-editor-tab]'),
          current = tabs.indexOf(tab);
        const index =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        setEditorTab(tabs[index].dataset.editorTab);
        tabs[index].focus();
        tabs[index].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
    window.addEventListener('beforeunload', (event) => {
      if (state.dirty || trendingDirty() || state.uploads) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    $('form').addEventListener(
      'invalid',
      (event) => {
        const panel = event.target.closest('[data-editor-panel]');
        if (panel) setEditorTab(panel.dataset.editorPanel);
      },
      true,
    );
    const socialButtons = ['githubSignIn', 'googleSignIn', 'passkeySignIn']
      .map((id) => $(id))
      .filter(Boolean);
    const setSocialBusy = (busy, activeButton = null) => {
      socialButtons.forEach((button) => {
        button.disabled = busy;
        button.setAttribute('aria-busy', busy && button === activeButton ? 'true' : 'false');
      });
    };
    const startOAuthSignIn = async (provider, button) => {
      $('loginError').classList.remove('is-info');
      $('loginError').textContent = '';
      setSocialBusy(true, button);
      try {
        const { error } = await dropyClient.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: new URL('/admin', window.location.origin).href,
            ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
          },
        });
        if (error) throw error;
      } catch (error) {
        $('loginError').textContent = error.message || 'Unable to start sign-in. Please try again.';
        setSocialBusy(false);
      }
    };
    $('githubSignIn')?.addEventListener('click', (event) => {
      startOAuthSignIn('github', event.currentTarget);
    });
    $('googleSignIn')?.addEventListener('click', (event) => {
      startOAuthSignIn('google', event.currentTarget);
    });
    $('passkeySignIn')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      $('loginError').classList.remove('is-info');
      $('loginError').textContent = '';
      if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) {
        $('loginError').textContent = 'Passkeys require a supported browser and a secure HTTPS connection.';
        return;
      }
      const captchaToken = siteKey
        ? (turnstileToken || window.turnstile?.getResponse(turnstileWidget) || '')
        : '';
      if (siteKey && !captchaToken) {
        $('loginError').textContent = 'Complete the security check before using Passkey Login.';
        return;
      }
      setSocialBusy(true, button);
      try {
        const { error } = await dropyClient.auth.signInWithPasskey({
          options: siteKey ? { captchaToken } : {},
        });
        if (error) throw error;
        await initialize();
      } catch (error) {
        const code = String(error.code || error.error_code || '').toLowerCase();
        const message = String(error.message || '');
        $('loginError').textContent = code === 'passkey_disabled'
          ? 'Passkey Login Is Not Enabled For Airgem Yet.'
          : code === 'captcha_failed'
            ? 'Security check expired. Complete it again and retry Passkey Login.'
            : code === 'webauthn_credential_not_found' || code === 'passkey_not_found' ||
              code === 'credential_not_found' ||
              /passkey (not found|does not exist)|no (matching )?(passkey|credential) found/i.test(message)
              ? 'Passkey Not Found'
              : message || 'Unable to sign in with passkey. Please try again.';
        if (siteKey && turnstileWidget !== null) {
          turnstileToken = '';
          window.turnstile?.reset(turnstileWidget);
        }
        setSocialBusy(false);
      }
    });
    let emailOtpSent = false;
    let emailOtpVerifying = false;
    const otpDigits = Array.from(document.querySelectorAll('#otpField .otp-digit'));
    const otpValue = () => otpDigits.map((input) => input.value).join('');
    const verifyEmailOtp = async () => {
      const token = otpValue();
      if (!emailOtpSent || token.length !== 6 || emailOtpVerifying) return;
      emailOtpVerifying = true;
      $('loginError').classList.add('is-info');
      $('loginError').textContent = 'Verifying code…';
      otpDigits.forEach((input) => { input.disabled = true; });
      try {
        const { error } = await dropyClient.auth.verifyOtp({
          email: $('email').value.trim(),
          token,
          type: 'email',
        });
        if (error) throw error;
        $('loginError').textContent = '';
        await initialize();
      } catch (error) {
        $('loginError').classList.remove('is-info');
        $('loginError').textContent = error.message || 'Unable to verify code. Please try again.';
        otpDigits.forEach((input) => { input.disabled = false; });
        otpDigits[5]?.focus();
        otpDigits[5]?.select();
      } finally {
        emailOtpVerifying = false;
      }
    };
    const distributeOtp = (value, startIndex = 0) => {
      const digits = String(value).replace(/\D/g, '').slice(0, 6 - startIndex);
      if (startIndex === 0) otpDigits.forEach((input) => { input.value = ''; });
      digits.split('').forEach((digit, offset) => {
        if (otpDigits[startIndex + offset]) otpDigits[startIndex + offset].value = digit;
      });
      const nextIndex = Math.min(startIndex + digits.length, 5);
      if (digits.length && digits.length < 6 - startIndex) otpDigits[nextIndex]?.focus();
      if (otpValue().length === 6) verifyEmailOtp();
    };
    $('otpField').addEventListener('paste', (event) => {
      const pasted = event.clipboardData?.getData('text') || '';
      if (!pasted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      distributeOtp(pasted, 0);
    }, true);
    otpDigits.forEach((input, index) => {
      input.addEventListener('input', () => {
        const value = input.value;
        const digits = value.replace(/\D/g, '');
        if (digits.length > 1) {
          distributeOtp(digits, index);
          return;
        }
        input.value = digits.slice(-1);
        if (input.value && index < 5) otpDigits[index + 1].focus();
        if (otpValue().length === 6) verifyEmailOtp();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value && index > 0) {
          otpDigits[index - 1].focus();
          otpDigits[index - 1].value = '';
            } else if (event.key === 'ArrowLeft' && index > 0) {
          otpDigits[index - 1].focus();
        } else if (event.key === 'ArrowRight' && index < 5) {
          otpDigits[index + 1].focus();
        }
      });
    });
    if ($('loginForm')) $('loginForm').onsubmit = async (event) => {
      event.preventDefault();
      if (emailOtpSent) return;
      const email = $('email').value.trim();
      if (!email) {
        $('email').focus();
        $('loginError').textContent = 'Enter your email address first.';
        return;
      }
      if (siteKey && !turnstileToken) {
        $('loginError').textContent = '';
        return;
      }
      const button = $('loginForm').querySelector('button[type="submit"]');
      button.disabled = true;
      $('loginError').textContent = '';
      try {
        const options = { shouldCreateUser: false };
        if (siteKey) options.captchaToken = turnstileToken;
        const { error } = await dropyClient.auth.signInWithOtp({ email, options });
        if (error) throw error;
        emailOtpSent = true;
        $('otpField').hidden = false;
        button.hidden = true;
        $('loginError').classList.add('is-info');
        $('loginError').textContent = 'A 6-Digit Code Has Been Sent To Your Email';
        otpDigits[0]?.focus();
      } catch (error) {
        $('loginError').classList.remove('is-info');
        const cooldown = error.message.match(/you can only request this after (\d+) seconds/i);
        $('loginError').textContent = /signups? not allowed for otp/i.test(error.message)
          ? 'Account Not Found'
          : cooldown
            ? `Please Wait ${cooldown[1]} Seconds Before Trying Again.`
            : error.message;
      } finally {
        if (!emailOtpSent && siteKey && turnstileWidget !== null) {
          turnstileToken = '';
          window.turnstile?.reset(turnstileWidget);
        }
        button.disabled = false;
      }
    };
    const logoutFromMfa = async () => {
      await signOut();
      if (state.view === 'login') {
        pendingMfa = null;
        $('mfaCode').value = '';
        document.querySelectorAll('#mfaBox .mfa-code-digit').forEach((input) => { input.value = ''; });
      }
    };
    const mfaSheet = $('mfaBox');
    let mfaTouchStartY = null;
    let mfaTouchStartX = 0;
    let mfaDragDelta = 0;
    mfaSheet?.addEventListener('touchstart', (event) => {
      const touch = event.touches[0];
      if (!touch || event.target.closest('input, button, a')) return;
      mfaTouchStartY = touch.clientY;
      mfaTouchStartX = touch.clientX;
      mfaDragDelta = 0;
      mfaSheet.style.transition = 'none';
    }, { passive: true });
    mfaSheet?.addEventListener('touchmove', (event) => {
      if (mfaTouchStartY === null) return;
      const touch = event.touches[0];
      if (!touch) return;
      const deltaY = touch.clientY - mfaTouchStartY;
      const deltaX = Math.abs(touch.clientX - mfaTouchStartX);
      if (Math.abs(deltaY) < 2 || Math.abs(deltaY) <= deltaX) return;
      event.preventDefault();
      mfaDragDelta = deltaY;
      mfaSheet.style.transform = `translateY(${deltaY}px)`;
    }, { passive: false });
    const finishMfaDrag = async () => {
      if (mfaTouchStartY === null) return;
      const delta = mfaDragDelta;
      const closeThreshold = mfaSheet.getBoundingClientRect().height * 0.25;
      mfaTouchStartY = null;
      mfaTouchStartX = 0;
      mfaDragDelta = 0;
      mfaSheet.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1)';
      if (delta >= closeThreshold) {
        mfaSheet.style.transform = `translateY(${window.innerHeight}px)`;
        await new Promise((resolve) => window.setTimeout(resolve, 220));
        mfaSheet.style.transition = '';
        mfaSheet.style.transform = '';
        await logoutFromMfa();
      } else {
        mfaSheet.style.transform = 'translateY(0)';
        window.setTimeout(() => {
          if (mfaSheet) {
            mfaSheet.style.transition = '';
            mfaSheet.style.transform = '';
          }
        }, 230);
      }
    };
    mfaSheet?.addEventListener('touchend', finishMfaDrag, { passive: true });
    mfaSheet?.addEventListener('touchcancel', finishMfaDrag, { passive: true });
    $('mfaCancel')?.addEventListener('click', async () => {
      if (pendingMfa?.mode === 'enroll') {
        const { error } = await dropyClient.auth.mfa.unenroll({ factorId: pendingMfa.id });
        if (error) {
          $('mfaError').textContent = error.message;
          return;
        }
        pendingMfa = null;
        $('mfaSecret').textContent = '';
        $('mfaQr').hidden = true;
        await initialize();
      } else await logoutFromMfa();
    });
    const mfaDigits = [...document.querySelectorAll('#mfaBox .mfa-code-digit')];
    const syncMfaCode = () => {
      $('mfaCode').value = mfaDigits.map((input) => input.value).join('');
    };
    const fillMfaDigits = (value, start = 0) => {
      const digits = String(value).replace(/\\D/g, '').slice(0, 6 - start);
      if (start === 0) mfaDigits.forEach((input) => { input.value = ''; });
      digits.split('').forEach((digit, index) => {
        if (mfaDigits[start + index]) mfaDigits[start + index].value = digit;
      });
      syncMfaCode();
      if (digits.length && digits.length < 6 - start) {
        mfaDigits[Math.min(start + digits.length, 5)]?.focus();
      }
      if (mfaDigits.every((input) => input.value)) $('mfaForm').requestSubmit();
    };
    mfaDigits.forEach((input, index) => {
      input.addEventListener('input', () => {
        const value = input.value;
        const digits = value.replace(/\\D/g, '');
        if (digits.length > 1) {
          fillMfaDigits(digits, index);
          return;
        }
        input.value = digits.slice(-1);
        syncMfaCode();
        if (input.value && index < 5) mfaDigits[index + 1].focus();
        if (mfaDigits.every((digit) => digit.value)) $('mfaForm').requestSubmit();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value && index > 0) {
          mfaDigits[index - 1].value = '';
          syncMfaCode();
          mfaDigits[index - 1].focus();
        } else if (event.key === 'ArrowLeft' && index > 0) mfaDigits[index - 1].focus();
        else if (event.key === 'ArrowRight' && index < 5) mfaDigits[index + 1].focus();
      });
      input.addEventListener('paste', (event) => {
        event.preventDefault();
        fillMfaDigits(event.clipboardData?.getData('text') || '', index);
      });
    });
    if ($('mfaForm')) $('mfaForm').onsubmit = async (event) => {
      event.preventDefault();
      const code = $('mfaCode').value.trim();
      if (!/^[0-9]{6}$/.test(code)) {
        $('mfaError').textContent = 'Enter a valid 6-digit code.';
        return;
      }
      const submitButton = $('mfaForm').querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      try {
        if (!pendingMfa?.id) throw Error('MFA session expired. Sign in again.');
        const { data: challenge, error: challengeError } = await dropyClient.auth.mfa.challenge({
          factorId: pendingMfa.id,
        });
        if (challengeError) throw challengeError;
        const { error } = await dropyClient.auth.mfa.verify({
          factorId: pendingMfa.id,
          challengeId: challenge.id,
          code,
        });
        if (error) throw error;
        pendingMfa = null;
        $('mfaQr').hidden = true;
        $('mfaSecret').textContent = '';
        $('mfaCode').value = '';
        mfaDigits.forEach((input) => { input.value = ''; });
        await initialize();
      } catch (error) {
        $('mfaError').textContent = error.message;
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    };
  }
  try {
    const missingResources = [];
    if (!window.dropyClient) missingResources.push('Supabase client');
    if (!window.AirgemEditor) missingResources.push('project editor module');
    if (missingResources.length)
      throw Error(`Admin resource unavailable: ${missingResources.join(' and ')}. Reload the page; if this continues, check the network or deployment files.`);
    editor = new window.AirgemEditor.ProjectEditor({
      onChange: setDirty,
      onMessage: message,
      uploadLogo: (file) => uploadFile(file, true),
      uploadImage: (file) => uploadFile(file, false),
    });
    bindEvents();
    icons();
    dropyClient.auth.onAuthStateChange?.((event) => {
      // Revoke the visible workspace immediately if the SDK signs the user out.
      if (event === 'SIGNED_OUT') {
        clearLocation();
        state.dirty = false;
        showAuth('login');
      }
    });
    await initialize();
  } catch (error) {
    $('loginError').textContent = error.message;
    showAuth('login');
  }
})();
