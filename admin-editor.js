/* Project editor: local drafts, sanitized rich text, tasks and investors. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const safeURL = (value) => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  function cleanHTML(html) {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    const allowed = new Set([
      'P',
      'DIV',
      'BR',
      'H2',
      'H3',
      'H4',
      'STRONG',
      'B',
      'EM',
      'I',
      'U',
      'A',
      'IMG',
      'UL',
      'OL',
      'LI',
      'BLOCKQUOTE',
      'SPAN',
    ]);
    const classes = new Set([
      'guide-step-box',
      'dh-custom-title',
      'dh-custom-body',
      'dh-daily-box',
      'dh-note-box',
      'dh-info-box',
    ]);
    function walk(parent) {
      for (const node of [...parent.childNodes]) {
        if (node.nodeType === Node.COMMENT_NODE) {
          node.remove();
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'BUTTON'].includes(node.tagName)) {
          node.remove();
          continue;
        }
        if (!allowed.has(node.tagName)) {
          walk(node);
          node.replaceWith(...node.childNodes);
          continue;
        }
        const keepClasses = [...node.classList].filter((name) => classes.has(name));
        const href = safeURL(node.getAttribute('href')),
          src = safeURL(node.getAttribute('src'));
        const alt = node.getAttribute('alt'),
          align = node.style.textAlign,
          whiteSpace = node.style.whiteSpace;
        for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
        if (keepClasses.length) node.className = keepClasses.join(' ');
        if (['left', 'center', 'right'].includes(align)) node.style.textAlign = align;
        if (whiteSpace === 'pre-wrap') node.style.whiteSpace = whiteSpace;
        if (node.tagName === 'A' && href) {
          node.href = href;
          node.rel = 'noopener noreferrer';
          node.target = '_blank';
        }
        if (node.tagName === 'IMG') {
          if (!src) {
            node.remove();
            continue;
          }
          node.src = src;
          node.alt = alt || 'Guide image';
          node.loading = 'lazy';
        }
        walk(node);
      }
    }
    walk(doc.body);
    return doc.body.innerHTML;
  }
  function parseInvestors(raw) {
    if (
      String(raw || '')
        .trim()
        .toUpperCase() === 'N/A'
    )
      return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return parsed.map((item) => ({
          title: String(item.title || ''),
          subtitle: String(item.subtitle || ''),
          logo: String(item.logo || ''),
        }));
    } catch {
      /* Older records contain a comma-separated list. */
    }
    return String(raw || '')
      .split(/[,;\n]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        const match = value.match(/^(.*?)\s*\|\s*(?:Tier\s*)?([123])$/i);
        return {
          title: match ? match[1].trim() : value,
          subtitle: match ? `Tier ${match[2]}` : '',
          logo: '',
        };
      });
  }
  class ProjectEditor {
    constructor({ onChange, onMessage, uploadLogo, uploadImage }) {
      this.onChange = onChange;
      this.message = onMessage;
      this.uploadLogo = uploadLogo;
      this.uploadImage = uploadImage;
      this.project = null;
      this.tasks = [];
      this.taskIndex = 0;
      this.investors = [];
      this.selectedBox = null;
      this.range = null;
      this.element = $('guideEditor');
      this.bind();
    }
    changed() {
      this.onChange();
    }
    load(project) {
      this.project = structuredClone(project);
      this.originalGuideWasEmpty = !Array.isArray(project.guide) || !project.guide.length;
      const values = {
        ...project,
        timeEstimate: project.timeEstimate ?? project.time ?? '',
        started: project.started ?? project.launch_date ?? '',
      };
      for (const key of [
        'name',
        'displayTag',
        'task',
        'status',
        'activityStatus',
        'funding',
        'cost',
        'timeEstimate',
        'addedOn',
        'tge',
        'ecosystem',
        'started',
        'color',
        'logoUrl',
      ]) {
        const input = $(key);
        if (input) {
          const value = values[key] ?? (key === 'color' ? '#1E90FF' : '');
          if (
            input.tagName === 'SELECT' &&
            value &&
            ![...input.options].some((option) => option.value === value)
          )
            input.add(new Option(value, value));
          input.value = value;
        }
      }
      this.investors = parseInvestors(project.investors);
      $('agInvestorsNA').checked =
        String(project.investors || '')
          .trim()
          .toUpperCase() === 'N/A';
      this.renderInvestors();
      this.syncNA();
      this.renderLinks(project.links || []);
      this.tasks =
        Array.isArray(project.guide) && project.guide.length
          ? structuredClone(project.guide)
          : [
              {
                title: 'Full Airdrop Guide',
                status: 'Active',
                html:
                  project.guideHtml ??
                  project.guide_html ??
                  project.descriptionHtml ??
                  project.description_html ??
                  project.description ??
                  '',
              },
            ];
      this.taskIndex = 0;
      this.showTask();
      this.logoPreview();
      $('logoFile').value = '';
    }
    collect() {
      const project = { ...this.project };
      for (const key of [
        'name',
        'displayTag',
        'task',
        'status',
        'activityStatus',
        'funding',
        'cost',
        'timeEstimate',
        'addedOn',
        'tge',
        'ecosystem',
        'started',
        'color',
        'logoUrl',
      ])
        if ($(key)) project[key] = $(key).value.trim();
      if (!project.name) throw Error('Enter a project name.');
      if (!project.task) throw Error('Choose a project type.');
      project.category = project.task;
      project.investors = $('agInvestorsNA').checked
        ? 'N/A'
        : JSON.stringify(
            this.investors
              .filter((item) => item.title.trim())
              .map((item) => ({
                ...item,
                title: item.title.trim(),
                subtitle: item.subtitle.trim(),
              })),
          );
      const editedLinks = [...$('basicLinks').querySelectorAll('.link-url')]
        .filter((input) => input.value.trim())
        .map((input) => {
          const url = safeURL(input.value.trim());
          if (!url) throw Error(`Enter a valid http:// or https:// ${input.dataset.type} URL.`);
          return { label: input.dataset.type, url };
        });
      // Keep custom links not represented by the three social controls.
      project.links = [
        ...(this.project.links || []).filter((link) => !this.socialType(link.label)),
        ...editedLinks,
      ];
      this.saveTask();
      project.guide = this.tasks.map((task) => ({ ...task, html: cleanHTML(task.html || '') }));
      const onlyTask = project.guide[0];
      if (
        this.originalGuideWasEmpty &&
        project.guide.length === 1 &&
        onlyTask.title === 'Full Airdrop Guide' &&
        onlyTask.status === 'Active' &&
        !onlyTask.html &&
        !onlyTask.subtitle &&
        !onlyTask.tag
      )
        project.guide = [];
      return project;
    }
    socialType(label) {
      const value = String(label || '')
        .toLowerCase()
        .trim();
      if (['website', 'official website', 'official link'].includes(value)) return 'Website';
      if (value.includes('discord')) return 'Discord';
      if (['x', 'twitter'].includes(value)) return 'X';
      return null;
    }
    renderLinks(links) {
      const fields = ['Website', 'Discord', 'X']
        .map((type) => {
          const link = links.find((item) => this.socialType(item.label) === type);
          return `<div class="field"><label for="link${type}">${type}</label><input id="link${type}" class="link-url" data-type="${type}" type="url" placeholder="http://example.com" value="${escape(link?.url || '')}"></div>`;
        })
        .join('');
      $('links').innerHTML = fields;
      $('basicLinks').innerHTML = ['Website', 'Discord', 'X']
        .map((type) => {
          const link = links.find((item) => this.socialType(item.label) === type);
          return `<div class="field"><label for="basicLink${type}">${type}</label><input id="basicLink${type}" class="link-url" data-type="${type}" type="url" placeholder="http://example.com" value="${escape(link?.url || '')}"></div>`;
        })
        .join('');
      for (const root of [$('links'), $('basicLinks')]) {
        root.querySelectorAll('.link-url').forEach((input) => {
          input.addEventListener('input', () => {
            const otherRoot = root.id === 'links' ? $('basicLinks') : $('links');
            const other = otherRoot.querySelector(`.link-url[data-type="${input.dataset.type}"]`);
            if (other && other.value !== input.value) other.value = input.value;
          });
        });
      }
    }
    logoPreview() {
      const root = $('logoPreview');
      root.replaceChildren();
      const url = safeURL($('logoUrl').value.trim());
      if (!url) {
        root.textContent = ($('name').value || 'A').slice(0, 1).toUpperCase();
        this.syncSharedLogoPreviews();
        return;
      }
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Project logo';
      img.onerror = () => {
        root.textContent = 'A';
      };
      root.append(img);
      this.syncSharedLogoPreviews();
    }
    syncSharedLogoPreviews() {
      const source = $('logoPreview');
      for (const id of ['detailsLogoPreview', 'guideLogoPreview']) {
        const target = $(id);
        if (target && source) target.replaceChildren(...Array.from(source.childNodes, node => node.cloneNode(true)));
      }
    }
    saveTask() {
      const task = this.tasks[this.taskIndex];
      if (!task) return;
      task.title = $('agTaskTitle').value;
      task.status = $('agTaskStatus').value;
      task.subtitle = $('agTaskDate').value.trim();
      task.tag = $('agTaskTag').value;
      task.html = cleanHTML(this.element.innerHTML);
      delete task.availableFrom;
    }
    showTask() {
      const task = this.tasks[this.taskIndex];
      this.selectedBox = null;
      $('agTaskTabs').replaceChildren();
      this.tasks.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.title || `Task ${index + 1}`;
        button.className = index === this.taskIndex ? 'active' : '';
        button.setAttribute('aria-pressed', String(index === this.taskIndex));
        button.onclick = () => {
          this.saveTask();
          this.taskIndex = index;
          this.showTask();
        };
        $('agTaskTabs').append(button);
      });
      $('agTaskTitle').value = task.title || '';
      $('agTaskStatus').value =
        { Open: 'Active', 'Coming Soon': 'Upcoming' }[task.status] || task.status || 'Active';
      $('agTaskDate').value =
        task.subtitle ?? (task.availableFrom ? `Available from ${task.availableFrom}` : '');
      $('agTaskTag').value = task.tag || '';
      this.element.innerHTML = cleanHTML(
        task.html || (task.text ? `<p>${escape(task.text).replace(/\n/g, '<br>')}</p>` : ''),
      );
      $('agTaskRemove').disabled = this.tasks.length < 2;
      this.updateStepSelection();
    }
    syncNA() {
      const selected = $('agInvestorsNA').checked;
      $('agBasicInvestorsNA').checked = selected;
      [['agInvestorList', 'agSetInvestorsNA', 'investorsNAHelp'], ['agBasicInvestorList', 'agBasicSetInvestorsNA', 'agBasicInvestorsNAHelp']].forEach(([listId, buttonId, helpId]) => {
        $(listId).hidden = selected;
        $(buttonId).setAttribute('aria-pressed', String(selected));
        if ($(helpId)) $(helpId).hidden = !selected;
      });
    }
    renderInvestors() {
      const roots = [$('agInvestorList'), $('agBasicInvestorList')];
      roots.forEach((root) => root.replaceChildren());
      this.investors.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'ag-investor-editor-item';
        const photo = document.createElement('div');
        photo.className = 'ag-investor-photo-wrap';
        const preview = document.createElement('div');
        preview.className = 'ag-investor-photo';
        if (safeURL(item.logo)) {
          const img = document.createElement('img');
          img.src = item.logo;
          img.alt = '';
          preview.append(img);
        } else preview.textContent = '?';
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/png,image/jpeg,image/webp,image/gif';
        file.className = 'sr-only';
        file.setAttribute('aria-label', `Upload logo for investor ${index + 1}`);
        preview.setAttribute('role', 'button');
        preview.setAttribute('tabindex', '0');
        preview.setAttribute('aria-label', `Choose logo for investor ${index + 1}`);
        preview.title = 'Click to upload investor logo';
        preview.append(file);
        preview.onclick = () => file.click();
        preview.onkeydown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            file.click();
          }
        };
        photo.append(preview);
        file.onchange = async () => {
          const chosen = file.files?.[0];
          if (!chosen) return;
          try {
            file.disabled = true;
            this.message('Uploading investor logo…');
            item.logo = await this.uploadLogo(chosen);
            this.changed();
            this.renderInvestors();
            this.message('Logo uploaded. Publish changes to save.');
          } catch (error) {
            this.message(error.message, true);
          } finally {
            file.disabled = false;
          }
        };
        const fields = document.createElement('div');
        fields.className = 'ag-investor-fields';
        for (const [key, label, placeholder] of [
          ['title', 'Investor', 'Name...'],
        ]) {
          const wrap = document.createElement('label');
          wrap.textContent = label;
          const input = document.createElement('input');
          input.type = 'text';
          input.placeholder = placeholder;
          input.value = item[key];
          input.oninput = () => {
            item[key] = input.value;
            this.changed();
          };
          wrap.append(input);
          fields.append(wrap);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-button danger';
        remove.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
        remove.setAttribute('aria-label', `Remove investor ${index + 1}`);
        remove.title = 'Remove investor';
        remove.onclick = () => {
          this.investors.splice(index, 1);
          this.renderInvestors();
          this.changed();
        };
        card.append(photo, fields, remove);
        roots.forEach((root) => root.append(card.cloneNode(true)));
      });
      // Bind identical controls in both locations to the same investor data.
      roots.forEach((root) => {
        [...root.children].forEach((card, index) => {
          const item = this.investors[index];
          const file = card.querySelector('input[type="file"]');
          file.onchange = async () => {
            const chosen = file.files?.[0];
            if (!chosen) return;
            try {
              file.disabled = true;
              this.message('Uploading investor logo…');
              item.logo = await this.uploadLogo(chosen);
              this.changed();
              this.renderInvestors();
              this.message('Logo uploaded. Publish changes to save.');
            } catch (error) {
              this.message(error.message, true);
            } finally { file.disabled = false; }
          };
          const inputs = card.querySelectorAll('.ag-investor-fields input');
          if (inputs[0]) inputs[0].oninput = () => { item.title = inputs[0].value; this.changed(); };
          const preview = card.querySelector('.ag-investor-photo');
          preview.onclick = () => file.click();
          preview.onkeydown = (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              file.click();
            }
          };
          card.querySelector('button[aria-label^="Remove investor"]').onclick = () => {
            this.investors.splice(index, 1);
            this.renderInvestors();
            this.changed();
          };
        });
      });
      window.lucide?.createIcons();
    }
    captureRange() {
      const selection = window.getSelection();
      if (selection?.rangeCount && this.element.contains(selection.anchorNode))
        this.range = selection.getRangeAt(0).cloneRange();
    }
    restoreRange() {
      this.element.focus();
      const selection = window.getSelection();
      const range =
        this.range && this.element.contains(this.range.commonAncestorContainer)
          ? this.range
          : document.createRange();
      if (range !== this.range) {
        range.selectNodeContents(this.element);
        range.collapse(false);
      }
      selection.removeAllRanges();
      selection.addRange(range);
      return range;
    }
    updateStepSelection() {
      if (this.selectedBox && !this.element.contains(this.selectedBox)) this.selectedBox = null;
      if ($('guideDeleteStepBox')) $('guideDeleteStepBox').disabled = !this.selectedBox;
      if ($('guideEditStepBox')) $('guideEditStepBox').disabled = !this.selectedBox;
    }
    stepBox(text, url) {
      const box = document.createElement('div');
      box.className = 'guide-step-box';
      const label = document.createElement('strong');
      label.textContent = text || 'Join now';
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.append(label);
        box.append(link);
      } else box.append(label);
      return box;
    }
    editStep(isNew) {
      if (!isNew && !this.selectedBox) return;
      const text = prompt('Step button text:', isNew ? 'Join now' : this.selectedBox.textContent);
      if (text === null) return;
      const enteredURL = prompt(
        'Button link (leave empty for no link):',
        isNew ? '' : this.selectedBox.querySelector('a')?.href || '',
      );
      if (enteredURL === null) return;
      const url = enteredURL.trim() ? safeURL(enteredURL.trim()) : '';
      if (enteredURL.trim() && !url) {
        this.message('Enter a valid http:// or https:// link.', true);
        return;
      }
      const box = this.stepBox(text.trim(), url);
      this.element
        .querySelectorAll('.selected-step-box')
        .forEach((node) => node.classList.remove('selected-step-box'));
      if (isNew) this.element.append(box, document.createElement('p'));
      else this.selectedBox.replaceWith(box);
      this.selectedBox = box;
      box.classList.add('selected-step-box');
      this.updateStepSelection();
      this.changed();
    }
    infoBox(type) {
      const daily = type === 'daily';
      const title = daily ? prompt('Update title:', 'Daily Task Update') : null;
      if (daily && title === null) return;
      const text = prompt(daily ? 'Update text:' : 'Important note:', '');
      if (text === null) return;
      const box = document.createElement('div');
      box.className = `dh-info-box ${daily ? 'dh-daily-box' : 'dh-note-box'}`;
      if (daily) {
        const heading = document.createElement('div');
        heading.className = 'dh-custom-title';
        heading.textContent = title || 'Daily Task Update';
        const body = document.createElement('div');
        body.className = 'dh-custom-body';
        body.style.whiteSpace = 'pre-wrap';
        body.textContent = text;
        box.append(heading, body);
      } else box.textContent = text;
      this.element.append(box, document.createElement('p'));
      this.changed();
    }
    bind() {
      $('form').addEventListener('input', () => this.changed());
      $('form').addEventListener('change', () => this.changed());
      $('agTaskAdd').onclick = () => {
        this.saveTask();
        this.tasks.push({ title: `Task ${this.tasks.length + 1}`, status: 'Active', html: '' });
        this.taskIndex = this.tasks.length - 1;
        this.showTask();
        this.changed();
      };
      $('agTaskRemove').onclick = () => {
        if (this.tasks.length < 2) return;
        this.tasks.splice(this.taskIndex, 1);
        this.taskIndex = Math.min(this.taskIndex, this.tasks.length - 1);
        this.showTask();
        this.changed();
      };
      const addInvestor = () => {
        $('agInvestorsNA').checked = false;
        this.syncNA();
        this.investors.push({ title: '', subtitle: '', logo: '' });
        this.renderInvestors();
        this.changed();
      };
      const toggleInvestorsNA = () => {
        $('agInvestorsNA').checked = !$('agInvestorsNA').checked;
        this.syncNA();
        this.changed();
      };
      $('agAddInvestor').onclick = addInvestor;
      $('agBasicAddInvestor').onclick = addInvestor;
      $('agSetInvestorsNA').onclick = toggleInvestorsNA;
      $('agBasicSetInvestorsNA').onclick = toggleInvestorsNA;
      $('agInvestorsNA').onchange = () => {
        this.syncNA();
        this.changed();
      };
      $('agBasicInvestorsNA').onchange = () => {
        $('agInvestorsNA').checked = $('agBasicInvestorsNA').checked;
        this.syncNA();
        this.changed();
      };
      $('logoFile').onchange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          event.target.disabled = true;
          this.message('Uploading project logo…');
          $('logoUrl').value = await this.uploadLogo(file);
          this.logoPreview();
          this.changed();
          this.message('Logo uploaded. Publish changes to save.');
        } catch (error) {
          this.message(error.message, true);
        } finally {
          event.target.disabled = false;
        }
      };
      $('clearLogo').onclick = () => {
        $('logoUrl').value = '';
        this.logoPreview();
        this.changed();
      };
      $('name').addEventListener('input', () => this.logoPreview());
      this.element.addEventListener('keyup', () => this.captureRange());
      this.element.addEventListener('mouseup', () => this.captureRange());
      this.element.addEventListener('click', (event) => {
        if (event.target.closest('a')) event.preventDefault();
        this.element
          .querySelectorAll('.selected-step-box')
          .forEach((node) => node.classList.remove('selected-step-box'));
        this.selectedBox = event.target.closest('.guide-step-box');
        this.selectedBox?.classList.add('selected-step-box');
        this.updateStepSelection();
      });
      $('guideToolbar').addEventListener('mousedown', (event) => {
        if (event.target.closest('button')) event.preventDefault();
      });
      $('guideToolbar')
        .querySelectorAll('[data-cmd]')
        .forEach(
          (button) =>
            (button.onclick = () => {
              this.restoreRange();
              document.execCommand(button.dataset.cmd, false, button.dataset.val || null);
              this.captureRange();
              this.changed();
            }),
        );
      $('guideLink').onclick = () => {
        const value = prompt('Enter an http:// or https:// link:');
        if (!value) return;
        const url = safeURL(value);
        if (!url) {
          this.message('Enter a valid link.', true);
          return;
        }
        this.restoreRange();
        document.execCommand('createLink', false, url);
        this.captureRange();
        this.changed();
      };
      $('guideStepBox').onclick = () => this.editStep(true);
      if ($('guideEditStepBox')) $('guideEditStepBox').onclick = () => this.editStep(false);
      if ($('guideDeleteStepBox'))
        $('guideDeleteStepBox').onclick = () => {
          this.selectedBox?.remove();
          this.selectedBox = null;
          this.updateStepSelection();
          this.changed();
        };
      $('guideDaily').onclick = () => this.infoBox('daily');
      $('guideNote').onclick = () => this.infoBox('note');
      $('guideImage').onclick = () => {
        this.captureRange();
        $('guideImageFile').click();
      };
      $('guideImageFile').onchange = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const button = $('guideImage');
        button.disabled = true;
        try {
          this.message('Uploading guide image…');
          const url = await this.uploadImage(file);
          const img = document.createElement('img');
          img.src = url;
          img.alt = 'Guide image';
          img.loading = 'lazy';
          const range = this.restoreRange();
          range.deleteContents();
          range.insertNode(img);
          range.setStartAfter(img);
          range.collapse(true);
          this.range = range;
          this.changed();
          this.message('Image added. Publish changes to save.');
        } catch (error) {
          this.message(error.message, true);
        } finally {
          button.disabled = false;
        }
      };
      $('guideClear').onclick = () => {
        if (!confirm('Clear this task’s entire guide?')) return;
        this.element.replaceChildren();
        this.selectedBox = null;
        this.updateStepSelection();
        this.changed();
      };
      $('guidePreview').onclick = () => {
        $('guidePreviewContent').innerHTML =
          cleanHTML(this.element.innerHTML) || '<p>Guide is empty.</p>';
        $('guidePreviewOverlay').showModal();
      };
      $('guidePreviewClose').onclick = () => $('guidePreviewOverlay').close();
    }
  }
  window.AirgemEditor = { ProjectEditor, cleanHTML, parseInvestors, safeURL, escape };
})();
