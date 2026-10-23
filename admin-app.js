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
    trendingLoaded: false,
    page: 1,
    pageSize: 5,
    category: '',
    view: 'dashboard',
    dataLoaded: false,
  };
  let editor,
    toastTimer,
    pendingMfa = null,
    turnstileWidget = null,
    turnstileToken = '';
  const siteKey = String(window.AIRGEM_TURNSTILE_SITE_KEY || '').trim();
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
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
  const statusOf = (project) => project.activityStatus || project.activity_status || 'Active';
  const categoryOf = (project) => project.category || 'Uncategorized';
  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
      category: project.category,
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
    $('saveTrending').disabled = state.busy || !state.trendingLoaded;
    $('clearTrending').disabled = state.busy || !state.trendingLoaded;
    $('trendingSelect').disabled = state.busy || !state.trendingLoaded;
    $$('[data-top-add],[data-top-remove],[data-top-move]').forEach((button) => {
      const index = Number(button.dataset.topMove),
        direction = Number(button.dataset.direction);
      button.disabled =
        state.busy ||
        (button.hasAttribute('data-top-move') &&
          (index + direction < 0 || index + direction >= state.trending.length));
    });
    $('add').disabled = state.busy;
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
  const mobileSidebar = window.matchMedia('(max-width: 640px)');
  function closeSidebar() {
    const wasOpen = $('sidebar').classList.contains('is-open');
    $('sidebar').classList.remove('is-open');
    $('sidebar').inert = mobileSidebar.matches;
    $('sidebar').removeAttribute('role');
    $('sidebar').removeAttribute('aria-modal');
    document.querySelector('.app-shell').inert = false;
    $('sidebarBackdrop').hidden = true;
    $('mobileMenu').setAttribute('aria-expanded', 'false');
    if (wasOpen && mobileSidebar.matches) $('mobileMenu').focus();
  }
  function openSidebar() {
    $('sidebar').inert = false;
    $('sidebar').classList.add('is-open');
    $('sidebar').setAttribute('role', 'dialog');
    $('sidebar').setAttribute('aria-modal', 'true');
    document.querySelector('.app-shell').inert = true;
    $('sidebarBackdrop').hidden = false;
    $('mobileMenu').setAttribute('aria-expanded', 'true');
    $('sidebar').querySelector('[data-nav]').focus();
  }
  function setEditorTab(tab) {
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
    document.body.dataset.adminView = view;
    for (const id of [
      'projectsView',
      'editorView',
      'trendingManager',
      'settingsView',
      'libraryView',
    ])
      $(id).hidden = true;
    $$('[data-nav]').forEach((button) => {
      const active = button.dataset.nav === view;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (view === 'dashboard' || view === 'projects') {
      $('projectsView').hidden = false;
      $('pageTitle').textContent = view === 'dashboard' ? 'Dashboard' : 'Projects';
      $('pageDescription').textContent =
        view === 'dashboard'
          ? 'Manage your projects, guides, investors and everything in one place.'
          : 'Organize, update and publish your Web3 opportunities.';
    } else if (view === 'editor') $('editorView').hidden = false;
    else if (view === 'top') {
      $('trendingManager').hidden = false;
      renderTrending();
    } else if (view === 'settings') $('settingsView').hidden = false;
    else {
      $('libraryView').hidden = false;
      renderLibrary(view);
    }
    closeSidebar();
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
    state.isNew = false;
    state.dirty = false;
    editor.load(project);
    $('title').textContent = `Edit ${project.name}`;
    $('previewProject').hidden = false;
    $('previewProject').href = `project.html?id=${encodeURIComponent(project.id)}`;
    navigate('editor', { skipGuard: true });
    setEditorTab(tab);
    updateBusy();
  }
  function addProject() {
    if (!canLeaveView('editor')) return;
    state.selected = null;
    state.isNew = true;
    state.dirty = false;
    editor.load({
      name: '',
      displayTag: '',
      category: 'Airdrop',
      task: '',
      status: 'Potential',
      activityStatus: 'Active',
      funding: '',
      cost: '',
      timeEstimate: '',
      addedOn: '',
      tge: '',
      ecosystem: '',
      started: '',
      color: '#1E90FF',
      logoUrl: '',
      links: [],
      investors: '',
      guide: [],
    });
    $('title').textContent = 'Add New Project';
    $('previewProject').hidden = true;
    navigate('editor', { skipGuard: true });
    setEditorTab('basic');
    updateBusy();
    $('name').focus();
  }
  async function getProjects() {
    const projects = [];
    const batchSize = 1000;
    for (let from = 0; ; from += batchSize) {
      const { data, error } = await dropyClient
        .from('projects')
        .select('*')
        .order('id', { ascending: true })
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
    renderFilters();
    renderDashboard();
    if ($('dataError')) $('dataError').hidden = true;
  }
  function groupCounts(values) {
    const counts = new Map();
    values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  function renderFilters() {
    const category = $('categoryFilter').value,
      status = $('statusFilter').value;
    const categories = [...new Set(state.projects.map(categoryOf))].sort();
    $('categoryFilter').innerHTML =
      '<option value="">Category</option>' +
      categories.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    $('statusFilter').innerHTML =
      '<option value="">Status</option>' +
      [...new Set(state.projects.map(statusOf))]
        .sort()
        .map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)
        .join('');
    if (state.category && !categories.includes(state.category)) state.category = '';
    $('categoryFilter').value = categories.includes(category) ? category : '';
    $('statusFilter').value = status;
    if ($('categoryOptions'))
      $('categoryOptions').innerHTML = [
        ...new Set(['Airdrop', 'Testnet', 'Mainnet', 'Whitelist', 'Points', 'Dex', ...categories]),
      ]
        .map((value) => `<option value="${esc(value)}"></option>`)
        .join('');
  }
  function filteredProjects() {
    const query = $('search').value.trim().toLowerCase();
    const category = $('categoryFilter').value || state.category,
      status = $('statusFilter').value;
    const rows = state.projects.filter(
      (project) =>
        (!query ||
          [
            project.name,
            project.displayTag,
            project.task,
            project.category,
            project.status,
            project.ecosystem,
          ].some((value) =>
            String(value || '')
              .toLowerCase()
              .includes(query),
          )) &&
        (!category || categoryOf(project) === category) &&
        (!status || statusOf(project) === status),
    );
    const sort = $('sortBy').value;
    const timestamp = (project) => {
      const added = Date.parse(project.addedOn || ''),
        created = Date.parse(project.created_at || '');
      return Number.isNaN(added) ? (Number.isNaN(created) ? null : created) : added;
    };
    rows.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      const left = timestamp(a),
        right = timestamp(b);
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      const difference = (left ?? 0) - (right ?? 0) || Number(a.id) - Number(b.id);
      return sort === 'oldest' ? difference : -difference;
    });
    return rows;
  }
  function avatar(project) {
    return `<span class="project-avatar">${safeURL(project.logoUrl) ? `<img src="${esc(project.logoUrl)}" alt="" loading="lazy">` : esc((project.name || 'A').slice(0, 1).toUpperCase())}</span>`;
  }
  function badgeClass(value) {
    const text = String(value).toLowerCase();
    if (['active', 'published', 'mainnet'].includes(text)) return 'green';
    if (['ended', 'archived'].includes(text)) return 'slate';
    if (['upcoming', 'draft', 'whitelist'].includes(text)) return 'amber';
    if (['points', 'dex'].includes(text)) return 'purple';
    return 'blue';
  }
  function renderTable() {
    if (!state.dataLoaded) {
      $('list').innerHTML =
        '<div class="empty-state"><h3>Projects are unavailable</h3><p>Reload to retry loading your projects.</p></div>';
      $('tableCount').textContent = 'Projects unavailable';
      $('pagination').replaceChildren();
      return;
    }
    const filtered = filteredProjects(),
      pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const offset = (state.page - 1) * state.pageSize,
      visible = filtered.slice(offset, offset + state.pageSize);
    $('list').innerHTML = visible.length
      ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Projects table, scroll horizontally to see all columns"><table class="project-table"><thead><tr><th scope="col">#</th><th scope="col">Project</th><th scope="col">Category</th><th scope="col">Type</th><th scope="col">TGE</th><th scope="col">Status</th><th scope="col">Added</th><th scope="col">Actions</th></tr></thead><tbody>${visible.map((project, index) => `<tr><td>${offset + index + 1}</td><td><button type="button" class="project-identity" data-edit-project="${esc(project.id)}">${avatar(project)}<span class="project-copy"><strong>${esc(project.name)}</strong><small>${esc(project.displayTag || project.ecosystem || 'No custom tag')}</small></span></button></td><td><span class="badge ${badgeClass(categoryOf(project))}">${esc(categoryOf(project))}</span></td><td><span class="badge ${badgeClass(project.task)}">${esc(project.task || '—')}</span></td><td>${esc(project.tge || 'TBA')}</td><td><span class="badge ${badgeClass(statusOf(project))}">${esc(statusOf(project))}</span></td><td>${esc(formatDate(project.addedOn))}</td><td><div class="row-actions"><button type="button" class="icon-button" data-edit-project="${esc(project.id)}" aria-label="Edit ${esc(project.name)}" title="Edit project">${icon('pencil')}</button><a class="icon-button" href="project.html?id=${encodeURIComponent(project.id)}" target="_blank" rel="noopener noreferrer" aria-label="Preview ${esc(project.name)}" title="Preview project">${icon('eye')}</a><button type="button" class="icon-button danger" data-delete-project="${esc(project.id)}" aria-label="Delete ${esc(project.name)}" title="Delete project">${icon('trash-2')}</button></div></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty-state">${icon('search-x')}<h3>${state.projects.length ? 'No projects found' : 'Your projects start here'}</h3><p>${state.projects.length ? 'Try a different search or filter.' : 'Add your first project to build your dashboard.'}</p></div>`;
    $('tableCount').textContent = filtered.length
      ? `Showing ${offset + 1}–${Math.min(offset + state.pageSize, filtered.length)} of ${filtered.length} projects`
      : '0 projects';
    const candidates = [...new Set([1, state.page - 1, state.page, state.page + 1, pages])]
      .filter((value) => value >= 1 && value <= pages)
      .sort((a, b) => a - b);
    let last = 0;
    $('pagination').innerHTML =
      `<button type="button" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevron-left')}</button>` +
      candidates
        .map((page) => {
          const gap = page - last > 1 ? '<span aria-hidden="true">…</span>' : '';
          last = page;
          return `${gap}<button type="button" data-page="${page}" class="${page === state.page ? 'is-active' : ''}" ${page === state.page ? 'aria-current="page"' : ''}>${page}</button>`;
        })
        .join('') +
      `<button type="button" data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''} aria-label="Next page">${icon('chevron-right')}</button>`;
    icons();
  }
  function renderCategoryTabs() {
    const categories = groupCounts(state.projects.map(categoryOf));
    $('categoryTabs').innerHTML = [['', state.projects.length], ...categories]
      .map(
        ([name, count]) =>
          `<button type="button" class="category-tab ${state.category === name ? 'is-active' : ''}" data-category="${esc(name)}" aria-pressed="${state.category === name}">${esc(name || 'All Projects')}<span>${count}</span></button>`,
      )
      .join('');
  }
  const palette = ['#1E90FF', '#57ACFF', '#FFC545', '#FB7C7C', '#9B80F5', '#34C394', '#94A3B8'];
  function renderDonut(id, entries, total) {
    const root = $(id);
    let cursor = 0;
    const colorFor = (label, index) =>
      id === 'statusChart'
        ? { active: '#34C394', ended: '#94A3B8', upcoming: '#FFC545' }[
            String(label).toLowerCase()
          ] || palette[index % palette.length]
        : palette[index % palette.length];
    const segments = entries.map((entry, index) => {
      const start = cursor;
      cursor += total ? (entry[1] / total) * 100 : 0;
      return `${colorFor(entry[0], index)} ${start}% ${cursor}%`;
    });
    root.innerHTML = `<div class="donut" style="--segments:conic-gradient(${segments.length ? segments.join(',') : '#E2E8F0 0% 100%'})" role="img" aria-label="${esc(entries.map(([label, count]) => `${label}: ${count}`).join(', ') || 'No projects')}"><div class="donut-total"><strong>${total}</strong><span>Projects</span></div></div><ul class="chart-legend">${entries.map(([label, count], index) => `<li><span class="legend-dot" style="background:${colorFor(label, index)}"></span><span>${esc(label)}</span><strong>${count}</strong></li>`).join('') || '<li>No records yet</li>'}</ul>`;
  }
  function renderOverview() {
    const months = Number($('chartRange').value) || 6,
      now = new Date();
    const buckets = Array.from({ length: months }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - months + index + 1, 1);
      return {
        year: date.getFullYear(),
        month: date.getMonth(),
        label: date.toLocaleDateString('en-US', { month: 'short' }),
        count: 0,
      };
    });
    let undated = 0;
    state.projects.forEach((project) => {
      const raw = project.addedOn || project.created_at;
      const date = raw ? new Date(raw) : null;
      if (!date || Number.isNaN(date.getTime())) {
        undated++;
        return;
      }
      const bucket = buckets.find(
        (item) => item.year === date.getFullYear() && item.month === date.getMonth(),
      );
      if (bucket) bucket.count++;
    });
    const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
    $('overviewChart').innerHTML =
      `<div class="bar-chart" role="img" aria-label="Projects added by month: ${esc(buckets.map((item) => `${item.label} ${item.year}: ${item.count}`).join(', '))}">${buckets.map((bucket) => `<div class="bar-column"><div class="bar" style="height:${(bucket.count / max) * 100}%" title="${bucket.count} projects added in ${bucket.label} ${bucket.year}"><span class="bar-value">${bucket.count}</span></div><span class="bar-label">${bucket.label}</span></div>`).join('')}</div><p class="chart-note">Projects by added date${undated ? ` · ${undated} without a date` : ''}</p>`;
  }
  function renderDashboard() {
    $('agStatProjects').textContent = state.projects.length;
    $('agStatTop').textContent = state.trendingLoaded ? `${state.savedTrending.length} / 10` : '—';
    $('agStatGuides').textContent = state.projects.reduce(
      (sum, project) =>
        sum +
        (Array.isArray(project.guide)
          ? project.guide.filter((task) => {
              const doc = new DOMParser().parseFromString(
                window.AirgemEditor.cleanHTML(task.html || task.text || ''),
                'text/html',
              );
              return doc.body.textContent.trim() || doc.querySelector('img');
            }).length
          : 0),
      0,
    );
    const investorNames = new Set(
      state.projects
        .flatMap((project) => window.AirgemEditor.parseInvestors(project.investors))
        .map((item) => item.title.trim().toLowerCase())
        .filter(Boolean),
    );
    $('agStatInvestors').textContent = investorNames.size;
    if ($('statProjectsNote'))
      $('statProjectsNote').textContent =
        `${state.projects.filter((project) => statusOf(project).toLowerCase() === 'active').length} active projects`;
    if ($('statGuidesNote')) $('statGuidesNote').textContent = 'Tasks with guide content';
    if ($('statInvestorsNote')) $('statInvestorsNote').textContent = 'Total unique investors';
    renderCategoryTabs();
    renderTable();
    renderOverview();
    renderDonut(
      'categoryChart',
      groupCounts(state.projects.map(categoryOf)),
      state.projects.length,
    );
    renderDonut('statusChart', groupCounts(state.projects.map(statusOf)), state.projects.length);
    const recent = [...state.projects]
      .filter((project) => project.addedOn || project.created_at)
      .sort((a, b) => new Date(b.addedOn || b.created_at) - new Date(a.addedOn || a.created_at))
      .slice(0, 5);
    $('recentProjects').innerHTML =
      recent
        .map(
          (project) =>
            `<li><button type="button" class="recent-item" data-edit-project="${esc(project.id)}"><span class="recent-icon">${icon('file-plus-2')}</span><span><strong>${esc(project.name)}</strong><small>Added ${esc(formatDate(project.addedOn || project.created_at))}</small></span></button></li>`,
        )
        .join('') || '<li class="empty-state">No dated projects yet.</li>';
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
    for (const [id, label] of [
      ['name', 'project name'],
      ['category', 'project category'],
    ]) {
      $(id).setCustomValidity($(id).value.trim() ? '' : `Enter a ${label}.`);
    }
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
          `Project was published, but the dashboard could not refresh: ${refreshError.message}`,
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
  function renderTrendingSearch() {
    const query = $('trendingSelect').value.trim().toLowerCase();
    const matches = query
      ? state.projects
          .filter(
            (project) =>
              !state.trending.some((id) => String(id) === String(project.id)) &&
              project.name.toLowerCase().includes(query),
          )
          .slice(0, 20)
      : [];
    $('trendingSearchResults').hidden = !query;
    $('trendingSelect').setAttribute('aria-expanded', String(Boolean(query)));
    $('trendingSearchResults').innerHTML = matches.length
      ? matches
          .map(
            (project) =>
              `<button type="button" data-top-add="${esc(project.id)}">${esc(project.name)}${icon('plus')}</button>`,
          )
          .join('')
      : '<p>No matching projects.</p>';
    icons();
  }
  function renderTrending() {
    $('trendingState').textContent = `${state.trending.length} / 10 selected`;
    if ($('trendingDisclosureLabel'))
      $('trendingDisclosureLabel').textContent = `Selected projects (${state.trending.length}/10)`;
    $('trendingCurrent').innerHTML =
      state.trending
        .map((id, index) => {
          const project = state.projects.find((item) => String(item.id) === String(id));
          return `<div class="trending-item"><span class="trending-position">${index + 1}</span>${project ? avatar(project) : ''}<span class="trending-item-copy"><strong>${esc(project?.name || 'Unavailable project')}</strong><small>${esc(project?.category || 'Remove this unavailable record')}</small></span><div class="actions"><button type="button" class="icon-button" data-top-move="${index}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move ${esc(project?.name || 'project')} up">${icon('arrow-up')}</button><button type="button" class="icon-button" data-top-move="${index}" data-direction="1" ${index === state.trending.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(project?.name || 'project')} down">${icon('arrow-down')}</button><button type="button" class="icon-button danger" data-top-remove="${index}" aria-label="Remove ${esc(project?.name || 'project')} from top airdrops">${icon('x')}</button></div></div>`;
        })
        .join('') ||
      '<div class="empty-state"><h3>No top airdrops selected</h3><p>Search above to choose up to 10 projects.</p></div>';
    renderTrendingSearch();
    updateBusy();
  }
  async function loadTrending() {
    const { data, error } = await dropyClient
      .from('site_trending_items')
      .select('project_id,position')
      .order('position', { ascending: true });
    if (error) {
      state.trendingLoaded = false;
      $('agStatTop').textContent = '—';
      $('trendingMessage').textContent = `Unable to load top airdrops: ${error.message}`;
      updateBusy();
      return;
    }
    state.trending = (data || []).map((item) => item.project_id);
    state.savedTrending = [...state.trending];
    state.trendingLoaded = true;
    $('trendingMessage').textContent = '';
    renderTrending();
    renderDashboard();
  }
  async function saveTrending() {
    if (state.busy || !state.trendingLoaded) return;
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
      $('trendingMessage').textContent = 'Top airdrops saved.';
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
      $('trendingMessage').textContent = `Unable to save: ${error.message}.${restoration}`;
    } finally {
      state.busy = false;
      updateBusy();
    }
  }
  function showAuth(view) {
    $('loginBox').hidden = view !== 'login';
    $('mfaBox').hidden = view !== 'mfa';
    $('dashboard').hidden = view !== 'dashboard';
    if ($('authShell')) $('authShell').hidden = view === 'dashboard';
    $('logout').hidden = view === 'login';
  }
  async function initialize() {
    try {
      const {
        data: { user },
        error: userError,
      } = await dropyClient.auth.getUser();
      if (!user && (!userError || userError.name === 'AuthSessionMissingError')) {
        showAuth('login');
        return;
      }
      if (userError) throw userError;
      const { data, error } = await dropyClient
        .from('admin_users')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error || !data)
        throw Error(error?.message || 'This account is not authorized as an administrator.');
      const { data: factors, error: factorError } = await dropyClient.auth.mfa.listFactors();
      if (factorError) throw Error(`MFA check failed: ${factorError.message}`);
      const verified = factors.totp?.filter((factor) => factor.status === 'verified') || [];
      const { data: assurance, error: assuranceError } =
        await dropyClient.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw Error(`MFA assurance check failed: ${assuranceError.message}`);
      if (verified.length && assurance.currentLevel !== 'aal2') {
        pendingMfa = { id: verified[0].id, mode: 'verify' };
        $('mfaHeading').textContent = 'Verify your identity';
        $('mfaInstructions').textContent = 'Enter the 6-digit code from your authenticator app.';
        $('mfaQr').hidden = true;
        $('mfaSecret').textContent = '';
        $('mfaCancel').textContent = 'Sign out';
        $('mfaCode').value = '';
        $('mfaError').textContent = '';
        showAuth('mfa');
        return;
      }
      showAuth('dashboard');
      $('accountEmail').textContent = user.email || 'Admin';
      $('mfaSetup').hidden = verified.length > 0;
      if ($('mfaStatus'))
        $('mfaStatus').textContent = verified.length
          ? 'Two-factor authentication is enabled.'
          : 'Add an authenticator app for another layer of security.';
      navigate('dashboard', { skipGuard: true });
      try {
        await refreshProjects();
        await loadTrending();
      } catch (error) {
        message(`Unable to load dashboard: ${error.message}`, true);
        renderTable();
        if ($('dataError')) {
          $('dataError').hidden = false;
          $('dataError').textContent =
            `Projects could not load. ${error.message} Reload to try again.`;
        }
      }
    } catch (error) {
      showAuth('login');
      $('loginError').textContent = error.message;
    }
  }
  async function signOut() {
    if (state.view === 'editor' && !canLeaveEditor()) return;
    if (trendingDirty() && !confirm('Sign out and discard unsaved top airdrop changes?')) return;
    const { error } = await dropyClient.auth.signOut();
    if (error) {
      message(`Unable to sign out: ${error.message}`, true);
      return;
    }
    state.dirty = false;
    state.projects = [];
    state.dataLoaded = false;
    state.trending = [];
    state.savedTrending = [];
    state.trendingLoaded = false;
    $('password').value = '';
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
  function configureTurnstile() {
    if (!siteKey) return;
    $('turnstileContainer').hidden = false;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => {
      turnstileWidget = window.turnstile.render('#airgemTurnstile', {
        sitekey: siteKey,
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
    };
    script.onerror = () => {
      $('loginError').textContent = 'The security check could not load. Reload to try again.';
    };
    document.head.append(script);
  }
  function bindEvents() {
    document.addEventListener('click', (event) => {
      const edit = event.target.closest('[data-edit-project]');
      if (edit) {
        editProject(edit.dataset.editProject, edit.dataset.editorSection || 'basic');
        return;
      }
      const remove = event.target.closest('[data-delete-project]');
      if (remove) {
        removeProject(remove.dataset.deleteProject);
        return;
      }
      const nav = event.target.closest('[data-nav]');
      if (nav) {
        navigate(nav.dataset.nav);
        return;
      }
      const action = event.target.closest('[data-action]');
      if (action) {
        action.dataset.action === 'add' ? addProject() : navigate(action.dataset.action);
        return;
      }
      const tab = event.target.closest('[data-editor-tab]');
      if (tab) {
        setEditorTab(tab.dataset.editorTab);
        return;
      }
      const category = event.target.closest('[data-category]');
      if (category) {
        state.category = category.dataset.category;
        $('categoryFilter').value = state.category;
        state.page = 1;
        renderCategoryTabs();
        renderTable();
        return;
      }
      const page = event.target.closest('[data-page]');
      if (page) {
        state.page = Number(page.dataset.page);
        renderTable();
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
        $('trendingMessage').textContent = 'Selection changed. Save top airdrops to publish.';
        renderTrending();
        return;
      }
      const topRemove = event.target.closest('[data-top-remove]');
      if (topRemove) {
        if (state.busy) return;
        state.trending.splice(Number(topRemove.dataset.topRemove), 1);
        renderTrending();
        return;
      }
      const topMove = event.target.closest('[data-top-move]');
      if (topMove) {
        if (state.busy) return;
        const from = Number(topMove.dataset.topMove),
          to = from + Number(topMove.dataset.direction);
        if (to >= 0 && to < state.trending.length)
          [state.trending[from], state.trending[to]] = [state.trending[to], state.trending[from]];
        renderTrending();
      }
    });
    $('search').oninput = () => {
      state.page = 1;
      renderTable();
    };
    $('categoryFilter').onchange = () => {
      state.category = $('categoryFilter').value;
      state.page = 1;
      renderCategoryTabs();
      renderTable();
    };
    $('statusFilter').onchange = $('sortBy').onchange = () => {
      state.page = 1;
      renderTable();
    };
    $('chartRange').onchange = renderOverview;
    $('add').onclick = addProject;
    $('backToProjects').onclick = $('cancelEdit').onclick = () => navigate('projects');
    $('remove').onclick = () => removeProject(state.selected);
    $('form').onsubmit = publish;
    $('trendingSelect').oninput = renderTrendingSearch;
    $('saveTrending').onclick = saveTrending;
    $('clearTrending').onclick = () => {
      if (state.busy || !state.trendingLoaded) return;
      if (
        !state.trending.length ||
        !confirm('Remove all selected top airdrops? Save to publish this change.')
      )
        return;
      state.trending = [];
      renderTrending();
    };
    $('logout').onclick = signOut;
    $('mfaSetup').onclick = startMfaSetup;
    $('mobileMenu').onclick = () =>
      $('sidebar').classList.contains('is-open') ? closeSidebar() : openSidebar();
    mobileSidebar.addEventListener('change', closeSidebar);
    $('sidebar').inert = mobileSidebar.matches;
    $('sidebarBackdrop').onclick = closeSidebar;
    $('closeSidebar').onclick = closeSidebar;
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
      if (
        event.key === 'Tab' &&
        mobileSidebar.matches &&
        $('sidebar').classList.contains('is-open')
      ) {
        const focusable = [...$('sidebar').querySelectorAll('a[href],button:not([disabled])')],
          first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === 'Escape') closeSidebar();
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
    $('loginForm').onsubmit = async (event) => {
      event.preventDefault();
      if (siteKey && !turnstileToken) {
        $('loginError').textContent = 'Complete the security check first.';
        return;
      }
      const button = $('loginForm').querySelector('button[type="submit"]');
      button.disabled = true;
      $('loginError').textContent = 'Signing in…';
      try {
        const options = { email: $('email').value.trim(), password: $('password').value };
        if (siteKey) options.options = { captchaToken: turnstileToken };
        const { error } = await dropyClient.auth.signInWithPassword(options);
        if (error) throw error;
        $('password').value = '';
        $('loginError').textContent = '';
        await initialize();
      } catch (error) {
        $('loginError').textContent = error.message;
      } finally {
        button.disabled = false;
        if (siteKey && turnstileWidget !== null) {
          turnstileToken = '';
          window.turnstile?.reset(turnstileWidget);
        }
      }
    };
    $('mfaCancel').onclick = async () => {
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
      } else await signOut();
    };
    $('mfaForm').onsubmit = async (event) => {
      event.preventDefault();
      const code = $('mfaCode').value.trim();
      if (!/^[0-9]{6}$/.test(code)) {
        $('mfaError').textContent = 'Enter a valid 6-digit code.';
        return;
      }
      const button = $('mfaForm').querySelector('button[type="submit"]');
      button.disabled = true;
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
        await initialize();
      } catch (error) {
        $('mfaError').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  try {
    if (typeof dropyClient === 'undefined' || !window.AirgemEditor)
      throw Error('Admin resources could not load. Check your connection and reload.');
    editor = new window.AirgemEditor.ProjectEditor({
      onChange: setDirty,
      onMessage: message,
      uploadLogo: (file) => uploadFile(file, true),
      uploadImage: (file) => uploadFile(file, false),
    });
    bindEvents();
    configureTurnstile();
    icons();
    dropyClient.auth.onAuthStateChange?.((event) => {
      // Revoke the visible workspace immediately if the SDK signs the user out.
      if (event === 'SIGNED_OUT') {
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
