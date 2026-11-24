/* Customer information portal — the public form.
   One classic script, no dependencies. The token comes from the address bar; every request is made
   with that token alone. Nothing the customer types is ever written into HTML — the page is built
   with createElement and textContent, so an answer can only ever be text. */

(() => {
  'use strict';

  const app = document.getElementById('portal-app');
  const token = (() => {
    const match = window.location.pathname.match(/^\/portal\/([^/]+)\/?$/);
    try {
      return match ? decodeURIComponent(match[1]) : '';
    } catch {
      return '';
    }
  })();

  const state = {
    form: null,
    values: {},
    errors: {},
    view: 'overview',
    sectionId: null,
    latest: null,
    savedAt: null,
    saving: false,
    dirty: false,
    saveFailed: false,
    submitting: false,
    submitError: '',
    declaration: false,
    clientSubmissionId: null,
    changeTick: 0,
  };

  let saveTimer = null;
  let saveChain = Promise.resolve();

  /* ---------- small helpers ---------- */

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach((key) => {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key === 'hidden') node.hidden = Boolean(value);
      else if (key.slice(0, 2) === 'on' && typeof value === 'function')
        node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    });
    children.flat(Infinity).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return node;
  };

  const fmtDate = (value) =>
    value
      ? new Date(value).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : '';

  const fmtTime = (value) =>
    value
      ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

  const uuid = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function')
      return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  };

  const api = async (path, { method = 'GET', body = null } = {}) => {
    const response = await fetch('/api/portal/' + encodeURIComponent(token) + path, {
      method,
      credentials: 'omit',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error((data && data.error) || 'Something went wrong. Please try again.');
      error.status = response.status;
      error.code = data && data.code;
      error.fields = data && data.fields;
      throw error;
    }
    return data;
  };

  /* ---------- section and field logic ---------- */

  const allFields = (section) => section.groups.flatMap((group) => group.fields);

  const visibleByShow = (show) => {
    if (!show || show === 'tp') return state.values.case_hasTP === 'Yes';
    if (state.values.case_hasTP !== 'Yes') return false;
    const kind = { veh: 'Vehicle', inj: 'Person', prop: 'Property' }[show];
    return (Array.isArray(state.values.tp_kinds) ? state.values.tp_kinds : []).includes(kind);
  };

  const isVisible = (field) => visibleByShow(field.show);

  const isRequired = (field) => {
    if (field.req) return true;
    if (field.k === 'tp_kinds') return state.values.case_hasTP === 'Yes';
    if (field.k === 'tp_reg' || field.k === 'd2_pName' || field.k === 'tp_pWhat')
      return isVisible(field);
    return false;
  };

  const hasValue = (field) => {
    const value = state.values[field.k];
    return field.t === 'multiselect'
      ? Array.isArray(value) && value.length > 0
      : String(value == null ? '' : value).trim() !== '';
  };

  const sectionStats = (section) => {
    let total = 0;
    let done = 0;
    let answered = 0;
    allFields(section).forEach((field) => {
      if (!isVisible(field)) return;
      if (hasValue(field)) answered += 1;
      if (isRequired(field)) {
        total += 1;
        if (hasValue(field)) done += 1;
      }
    });
    return { total, done, answered, complete: total ? done === total : answered > 0 };
  };

  const missingFor = (section) =>
    allFields(section).filter((field) => isVisible(field) && isRequired(field) && !hasValue(field));

  const allMissing = () => state.form.sections.flatMap((section) => missingFor(section));

  const sectionOfKey = (key) =>
    state.form.sections.find((section) => allFields(section).some((field) => field.k === key)) ||
    null;
  const fieldOfKey = (key) => {
    for (const section of state.form.sections) {
      const found = allFields(section).find((field) => field.k === key);
      if (found) return found;
    }
    return null;
  };

  const progress = () => {
    let total = 0;
    let done = 0;
    state.form.sections.forEach((section) => {
      const stats = sectionStats(section);
      total += stats.total;
      done += stats.done;
    });
    return { total, done, pct: total ? Math.round((done / total) * 100) : 100 };
  };

  /* ---------- saving ---------- */

  const setSaveLabel = (text, tone) => {
    const box = document.getElementById('portal-save');
    if (!box) return;
    box.textContent = text;
    box.className = 'portal-save' + (tone ? ' ' + tone : '');
  };

  const paintSave = () => {
    if (state.saving) return setSaveLabel('Saving…', '');
    if (state.saveFailed) return setSaveLabel('Not saved', 'bad');
    if (state.savedAt) return setSaveLabel('Saved ' + fmtTime(state.savedAt), 'ok');
    return setSaveLabel('Answers save as you go', '');
  };

  const doSave = async () => {
    const tick = state.changeTick;
    state.saving = true;
    state.saveFailed = false;
    setSaveLabel('Saving…', '');
    try {
      const result = await api('/draft', { method: 'PUT', body: { values: state.values } });
      /* An answer typed while the save was in flight belongs to the next save, so the label must not
         claim the newer typing is already stored. */
      if (state.changeTick === tick) {
        state.savedAt = result.savedAt;
        state.dirty = false;
        state.saveFailed = false;
        setSaveLabel('Saved ' + fmtTime(result.savedAt), 'ok');
      }
      return true;
    } catch (error) {
      if (error.status === 404 || error.status === 410) {
        renderBlocked(error);
        return false;
      }
      state.saveFailed = true;
      setSaveLabel('Not saved — check connection', 'bad');
      return false;
    } finally {
      state.saving = false;
    }
  };

  const saveNow = () => {
    clearTimeout(saveTimer);
    saveChain = saveChain.then(doSave, doSave);
    return saveChain;
  };

  const scheduleSave = () => {
    state.changeTick += 1;
    /* A submit attempt belongs to the answers that were on screen when Send was pressed. Editing them
       makes the next send a new attempt, not a retry of the same one. */
    state.clientSubmissionId = null;
    state.dirty = true;
    state.saveFailed = false;
    setSaveLabel('Unsaved changes', '');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1200);
  };

  /* ---------- rendering ---------- */

  const header = () =>
    el(
      'header',
      { class: 'portal-top' },
      el('img', { src: '/assets/survey-desk-signature-horizontal.svg', alt: 'Survey Desk' }),
      el('span', { id: 'portal-save', class: 'portal-save', 'aria-live': 'polite' }, 'Answers save as you go')
    );

  const page = (...children) => el('main', { class: 'portal-page' }, ...children);

  const goOverview = () => {
    state.view = 'overview';
    state.sectionId = null;
    state.submitError = '';
    render();
  };

  const goSection = (id, focusKey) => {
    state.view = 'section';
    state.sectionId = id;
    state.submitError = '';
    render();
    if (focusKey) {
      const wrap = document.querySelector('[data-field="' + focusKey.replace(/"/g, '') + '"]');
      if (wrap) {
        wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const input = wrap.querySelector('input, select, textarea');
        if (input) setTimeout(() => input.focus({ preventScroll: true }), 120);
      }
    }
  };

  const render = () => {
    if (!state.form) return;
    app.replaceChildren(header());
    const shell = el('div', { class: 'portal-shell' });
    if (state.view === 'section') shell.append(renderSection());
    else if (state.view === 'review') shell.append(renderReview());
    else if (state.view === 'done') shell.append(renderDone());
    else shell.append(renderOverview());
    app.append(shell);
    paintSave();
  };

  const renderBlocked = (error) => {
    app.replaceChildren(
      el(
        'main',
        { class: 'portal-static' },
        el('img', { src: '/assets/survey-desk-signature-horizontal.svg', alt: 'Survey Desk' }),
        el('h1', {}, error.code === 'link_expired' ? 'This link has expired' : 'This link is no longer open'),
        el(
          'p',
          {},
          error.code === 'link_expired'
            ? 'For security, links stay open for a limited time. Ask the Survey Desk team to send you a new one — nothing you have already sent has been lost.'
            : 'The Survey Desk team closed this link. If you still need to send information, ask them for a new one.'
        ),
        el('p', { class: 'portal-foot' }, 'Survey Desk · This page never asks for a password.')
      )
    );
  };

  const renderOverview = () => {
    const progressValue = progress();
    const latest = state.latest;
    const cards = state.form.sections.map((section) => {
      const stats = sectionStats(section);
      const status = stats.complete
        ? 'Complete'
        : stats.done || stats.answered
          ? stats.total
            ? stats.done + ' of ' + stats.total + ' required'
            : 'Started'
          : 'Not started';
      return el(
        'button',
        {
          type: 'button',
          class: 'portal-card' + (stats.complete ? ' done' : ''),
          onclick: () => goSection(section.id),
        },
        el(
          'div',
          { class: 'portal-card-body' },
          el('h2', {}, section.title),
          el('p', {}, section.note)
        ),
        el('span', { class: 'portal-card-state' }, status),
        el('span', { class: 'portal-chev', 'aria-hidden': 'true' }, '›')
      );
    });

    return page(
      el('p', { class: 'portal-kicker' }, 'Customer information'),
      el('h1', {}, 'Hello, ' + state.form.customerName),
      el(
        'p',
        { class: 'portal-intro' },
        'Please complete the sections below. Your answers are saved as you go, and you can come back to this link until ' +
          fmtDate(state.form.expiresAt) +
          '.'
      ),
      el(
        'div',
        { class: 'portal-meta' },
        el('span', { class: 'portal-pill ok' }, 'Link active'),
        el('span', { class: 'portal-pill' }, 'Open until ' + fmtDate(state.form.expiresAt))
      ),
      latest
        ? el(
            'div',
            { class: 'portal-alert ok', role: 'status' },
            el('b', {}, 'Information sent'),
            el(
              'span',
              {},
              ' Version ' +
                latest.version +
                ' was received on ' +
                fmtDate(latest.submittedAt) +
                '. You can still correct it and send an update through this link.'
            )
          )
        : null,
      el(
        'div',
        { class: 'portal-progress' },
        el(
          'div',
          { class: 'portal-progress-row' },
          el('b', {}, progressValue.pct + '% complete'),
          el('span', {}, progressValue.done + ' of ' + progressValue.total + ' required answers')
        ),
        el(
          'div',
          { class: 'portal-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(progressValue.pct) },
          el('span', { style: 'width:' + progressValue.pct + '%' })
        )
      ),
      el('div', { class: 'portal-sections' }, ...cards),
      el(
        'button',
        { type: 'button', class: 'portal-btn', onclick: () => { state.view = 'review'; render(); } },
        latest ? 'Review and send an update' : 'Review and send'
      ),
      el('p', { class: 'portal-foot' }, 'Survey Desk · This page never asks for a password.')
    );
  };

  const fieldControl = (field, id) => {
    const value = state.values[field.k];
    if (field.t === 'multiselect') {
      const chosen = Array.isArray(value) ? value : [];
      return el(
        'div',
        { class: 'portal-chips', role: 'group', 'aria-label': field.l },
        ...(field.o || []).map((option) =>
          el(
            'label',
            { class: 'portal-chip' },
            (() => {
              const box = el('input', { type: 'checkbox', value: option });
              box.checked = chosen.includes(option);
              box.addEventListener('change', () => {
                const current = new Set(Array.isArray(state.values[field.k]) ? state.values[field.k] : []);
                if (box.checked) current.add(option);
                else current.delete(option);
                state.values[field.k] = [...current];
                clearError(field.k);
                scheduleSave();
                syncConditionals();
              });
              return box;
            })(),
            el('span', {}, option)
          )
        )
      );
    }

    if (field.t === 'select') {
      const select = el('select', { id });
      select.append(el('option', { value: '' }, 'Select…'));
      (field.o || []).forEach((option) => select.append(el('option', { value: option }, option)));
      select.value = value == null ? '' : String(value);
      select.addEventListener('change', () => {
        state.values[field.k] = select.value;
        clearError(field.k);
        scheduleSave();
        syncConditionals();
      });
      return select;
    }

    if (field.t === 'textarea') {
      const area = el('textarea', { id, rows: String(field.rows || 3), maxlength: '3000' });
      area.value = value == null ? '' : String(value);
      area.addEventListener('input', () => {
        state.values[field.k] = area.value;
        clearError(field.k);
        scheduleSave();
      });
      return area;
    }

    const type =
      field.t === 'date'
        ? 'date'
        : field.t === 'time'
          ? 'time'
          : field.t === 'tel'
            ? 'tel'
            : field.t === 'number'
              ? 'number'
              : 'text';
    const input = el('input', {
      id,
      type,
      inputmode: field.t === 'money' ? 'decimal' : field.t === 'tel' ? 'tel' : null,
      placeholder: field.ph || (field.t === 'money' ? '0.00' : null),
      maxlength: field.t === 'textarea' ? null : '160',
      min: field.t === 'number' && field.min != null ? String(field.min) : null,
      max: field.t === 'number' && field.max != null ? String(field.max) : null,
      step: field.t === 'number' ? (field.int ? '1' : 'any') : null,
      autocomplete: field.t === 'tel' ? 'tel' : null,
    });
    input.value = value == null ? '' : String(value);
    input.addEventListener('input', () => {
      state.values[field.k] = input.value;
      clearError(field.k);
      scheduleSave();
    });
    if (type === 'date' || type === 'time') {
      input.addEventListener('change', () => {
        state.values[field.k] = input.value;
        clearError(field.k);
        scheduleSave();
      });
    }
    return input;
  };

  const clearError = (key) => {
    if (!state.errors[key]) return;
    delete state.errors[key];
    const wrap = document.querySelector('[data-field="' + key.replace(/"/g, '') + '"]');
    if (!wrap) return;
    wrap.classList.remove('invalid');
    const note = wrap.querySelector('[data-error-for]');
    if (note) note.remove();
  };

  const fieldRow = (field) => {
    const id = 'pf_' + field.k;
    const wrap = el('div', {
      class: 'portal-field' + (state.errors[field.k] ? ' invalid' : ''),
      'data-field': field.k,
      'data-show': field.show || null,
      hidden: !isVisible(field),
    });
    const label = el(
      field.t === 'multiselect' ? 'span' : 'label',
      field.t === 'multiselect' ? {} : { for: id },
      field.l,
      el(
        'span',
        { class: 'portal-req', 'data-req-for': field.k, hidden: !isRequired(field) },
        ' *'
      )
    );
    wrap.append(label);
    wrap.append(fieldControl(field, id));
    if (state.errors[field.k]) {
      wrap.append(
        el('p', { class: 'portal-error', 'data-error-for': field.k, role: 'alert' }, state.errors[field.k])
      );
    }
    return wrap;
  };

  const syncConditionals = () => {
    document.querySelectorAll('[data-show]').forEach((wrap) => {
      wrap.hidden = !visibleByShow(wrap.getAttribute('data-show'));
    });
    document.querySelectorAll('[data-req-for]').forEach((marker) => {
      const field = fieldOfKey(marker.getAttribute('data-req-for'));
      marker.hidden = !field || !isRequired(field);
    });
  };

  const renderSection = () => {
    const section = state.form.sections.find((item) => item.id === state.sectionId) ||
      state.form.sections[0];
    const index = state.form.sections.indexOf(section) + 1;
    const body = el(
      'div',
      {},
      el(
        'button',
        { type: 'button', class: 'portal-back', onclick: goOverview },
        '‹',
        ' All sections'
      ),
      el('p', { class: 'portal-kicker' }, 'Section ' + index + ' of ' + state.form.sections.length),
      el('h1', {}, section.title),
      el('p', { class: 'portal-intro' }, section.note),
      ...section.groups.map((group) =>
        el(
          'section',
          { class: 'portal-group' },
          el('h3', {}, group.title),
          ...group.fields.map(fieldRow)
        )
      )
    );

    const actions = el(
      'div',
      { class: 'portal-actions' },
      el(
        'div',
        { class: 'portal-actions-inner' },
        el(
          'button',
          { type: 'button', class: 'portal-btn ghost', onclick: goOverview },
          'All sections'
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'portal-btn',
            onclick: async (event) => {
              const btn = event.currentTarget;
              btn.disabled = true;
              const ok = await saveNow();
              btn.disabled = false;
              if (ok) goOverview();
            },
          },
          'Save and continue'
        )
      )
    );

    return el('div', {}, body, actions);
  };

  const renderReview = () => {
    const missing = allMissing();
    const rows = state.form.sections.map((section) => {
      const stats = sectionStats(section);
      const miss = missingFor(section);
      return el(
        'div',
        { class: 'portal-review-row' },
        el(
          'div',
          { class: 'portal-review-body' },
          el('b', {}, section.title),
          el(
            'span',
            {},
            stats.total
              ? stats.done + ' of ' + stats.total + ' required answers'
              : stats.answered + ' answered'
          ),
          miss.length
            ? el(
                'ul',
                { class: 'portal-missing' },
                ...miss.map((field) =>
                  el(
                    'li',
                    {},
                    el(
                      'button',
                      { type: 'button', onclick: () => goSection(section.id, field.k) },
                      field.l
                    )
                  )
                )
              )
            : null
        ),
        el(
          'button',
          { type: 'button', class: 'portal-link', onclick: () => goSection(section.id) },
          miss.length ? 'Complete' : 'Edit'
        )
      );
    });

    const declaration = el('input', { type: 'checkbox' });
    declaration.checked = state.declaration;
    declaration.addEventListener('change', () => {
      state.declaration = declaration.checked;
      submitBtn.disabled = state.submitting || allMissing().length > 0 || !state.declaration;
    });

    const submitBtn = el(
      'button',
      {
        type: 'button',
        class: 'portal-btn',
        disabled: state.submitting || missing.length > 0 || !state.declaration,
        onclick: send,
      },
      state.submitting ? 'Sending…' : state.latest ? 'Send update' : 'Send information'
    );

    return el(
      'div',
      {},
      el(
        'button',
        { type: 'button', class: 'portal-back', onclick: goOverview },
        '‹',
        ' All sections'
      ),
      el('p', { class: 'portal-kicker' }, 'Before you send'),
      el('h1', {}, 'Review your information'),
      el(
        'p',
        { class: 'portal-intro' },
        missing.length
          ? 'Some required answers are still missing. Open a section below to finish it.'
          : 'Check that everything is correct. You can still come back and send a corrected version while this link is open.'
      ),
      state.submitError
        ? el('div', { class: 'portal-alert', role: 'alert' }, state.submitError)
        : null,
      el('div', { class: 'portal-review' }, ...rows),
      el(
        'label',
        { class: 'portal-declare' },
        declaration,
        el(
          'span',
          {},
          'I confirm that the information I have given is true and complete to the best of my knowledge.'
        )
      ),
      el(
        'div',
        { class: 'portal-actions' },
        el(
          'div',
          { class: 'portal-actions-inner' },
          el('button', { type: 'button', class: 'portal-btn ghost', onclick: goOverview }, 'Back'),
          submitBtn
        )
      )
    );
  };

  const renderDone = () => {
    const latest = state.latest;
    return page(
      el(
        'section',
        { class: 'portal-done', role: 'status' },
        el('div', { class: 'portal-check', 'aria-hidden': 'true' }, '✓'),
        el('h1', {}, 'Information received'),
        el(
          'p',
          {},
          'Thank you. Your information was sent to the Survey Desk team on ' +
            fmtDate(latest.submittedAt) +
            '.'
        ),
        el('span', { class: 'portal-pill ok' }, 'Version ' + latest.version + ' · ' + fmtTime(latest.submittedAt)),
        el(
          'p',
          {},
          'Keep this link. You can return to it and send a corrected version until ' +
            fmtDate(state.form.expiresAt) +
            '.'
        ),
        el(
          'button',
          { type: 'button', class: 'portal-btn', onclick: goOverview },
          'Review your answers'
        )
      ),
      el('p', { class: 'portal-foot' }, 'Survey Desk · This page never asks for a password.')
    );
  };

  const send = async () => {
    state.errors = {};
    state.submitError = '';
    const missing = allMissing();
    if (missing.length) {
      const first = missing[0];
      const section = sectionOfKey(first.k);
      state.submitError = 'Please complete the highlighted fields.';
      if (section) {
        goSection(section.id, first.k);
        return;
      }
    }
    if (!state.declaration) {
      state.submitError = 'Please confirm the information is complete before sending it.';
      render();
      return;
    }
    state.submitting = true;
    render();
    if (!state.clientSubmissionId) state.clientSubmissionId = uuid();
    try {
      clearTimeout(saveTimer);
      const result = await api('/submit', {
        method: 'POST',
        body: {
          values: state.values,
          declaration: true,
          clientSubmissionId: state.clientSubmissionId,
        },
      });
      state.latest = {
        version: result.submission.version,
        submittedAt: result.submission.submittedAt,
        values: Object.assign({}, state.values),
      };
      state.submitting = false;
      state.declaration = false;
      state.clientSubmissionId = null;
      state.dirty = false;
      state.savedAt = null;
      state.view = 'done';
      render();
    } catch (error) {
      state.submitting = false;
      if (error.status === 404 || error.status === 410) {
        renderBlocked(error);
        return;
      }
      if (error.fields) {
        state.errors = error.fields;
        const firstKey = Object.keys(error.fields)[0];
        const section = firstKey ? sectionOfKey(firstKey) : null;
        state.submitError = error.message || 'Please complete the highlighted fields.';
        if (section) {
          goSection(section.id, firstKey);
          return;
        }
      }
      state.submitError = error.message || 'Your information could not be sent. Please try again.';
      state.view = 'review';
      render();
    }
  };

  /* ---------- boot ---------- */

  const load = async () => {
    if (!token) {
      app.replaceChildren(
        el(
          'main',
          { class: 'portal-static' },
          el('img', { src: '/assets/survey-desk-signature-horizontal.svg', alt: 'Survey Desk' }),
          el('h1', {}, 'This link is not valid'),
          el('p', {}, 'Check that you copied the whole link from the message.')
        )
      );
      return;
    }
    try {
      const form = await api('/form');
      state.form = form;
      state.latest = form.latestSubmission || null;
      state.values =
        (form.draft && form.draft.values) ||
        (form.latestSubmission && form.latestSubmission.values) ||
        {};
      state.savedAt = form.draft ? form.draft.updatedAt : null;
      render();
    } catch (error) {
      if (error.status === 404 || error.status === 410) {
        renderBlocked(error);
        return;
      }
      app.replaceChildren(
        el(
          'main',
          { class: 'portal-static' },
          el('img', { src: '/assets/survey-desk-signature-horizontal.svg', alt: 'Survey Desk' }),
          el('h1', {}, 'The form could not be loaded'),
          el('p', {}, error.message || 'Check your connection and try again.'),
          el(
            'p',
            { class: 'portal-foot' },
            el(
              'button',
              {
                type: 'button',
                class: 'portal-btn',
                onclick: () => window.location.reload(),
              },
              'Try again'
            )
          )
        )
      );
    }
  };

  window.addEventListener('online', () => {
    if (state.form && state.dirty) saveNow();
  });

  load();
})();
