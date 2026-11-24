/* System settings: the screen the sidebar's "System Settings" opens.
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters.

   These used to be a <details> panel at the bottom of the dashboard, which meant the sidebar item had to
   scroll a long page to reach its own content. The settings are the same ones, plus the required-document
   checklist per case type: a case only asks for the papers its own type needs, and the list lives here
   rather than inside each case so one change reaches every case of that type. */

/* What every case type asks for until an administrator says otherwise. Held in this file rather than
   written into cfg on first paint: a default nobody chose should not look like a decision, and deleting
   the key is how the editor returns to the standard set. */
const SYS_STANDARD_DOCS = [
  'Policy',
  'Intimation',
  'Inspection Photos',
  'Estimates',
  'Bills',
  'Reports',
];

/* Only used before the server's vocabulary has reached this device. The categories the document routes
   accept are the authority; this is what a cold offline start can still show. */
const SYS_DOC_FALLBACK = [
  'Policy',
  'Intimation',
  'Inspection Photos',
  'Estimates',
  'Bills',
  'Legal Documents',
  'Reports',
  'Other Documents',
];

const sysDocKey = (mod, type) => String(mod || 'motor') + '|' + String(type || '');

const sysDocCategories = () => {
  const vocab = typeof dvVocab === 'function' ? dvVocab() : {};
  const list =
    vocab && Array.isArray(vocab.categories) && vocab.categories.length
      ? vocab.categories
      : SYS_DOC_FALLBACK;
  return list.slice();
};

/* One answer for the settings editor and the case Documents tab, so the list a surveyor is shown is
   always the list the administrator saved. */
function requiredDocsFor(mod, type) {
  const saved = cfg && cfg.docs ? cfg.docs[sysDocKey(mod, type)] : null;
  if (!Array.isArray(saved)) return SYS_STANDARD_DOCS.slice();
  return saved
    .map((item) => String(item == null ? '' : item).trim())
    .filter((item, index, all) => item && all.indexOf(item) === index);
}

const sysDocsAreCustom = (mod, type) =>
  !!(cfg && cfg.docs && Array.isArray(cfg.docs[sysDocKey(mod, type)]));

function sysSaveDocs(mod, type, list) {
  const seen = new Set();
  const clean = [];
  list.forEach((item) => {
    const name = String(item == null ? '' : item).trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      clean.push(name);
    }
  });
  cfg.docs = cfg.docs || {};
  cfg.docs[sysDocKey(mod, type)] = clean;
  saveCfg();
  return clean;
}

function sysResetDocs(mod, type) {
  if (!cfg.docs) return;
  delete cfg.docs[sysDocKey(mod, type)];
  saveCfg();
}

function sysCaseTypeList() {
  const out = [];
  if (typeof CT !== 'undefined' && Array.isArray(CT))
    CT.forEach((type) => out.push({ mod: 'motor', kind: 'Motor', type }));
  if (typeof PCT !== 'undefined' && Array.isArray(PCT))
    PCT.forEach((type) => out.push({ mod: 'property', kind: 'Property', type }));
  return out;
}

function showSystemSettings() {
  const el = $('#dash');
  if (!el) return;
  const authUser = getCurrentAuthUser();
  if (!authUser) {
    showDash();
    return;
  }

  view = 'settings';
  /* Leaving a case for this page is still leaving a case: the open case is written first, exactly as
     every other route back to a dashboard screen does. */
  if (cur && DB[cur]) sv(1);
  el.hidden = false;
  el.classList.remove('dash-cases');
  $('.app').hidden = true;
  ['#cs', '#del', '#dx'].forEach((selector) => {
    const btn = $(selector);
    if (btn) btn.hidden = true;
  });
  const caseMenu = $('#cm'),
    caseTools = $('#ct');
  if (caseMenu) caseMenu.hidden = true;
  if (caseTools) caseTools.hidden = true;

  syncAccountSidebarVisibility();
  const isAdmin = normalizeServerRole(authUser.role) === 'ADMIN';
  const mayManage = mayUse('manage_system_settings', isAdmin);

  const savedPill = h('span', { class: 'sys-saved', hidden: true }, 'Saved');
  let savedTimer = 0;
  const flashSaved = () => {
    savedPill.hidden = false;
    savedPill.classList.remove('pop');
    void savedPill.offsetWidth;
    savedPill.classList.add('pop');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      savedPill.hidden = true;
    }, 1600);
  };

  const settingField = (label, input, wide) =>
    h(
      'div',
      { class: 'setting-field' + (wide ? ' sys-wide' : '') },
      h('label', {}, label),
      input
    );

  /* ── access and role ──────────────────────────────────────────────────────────────── */

  const roleSelect = h(
    'select',
    {},
    ...ROLE_VIEWS.map((role) => h('option', { value: role }, role))
  );
  roleSelect.value = cfg.role;
  roleSelect.disabled = !isAdmin;
  roleSelect.onchange = () => {
    cfg.role = roleSelect.value;
    saveCfg();
    FL.k = FL.s = '';
    if (typeof hdr === 'function') hdr();
    flashSaved();
  };

  const nameInput = h('input', { maxlength: '60' });
  nameInput.value = cfg.me;
  nameInput.disabled = !isAdmin;
  nameInput.onchange = () => {
    cfg.me = nameInput.value.trim() || 'Surveyor';
    saveCfg();
    flashSaved();
  };

  const accessCard = h(
    'section',
    { class: 'sys-card', id: 'sys-access', style: '--i:0' },
    h(
      'div',
      { class: 'sys-card-head' },
      h('span', { class: 'sys-card-ic' }, '👤'),
      h(
        'div',
        {},
        h('h2', {}, 'Roles & access'),
        h(
          'p',
          {},
          'Who this device shows, and the name the case list filters on. The server decides access on every request; these settings decide what is put in front of you.'
        )
      )
    ),
    h(
      'div',
      { class: 'sys-card-body' },
      h(
        'div',
        { class: 'sys-form-grid' },
        settingField(
          isAdmin ? 'Preview the layout for' : 'Your role (from your account)',
          roleSelect
        ),
        settingField('My name (cases assigned to me)', nameInput)
      ),
      h(
        'div',
        { class: 'sys-roles' },
        h(
          'div',
          { class: 'sys-role' },
          h('b', {}, 'Admin'),
          h('span', {}, 'All cases · deadlines · delete')
        ),
        h(
          'div',
          { class: 'sys-role' },
          h('b', {}, 'Principal Surveyor'),
          h('span', {}, 'All cases · reassignment')
        ),
        h(
          'div',
          { class: 'sys-role' },
          h('b', {}, 'Staff'),
          h('span', {}, 'Only cases assigned to them')
        )
      ),
      h(
        'p',
        { class: 'settings-note' },
        isAdmin
          ? 'This switch only changes what you see; it does not change anyone else’s access.'
          : 'Your role comes from your SurveyPro account and is checked on every request. Ask an administrator to change it.'
      )
    )
  );

  /* ── deadlines ────────────────────────────────────────────────────────────────────── */

  const pdInput = h('input', { type: 'number', min: '1', max: '365' }),
    fdInput = h('input', { type: 'number', min: '1', max: '365' }),
    countSelect = h(
      'select',
      {},
      h('option', { value: 'cal' }, 'Calendar days'),
      h('option', { value: 'wk' }, 'Working days (excl. Saturday)')
    );
  pdInput.value = cfg.pd;
  fdInput.value = cfg.fd;
  countSelect.value = cfg.cnt;
  pdInput.disabled = fdInput.disabled = countSelect.disabled = !mayManage;

  const pdOut = h('b', {}, String(cfg.pd)),
    fdOut = h('b', {}, String(cfg.fd)),
    syncPreview = () => {
      pdOut.textContent = String(cfg.pd);
      fdOut.textContent = String(cfg.fd);
    };

  pdInput.onchange = () => {
    cfg.pd = Math.min(365, Math.max(1, +pdInput.value || 15));
    pdInput.value = cfg.pd;
    saveCfg();
    syncPreview();
    flashSaved();
  };
  fdInput.onchange = () => {
    cfg.fd = Math.min(365, Math.max(1, +fdInput.value || 60));
    fdInput.value = cfg.fd;
    saveCfg();
    syncPreview();
    flashSaved();
  };
  countSelect.onchange = () => {
    cfg.cnt = countSelect.value;
    saveCfg();
    flashSaved();
  };

  const deadlinesCard = h(
    'section',
    { class: 'sys-card', id: 'sys-deadlines', style: '--i:1' },
    h(
      'div',
      { class: 'sys-card-head' },
      h('span', { class: 'sys-card-ic' }, '⏱'),
      h(
        'div',
        {},
        h('h2', {}, 'Report deadlines'),
        h(
          'p',
          {},
          'How long a preliminary and a final report are given, counted from each case’s intimation or assignment date.'
        )
      )
    ),
    h(
      'div',
      { class: 'sys-card-body' },
      h(
        'div',
        { class: 'sys-form-grid' },
        settingField('Preliminary report (days)', pdInput),
        settingField('Final report (days)', fdInput),
        settingField('Counting rule', countSelect)
      ),
      h(
        'div',
        { class: 'sys-deadlines' },
        h(
          'div',
          { class: 'sys-deadline' },
          pdOut,
          h('span', {}, 'days · preliminary report')
        ),
        h('div', { class: 'sys-deadline' }, fdOut, h('span', {}, 'days · final report'))
      )
    )
  );

  /* ── required documents per case type ────────────────────────────────────────────── */

  const types = sysCaseTypeList();
  const docState = {
    mod: types.length ? types[0].mod : 'motor',
    type: types.length ? types[0].type : '',
  };
  const typeButtons = [];
  const editor = h('div', { class: 'sys-doc-editor' });
  let renderedType = '';

  const markTypes = () => {
    typeButtons.forEach(({ button, item }) => {
      button.classList.toggle(
        'on',
        item.mod === docState.mod && item.type === docState.type
      );
      button.classList.toggle('custom', sysDocsAreCustom(item.mod, item.type));
      const count = button.querySelector('.sys-type-n');
      if (count) count.textContent = String(requiredDocsFor(item.mod, item.type).length);
    });
  };

  const typeList = h(
    'div',
    { class: 'sys-doc-types' },
    ...[
      ['motor', 'Motor'],
      ['property', 'Property'],
    ].map(([mod, label]) => {
      const group = types.filter((item) => item.mod === mod);
      if (!group.length) return null;
      return h(
        'div',
        { class: 'sys-type-group' },
        h('h4', {}, label, h('span', {}, String(group.length))),
        ...group.map((item) => {
          const count = h('span', { class: 'sys-type-n' }, String(requiredDocsFor(item.mod, item.type).length));
          const button = h(
            'button',
            {
              class:
                'sys-type' +
                (item.mod === docState.mod && item.type === docState.type ? ' on' : ''),
              type: 'button',
              onclick: () => {
                docState.mod = item.mod;
                docState.type = item.type;
                markTypes();
                renderEditor();
              },
            },
            h('span', { class: 'sys-type-name' }, item.type),
            count
          );
          typeButtons.push({ button, item });
          return button;
        })
      );
    })
  );

  function renderEditor() {
    const { mod, type } = docState;
    const categories = sysDocCategories();
    const required = requiredDocsFor(mod, type);
    const custom = required.filter((name) => categories.indexOf(name) === -1);
    const customised = sysDocsAreCustom(mod, type);
    const count = required.length;

    const commit = (list) => {
      sysSaveDocs(mod, type, list);
      markTypes();
      renderEditor();
      flashSaved();
    };

    const toggle = (name) => {
      if (!mayManage) return;
      const list = requiredDocsFor(mod, type);
      const at = list.indexOf(name);
      if (at === -1) list.push(name);
      else list.splice(at, 1);
      commit(list);
    };

    const chip = (name, isCustom) => {
      const on = required.indexOf(name) !== -1;
      return h(
        'div',
        { class: 'sys-doc-chip' + (on ? ' on' : '') + (isCustom ? ' custom' : '') },
        h(
          'button',
          {
            class: 'sys-doc-pick',
            type: 'button',
            disabled: !mayManage,
            'aria-pressed': on ? 'true' : 'false',
            onclick: () => toggle(name),
          },
          h('span', { class: 'sys-doc-tick', 'aria-hidden': 'true' }, on ? '✓' : '+'),
          h('span', { class: 'sys-doc-name' }, name)
        ),
        isCustom && mayManage
          ? h(
              'button',
              {
                class: 'sys-doc-x',
                type: 'button',
                title: 'Remove this item from the checklist',
                onclick: () => commit(required.filter((item) => item !== name)),
              },
              '×'
            )
          : null
      );
    };

    const addInput = h('input', {
      type: 'text',
      maxlength: '60',
      placeholder: 'Add a document this case type must collect…',
      'aria-label': 'Add a required document',
      disabled: !mayManage,
    });
    const addForm = h(
      'form',
      {
        class: 'sys-doc-add',
        onsubmit: (event) => {
          event.preventDefault();
          if (!mayManage) return;
          const name = addInput.value.trim();
          if (!name) return;
          const list = requiredDocsFor(mod, type);
          if (!list.some((item) => item.toLowerCase() === name.toLowerCase())) list.push(name);
          commit(list);
          const again = editor.querySelector('.sys-doc-add input');
          if (again) again.focus();
        },
      },
      addInput,
      h('button', { class: 'b p', type: 'submit', disabled: !mayManage }, 'Add')
    );

    editor.replaceChildren(
      h(
        'div',
        { class: 'sys-editor-head' },
        h(
          'div',
          { class: 'sys-editor-title' },
          h('h3', {}, type),
          h(
            'div',
            { class: 'sys-editor-pills' },
            h('span', { class: 'pill' }, mod === 'property' ? 'Property' : 'Motor'),
            h(
              'span',
              { class: 'pill' + (customised ? ' sys-pill-custom' : '') },
              customised ? 'Customised' : 'Standard set'
            ),
            h('span', { class: 'pill' }, `${count} ${count === 1 ? 'document' : 'documents'}`)
          )
        ),
        mayManage
          ? h(
              'div',
              { class: 'bar' },
              h(
                'button',
                {
                  class: 'b',
                  type: 'button',
                  onclick: () => {
                    sysResetDocs(mod, type);
                    markTypes();
                    renderEditor();
                    flashSaved();
                  },
                },
                'Use standard set'
              ),
              h(
                'button',
                {
                  class: 'b',
                  type: 'button',
                  onclick: () => commit([]),
                },
                'Clear'
              )
            )
          : null
      ),
      h(
        'p',
        { class: 'sys-editor-note' },
        'Surveyors see this list on the case’s Documents tab, and a category is ticked as soon as a file of that category is on file. A name you type yourself stays on the list as a reminder; an upload cannot tick it.'
      ),
      h(
        'div',
        { class: 'sys-doc-chips' },
        ...categories.map((name) => chip(name, false)),
        ...custom.map((name) => chip(name, true))
      ),
      addForm,
      mayManage
        ? null
        : h(
            'p',
            { class: 'sys-editor-lock' },
            'Your account can open this page but not change it. Ask an administrator.'
          )
    );
    /* The fade belongs to turning the page to another case type, not to every tick inside it. */
    const pageKey = mod + '|' + type;
    if (pageKey !== renderedType) {
      renderedType = pageKey;
      editor.classList.remove('sys-enter');
      void editor.offsetWidth;
      editor.classList.add('sys-enter');
    }
  }

  const docsCard = h(
    'section',
    { class: 'sys-card sys-card-docs', id: 'sys-docs', style: '--i:3' },
    h(
      'div',
      { class: 'sys-card-head' },
      h('span', { class: 'sys-card-ic' }, '📋'),
      h(
        'div',
        {},
        h('h2', {}, 'Required documents by case type'),
        h(
          'p',
          {},
          'Pick a case type, then the papers a case of that type must have. The checklist on the case’s Documents tab follows this list.'
        )
      )
    ),
    h('div', { class: 'sys-card-body' }, h('div', { class: 'sys-doc-layout' }, typeList, editor))
  );

  /* ── signature & stamp ───────────────────────────────────────────────────────────── */

  const signatureCard = h(
    'section',
    { class: 'sys-card', id: 'sys-signature', style: '--i:2' },
    h(
      'div',
      { class: 'sys-card-head' },
      h('span', { class: 'sys-card-ic' }, '✍'),
      h(
        'div',
        {},
        h('h2', {}, 'Signature, stamp & disclaimer'),
        h(
          'p',
          {},
          'These follow your account: once uploaded they print in the footer of every report page on each device you sign in to.'
        )
      )
    ),
    h(
      'div',
      { class: 'sys-card-body' },
      h('div', { class: 'settings-grid sys-sign-grid' }, ...(typeof signUI === 'function' ? signUI() : []))
    )
  );

  /* ── page ────────────────────────────────────────────────────────────────────────── */

  /* The overview is where the page opens and where the sections return to: four tiles, each one
     line of what it holds, so choosing a section is a choice rather than the first item of a list. */
  const overviewBody = h('div', { class: 'sys-card-body' });
  const overviewCard = h(
    'section',
    { class: 'sys-card sys-overview', id: 'sys-overview' },
    h(
      'div',
      { class: 'sys-card-head' },
      h('span', { class: 'sys-card-ic' }, '🧭'),
      h(
        'div',
        {},
        h('h2', {}, 'Settings overview'),
        h(
          'p',
          {},
          'Choose a section below. Only the section you open is shown, and this button brings you back here from any of them.'
        )
      )
    ),
    overviewBody
  );

  /* The four sections are tabs, not anchors: the page does not grow to hold all of them, and
     choosing one replaces what is on screen instead of asking a long page to scroll to it. */
  const panels = [
    ['sys-overview', 'Overview', overviewCard],
    ['sys-access', 'Roles & access', accessCard],
    ['sys-deadlines', 'Deadlines', deadlinesCard],
    ['sys-signature', 'Signature & stamp', signatureCard],
    ['sys-docs', 'Required documents', docsCard],
  ];
  const tabButtons = [];
  const backBtn = h(
    'button',
    {
      class: 'sys-tab sys-overview-back',
      type: 'button',
      hidden: true,
      onclick: () => activate('sys-overview', true),
    },
    '← Overview'
  );

  const activate = (id, scroll) => {
    panels.forEach(([key, , card]) => {
      card.hidden = key !== id;
      if (key !== id) return;
      /* Replaying the entrance is what makes the change read as a new panel rather than a block
         that happened to appear where the last one stood. */
      card.classList.remove('sys-reveal');
      void card.offsetWidth;
      card.classList.add('sys-reveal');
    });
    backBtn.hidden = id === 'sys-overview';
    if (id === 'sys-overview') drawOverview();
    tabButtons.forEach(({ button, panelId }) => {
      const on = panelId === id;
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const tab = (id, label) => {
    const button = h(
      'button',
      {
        class: 'sys-tab',
        type: 'button',
        role: 'tab',
        'aria-selected': 'false',
        'aria-controls': id,
        onclick: () => activate(id, true),
      },
      label
    );
    tabButtons.push({ button, panelId: id });
    return button;
  };

  /* Rebuilt each time the overview is shown, so the role, name and day counts on the tiles are the
     values just saved rather than the ones the page was first painted with. */
  function drawOverview() {
    const tile = (id, icon, title, note, meta, index) =>
      h(
        'button',
        {
          class: 'sys-tile',
          type: 'button',
          style: '--t:' + index,
          onclick: () => activate(id, true),
        },
        h('span', { class: 'sys-tile-ic', 'aria-hidden': 'true' }, icon),
        h(
          'span',
          { class: 'sys-tile-main' },
          h('b', {}, title),
          h('span', {}, note),
          meta ? h('span', { class: 'sys-tile-meta' }, meta) : null
        ),
        h('span', { class: 'sys-tile-go', 'aria-hidden': 'true' }, '→')
      );
    overviewBody.replaceChildren(
      h(
        'div',
        { class: 'sys-overview-grid' },
        tile(
          'sys-access',
          '👤',
          'Roles & access',
          'Who this device shows, and the name the case list filters on.',
          `${cfg.role} · ${cfg.me}`,
          0
        ),
        tile(
          'sys-deadlines',
          '⏱',
          'Report deadlines',
          'How long each report is given and how those days are counted.',
          `${cfg.pd} / ${cfg.fd} days · ${cfg.cnt === 'wk' ? 'working days' : 'calendar days'}`,
          1
        ),
        tile(
          'sys-signature',
          '✍',
          'Signature & stamp',
          'The signature, stamp and disclaimer every report carries.',
          'Printed in every report footer',
          2
        ),
        tile(
          'sys-docs',
          '📋',
          'Required documents',
          'The papers each case type must collect, shown on the case’s Documents tab.',
          `${types.length} case types`,
          3
        )
      ),
      h(
        'p',
        { class: 'sys-overview-note' },
        isAdmin
          ? 'These settings belong to this practice on this device.'
          : 'These settings come from your account; anything you cannot edit is administered for you.'
      )
    );
  }

  const heroName = String(authUser.fullName || authUser.name || cfg.me || '').trim();
  el.replaceChildren(
    h(
      'div',
      { class: 'sys-page' },
      h(
        'header',
        { class: 'sys-hero' },
        h('span', { class: 'sys-hero-glow', 'aria-hidden': 'true' }),
        h('span', { class: 'sys-hero-badge', 'aria-hidden': 'true' }, '⚙'),
        h(
          'div',
          { class: 'sys-hero-copy' },
          h('span', { class: 'sys-eyebrow' }, 'Administration'),
          h('h1', {}, 'System Settings'),
          h(
            'p',
            {},
            'The parts of the app that belong to the whole practice: who sees what, how long a report is given, the signature every report carries, and the papers each kind of case must collect.'
          ),
          h(
            'div',
            { class: 'sys-hero-meta' },
            h('span', { class: 'pill pr-m' }, isAdmin ? 'Admin' : String(authUser.role || 'User')),
            heroName ? h('span', { class: 'sys-user' }, heroName) : null,
            savedPill
          )
        ),
        h('button', { class: 'b sys-back', type: 'button', onclick: showDash }, '← Dashboard')
      ),
      h(
        'div',
        { class: 'sys-jump' },
        backBtn,
        h(
          'div',
          { class: 'sys-tabs', role: 'tablist', 'aria-label': 'System settings sections' },
          tab('sys-access', 'Roles & access'),
          tab('sys-deadlines', 'Deadlines'),
          tab('sys-signature', 'Signature & stamp'),
          tab('sys-docs', 'Required documents')
        )
      ),
      overviewCard,
      accessCard,
      deadlinesCard,
      signatureCard,
      docsCard
    )
  );

  markTypes();
  renderEditor();
  activate('sys-overview', false);
  setMenu('ms');
  window.scrollTo(0, 0);
  rememberPlace();
}
