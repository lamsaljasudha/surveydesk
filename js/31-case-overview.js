/* Case overview: the landing screen a case opens on.
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters.

   It reads what the case already records instead of keeping a second copy of anything:
   - the stage in c.st and every change in c.hist (js/11 setStage), so the workflow is the case's own trail;
   - dl() for the preliminary and final deadlines, so the days left here are the days the case screen shows;
   - requiredDocsFor() and the case document list (js/26 vocabulary, /api/documents?scope=case), so the
     readiness card and the Documents tab answer the same question;
   - the section list NAV, so every button opens the existing screen rather than a parallel one.

   Resume work remembers the last working section per account and case in localStorage, next to the
   place the app already remembers: it is where this person was standing, not a fact about the claim. */

const OV_WS_KEY = 'sp.casews';

const OV_STATE = {
  caseId: '',
  logAll: false,
  docs: {},
  pending: {},
};

/* ── resume work ─────────────────────────────────────────────────────────────────────────── */

function ovWorkStore() {
  let store = null;
  try {
    store = JSON.parse(ST.g(OV_WS_KEY) || 'null');
  } catch {
    store = null;
  }
  const user = typeof getCurrentAuthUser === 'function' ? getCurrentAuthUser() : null,
    by = user && user.id ? String(user.id) : '';
  if (!by) return null;
  if (!store || store.by !== by || !store.map || typeof store.map !== 'object')
    store = { by, map: {} };
  return store;
}

/* Called by render() after every section paint. Navigation is not an edit, so nothing is written to the
   case itself — Dd.u deliberately stays untouched and the sync comparison sees no change. */
function ovRememberWork(section) {
  if (!Dd || !Dd.id || !section || section === 'ov') return;
  const store = ovWorkStore();
  if (!store || store.map[Dd.id] === section) return;
  store.map[Dd.id] = section;
  const keys = Object.keys(store.map);
  if (keys.length > 80) keys.slice(0, keys.length - 80).forEach((k) => delete store.map[k]);
  ST.s(OV_WS_KEY, JSON.stringify(store));
}

function ovLastWork(c) {
  const store = ovWorkStore();
  const saved = store && store.map ? store.map[c.id] : '';
  return saved && saved !== 'ov' && NAV.some((s) => s.k === saved) ? saved : '';
}

/* Where a stage's work lives, in each module's own section keys. */
function ovStageSection(index) {
  const prop = Dd.mod === 'property';
  switch (index) {
    case 0:
      return 'case';
    case 1:
      return 'pol';
    case 2:
      return prop ? 'dmg' : 'd1';
    case 3:
      return 'prelim';
    case 4:
      return 'photos';
    case 5:
      return prop ? 'est' : 'loss';
    case 6:
    case 7:
      return 'final';
    case 8:
      return prop ? 'concl' : 'report';
    case 9:
    case 10:
      return 'final';
    default:
      return 'case';
  }
}

function ovResumeTarget(c) {
  const saved = ovLastWork(c);
  if (saved) return saved;
  const i = Math.max(0, STG.indexOf(c.st)),
    k = ovStageSection(i);
  return NAV.some((s) => s.k === k) ? k : 'case';
}

/* ── shared little pieces ───────────────────────────────────────────────────────────────── */

const ovIcon = (d) =>
  h(
    'svg',
    { class: 'ov-i', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    h('path', { d })
  );

const OV_ICON = {
  done: 'M9 12.5l2.1 2.1L15.2 10M12 21a9 9 0 100-18 9 9 0 000 18z',
  pending: 'M12 7.2v5.1l3.2 1.9M12 21a9 9 0 100-18 9 9 0 000 18z',
  overdue: 'M12 8v5M12 16.4v.4M10.3 4.1L2.8 17.1a1.6 1.6 0 001.4 2.4h15.6a1.6 1.6 0 001.4-2.4L13.7 4.1a1.6 1.6 0 00-3.4 0z',
  docs: 'M7 3.5h7l4 4v13H7zM14 3.5v4h4M9.6 12.2h4.8M9.6 15.6h4.8',
  resume: 'M5 12h14M13 6l6 6-6 6',
  flow: 'M4 6h7M4 12h11M4 18h16M13 6l2.5-2.5M13 6l2.5 2.5',
};

const ovStamp = (t) => {
  const d = new Date(t);
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
};

const ovIsoDay = (t) => {
  const d = new Date(t);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
};

const ovScrollTo = (id) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function ovGo(section) {
  if (!section || !NAV.some((s) => s.k === section)) return;
  sec = section;
  render();
}

function ovOpenDocs() {
  if (!Dd) return;
  if (cur && DB[cur]) sv(1);
  if (typeof showDocuments === 'function') showDocuments({ tab: 'case', caseId: Dd.id });
}

/* ── case identity ──────────────────────────────────────────────────────────────────────── */

function ovIdentity(c) {
  return withCase(c, () => {
    const prop = c.mod === 'property';
    const intimation =
      c.asg || ((c.hist || [])[0] && (c.hist[0].t ? ovIsoDay(c.hist[0].t) : ''));
    return {
      prop,
      claim: g('case_claimNo') || c.id,
      insured: g('pol_insured') || 'Insured not recorded',
      policy: g('case_policyNo'),
      insurer: g('case_company'),
      kind: g('case_ctype') || (prop ? 'Property claim' : 'Motor claim'),
      subject: prop
        ? [g('risk_kind'), g('risk_addr') || g('case_loc')].filter(Boolean).join(' · ')
        : [g('pol_make'), g('pol_model'), g('fp_year') || g('pol_year')].filter(Boolean).join(' '),
      reg: prop ? '' : g('fp_reg') || g('case_insReg') || g('pol_reg'),
      surveyor: c.owner || g('case_surveyor') || '',
      intimation,
      accident: g('case_acc'),
      survey: g('case_survey'),
    };
  });
}

/* ── workflow ───────────────────────────────────────────────────────────────────────────── */

const OV_STATUS = {
  done: 'Completed',
  active: 'In progress',
  todo: 'Pending',
  overdue: 'Overdue',
  na: 'Not applicable',
};

function ovStageModel(c) {
  const cur = Math.max(0, STG.indexOf(c.st)),
    seen = new Set(),
    at = {};
  (c.hist || []).forEach((e) => {
    if (!e || !e.t) return;
    seen.add(e.s);
    at[e.s] = e.t;
  });
  const P = dl(c, 'p'),
    F = dl(c, 'f');
  return STG.map((name, i) => {
    let status;
    if (i < cur) status = seen.has(name) || i === 0 ? 'done' : 'na';
    else if (i === cur) status = c.st === 'Survey Complete' ? 'done' : 'active';
    else status = 'todo';
    /* Only the two deadlines the app actually tracks can make a stage late; nothing else here gets an
       invented date. */
    if (status === 'todo' && act(c)) {
      if (name === 'Preliminary Report' && P.od) status = 'overdue';
      else if (i >= 6 && F.od) status = 'overdue';
    }
    if (c.st === 'Survey Complete' && status !== 'done') status = 'na';
    return { name, i, status, at: at[name] || 0 };
  });
}

function ovOverdueItems(c) {
  const out = [];
  if (!act(c)) return out;
  const P = dl(c, 'p'),
    F = dl(c, 'f');
  if (P.od) out.push({ label: 'Preliminary report', days: -P.left });
  if (F.od) out.push({ label: 'Final report', days: -F.left });
  if (c.due && isFinite(dN(c.due)) && dN(c.due) < tdN())
    out.push({ label: 'Follow-up', days: tdN() - dN(c.due) });
  return out;
}

function ovHero(c) {
  const id = ovIdentity(c),
    idx = STG.indexOf(c.st),
    color = STC[idx] || 'var(--ac)',
    resume = ovResumeTarget(c),
    resumeTitle = (NAV.find((s) => s.k === resume) || {}).t || 'Case information',
    meta = [
      ['Insurer', id.insurer],
      ['Policy no.', id.policy],
      ['Assigned surveyor', id.surveyor],
      ['Intimated', id.intimation ? dtf(id.intimation) : ''],
    ].filter(([, v]) => v);

  /* A property's address is already part of its subject line; only a vehicle adds a registration. */
  const subline = [id.insured, id.subject, !id.prop && id.reg ? 'Reg. ' + id.reg : '']
    .filter(Boolean)
    .join(' · ');

  return h(
    'section',
    { class: 'ov-hero' },
    h('span', { class: 'ov-hero-glow', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'ov-hero-main' },
      h(
        'div',
        { class: 'ov-eyebrow-row' },
        h('span', { class: 'ov-eyebrow' }, MOD.name),
        h('span', { class: 'ov-kind' }, id.kind)
      ),
      h('h1', {}, id.claim),
      h('p', { class: 'ov-sub' }, subline || 'Case particulars not recorded yet'),
      h(
        'div',
        { class: 'ov-meta' },
        ...meta.map(([k, v]) =>
          h('div', { class: 'ov-meta-i' }, h('span', {}, k), h('b', {}, v))
        )
      )
    ),
    h(
      'div',
      { class: 'ov-hero-side' },
      h(
        'span',
        { class: 'ov-stage-pill', style: '--c:' + color },
        h('span', { class: 'ov-stage-dotp' }),
        c.st || 'Intimation'
      ),
      h(
        'button',
        { class: 'ov-resume', type: 'button', onclick: () => ovGo(resume) },
        h('span', { class: 'ov-resume-ic' }, ovIcon(OV_ICON.resume)),
        h(
          'span',
          { class: 'ov-resume-txt' },
          h('b', {}, 'Resume work'),
          h('small', {}, 'Continue in ' + resumeTitle)
        )
      )
    )
  );
}

/* ── documents ──────────────────────────────────────────────────────────────────────────── */

function ovDocCategories() {
  if (typeof sysDocCategories === 'function') return sysDocCategories();
  if (typeof dvVocab === 'function') {
    const v = dvVocab();
    if (v && Array.isArray(v.categories) && v.categories.length) return v.categories.slice();
  }
  return [
    'Policy',
    'Intimation',
    'Inspection Photos',
    'Estimates',
    'Bills',
    'Legal Documents',
    'Reports',
    'Other Documents',
  ];
}

function ovRequiredDocs(c) {
  const type = String((c.f && c.f.case_ctype) || '').trim();
  if (!type || typeof requiredDocsFor !== 'function') return [];
  return requiredDocsFor(c.mod || 'motor', type);
}

function ovDocStats(c, data) {
  const cats = ovDocCategories(),
    required = ovRequiredDocs(c),
    tracked = required.filter((n) => cats.includes(n)),
    rows = (data && data.rows) || [],
    present = new Set(
      rows
        .filter((d) => d.status !== 'Rejected' && d.status !== 'Replacement Required')
        .map((d) => d.category)
    );
  return {
    tracked,
    have: tracked.filter((n) => present.has(n)).length,
    missing: tracked.filter((n) => !present.has(n)),
    total: tracked.length,
  };
}

function ovDocSummary(c) {
  const data = OV_STATE.docs[c.id];
  if (!data) return { ready: false, have: 0, total: 0, missing: [], failed: false };
  const stats = ovDocStats(c, data);
  return { ...stats, ready: true, failed: !!data.error };
}

function ovDocBody(c, data) {
  const cats = ovDocCategories(),
    required = ovRequiredDocs(c),
    tracked = required.filter((n) => cats.includes(n)),
    rows = (data && data.rows) || [],
    stats = ovDocStats(c, data);
  const byCat = {};
  rows.forEach((d) => (byCat[d.category] = byCat[d.category] || []).push(d));

  const countText = !required.length
    ? 'This case has no claim type recorded, so there is no checklist to answer yet.'
    : stats.total
      ? `${stats.have} of ${stats.total} required papers on file` +
        (stats.missing.length ? ` · ${stats.missing.length} to collect` : '')
      : 'No tracked categories for this case type.';

  return [
    h(
      'p',
      { class: 'ov-doc-count' + (required.length && !stats.missing.length ? ' done' : '') },
      countText
    ),
    data && data.error
      ? h('p', { class: 'ov-doc-note' }, data.error)
      : null,
    h(
      'div',
      { class: 'ov-doc-grid' },
      ...cats.map((name) => {
        const list = byCat[name] || [],
          live = list.filter(
            (d) => d.status !== 'Rejected' && d.status !== 'Replacement Required'
          ),
          asked = tracked.includes(name);
        let status, note, tone;
        if (live.some((d) => d.status === 'Verified')) {
          status = 'Verified';
          tone = 'ok';
          note = 'Checked and accepted';
        } else if (live.length) {
          status = 'Received';
          tone = 'rec';
          note = live.length + (live.length === 1 ? ' file on record' : ' files on record');
        } else if (list.length) {
          status = 'Pending';
          tone = 'pend';
          note = 'Replacement asked for';
        } else if (asked) {
          status = 'Pending';
          tone = 'pend';
          note = 'Not on file yet';
        } else {
          status = 'Not Applicable';
          tone = 'na';
          note = 'Not required for this case type';
        }
        return h(
          'div',
          { class: 'ov-doc ' + tone, title: name + ' — ' + status },
          h(
            'span',
            { class: 'ov-doc-ic' },
            ovIcon(tone === 'ok' ? OV_ICON.done : OV_ICON.docs)
          ),
          h(
            'div',
            { class: 'ov-doc-main' },
            h('b', {}, name),
            h('small', {}, note)
          ),
          h('span', { class: 'ov-chip ' + tone }, status)
        );
      })
    ),
  ];
}

function ovDocSkeleton() {
  return [
    h('span', { class: 'ov-doc-count ov-sk-line' }, ''),
    h(
      'div',
      { class: 'ov-doc-grid' },
      ...[0, 1, 2, 3, 4, 5, 6, 7].map(() =>
        h(
          'div',
          { class: 'ov-doc sk' },
          h('span', { class: 'ov-sk ov-sk-round' }),
          h(
            'div',
            { class: 'ov-doc-main' },
            h('span', { class: 'ov-sk ov-sk-line' }),
            h('span', { class: 'ov-sk ov-sk-line short' })
          )
        )
      )
    ),
  ];
}

async function ovLoadDocs(c) {
  const key = c.id;
  if (OV_STATE.pending[key]) return;
  OV_STATE.pending[key] = true;
  let data = { rows: null, error: '', at: Date.now() };
  try {
    if (!window.SurveyAuth || typeof window.SurveyAuth.request !== 'function')
      throw { message: 'SurveyPro is not available in this session.' };
    const payload = await window.SurveyAuth.request(
      '/api/documents?scope=case&case=' + encodeURIComponent(key)
    );
    data.rows = Array.isArray(payload.documents) ? payload.documents : [];
    if (payload.vocab && typeof dvRememberVocab === 'function') dvRememberVocab(payload.vocab);
  } catch (error) {
    data.error =
      error && error.status === 403
        ? 'This account is not permitted to see the case documents.'
        : 'The document list could not be reached. Papers are shown from the checklist until it answers.';
  }
  data.at = Date.now();
  OV_STATE.pending[key] = false;
  OV_STATE.docs[key] = data;
  if (OV_STATE.caseId === key) ovPaintDocs(c, data);
}

function ovPaintDocs(c, data) {
  const host = document.getElementById('ov-docs');
  if (host) {
    host.replaceChildren(...ovDocBody(c, data));
  }
  const value = document.getElementById('ov-kpi-docs');
  if (value) {
    const stats = ovDocStats(c, data);
    value.textContent = data && data.error ? '—' : stats.total ? stats.have + '/' + stats.total : '—';
  }
  const note = document.getElementById('ov-kpi-docs-sub');
  if (note) {
    const stats = ovDocStats(c, data);
    note.textContent = data && data.error
      ? 'list unavailable'
      : stats.total
        ? stats.missing.length
          ? stats.missing.length + ' paper' + (stats.missing.length === 1 ? '' : 's') + ' to collect'
          : 'checklist complete'
        : 'no checklist';
  }
}

/* ── KPI cards ─────────────────────────────────────────────────────────────────────────── */

function ovKpi({ tone, icon, label, value, sub, id, onclick }) {
  return h(
    'button',
    { class: 'ov-kpi ' + tone, type: 'button', onclick },
    h('span', { class: 'ov-kpi-ic' }, ovIcon(icon)),
    h(
      'span',
      { class: 'ov-kpi-body' },
      h('span', { class: 'ov-kpi-label' }, label),
      h('b', { class: 'ov-kpi-value', id: id || null }, value),
      h('span', { class: 'ov-kpi-sub', id: id ? id + '-sub' : null }, sub)
    )
  );
}

function ovKpis(c) {
  const model = ovStageModel(c),
    done = model.filter((s) => s.status === 'done').length,
    active = model.filter((s) => s.status === 'active').length,
    todo = model.filter((s) => s.status === 'todo').length,
    overdue = ovOverdueItems(c),
    docs = ovDocSummary(c);

  return h(
    'section',
    { class: 'ov-kpis', 'aria-label': 'Case at a glance' },
    ovKpi({
      tone: 'ok',
      icon: OV_ICON.done,
      label: 'Completed activities',
      value: String(done),
      sub: 'of ' + STG.length + ' workflow stages',
      onclick: () => {
        const d = document.getElementById('ov-flow-det');
        if (d) d.open = true;
        ovScrollTo('ov-flow');
      },
    }),
    ovKpi({
      tone: 'info',
      icon: OV_ICON.pending,
      label: 'Pending activities',
      value: String(active + todo),
      sub: active + ' in progress · ' + todo + ' not started',
      onclick: () => ovScrollTo('ov-flow'),
    }),
    ovKpi({
      tone: overdue.length ? 'alert' : 'quiet',
      icon: OV_ICON.overdue,
      label: 'Overdue activities',
      value: String(overdue.length),
      sub: overdue.length
        ? overdue.map((x) => x.label).join(' · ')
        : 'Nothing past its deadline',
      onclick: () => ovScrollTo('ov-deadlines'),
    }),
    ovKpi({
      tone: 'doc',
      icon: OV_ICON.docs,
      label: 'Documents',
      value: docs.ready ? (docs.total ? docs.have + '/' + docs.total : '—') : '…',
      sub: docs.ready
        ? docs.failed
          ? 'list unavailable'
          : docs.total
            ? docs.missing.length
              ? docs.missing.length + ' paper' + (docs.missing.length === 1 ? '' : 's') + ' to collect'
              : 'checklist complete'
            : 'no checklist'
        : 'checking the file list…',
      id: 'ov-kpi-docs',
      onclick: ovOpenDocs,
    })
  );
}

/* ── workflow card ─────────────────────────────────────────────────────────────────────── */

function ovFlow(c) {
  const model = ovStageModel(c),
    done = model.filter((s) => s.status === 'done').length,
    current = model.find((s) => s.status === 'active') || model[model.length - 1];

  return h(
    'section',
    { class: 'ov-card ov-flow', id: 'ov-flow' },
    h(
      'header',
      { class: 'ov-card-head' },
      h(
        'div',
        {},
        h('h3', {}, 'Case workflow'),
        h(
          'p',
          {},
          done +
            ' of ' +
            STG.length +
            ' stages complete' +
            (c.st === 'Survey Complete' ? ' · file closed' : ' · now at ' + c.st)
        )
      ),
      h('span', { class: 'ov-flow-pct' }, Math.round((done / STG.length) * 100) + '%')
    ),
    h(
      'div',
      {
        class: 'ov-flow-bar',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': String(STG.length),
        'aria-valuenow': String(done),
        'aria-label': 'Workflow stages completed',
      },
      ...model.map((s) =>
        h('span', {
          class: 'ov-seg ' + s.status,
          title: s.name + ' — ' + OV_STATUS[s.status],
        })
      )
    ),
    h(
      'details',
      { class: 'ov-flow-det', id: 'ov-flow-det' },
      h(
        'summary',
        {},
        h('span', {}, 'Stage details'),
        h('span', { class: 'ov-legend' },
          ...[
            ['done', 'Completed'],
            ['active', 'In progress'],
            ['todo', 'Pending'],
            ['overdue', 'Overdue'],
            ['na', 'N/A'],
          ].map(([k, l]) => h('span', { class: 'ov-chip ' + k }, l))
        )
      ),
      h(
        'div',
        { class: 'ov-stage-list' },
        ...model.map((s) => {
          const owner = s.status === 'done' || s.status === 'active' ? c.owner || '' : '',
            openable =
              s.status === 'active' || s.status === 'overdue' || s.status === 'todo'
                ? ovStageSection(s.i)
                : '';
          return h(
            'div',
            { class: 'ov-stage-row ' + s.status },
            h('span', { class: 'ov-stage-dot' }),
            h(
              'div',
              { class: 'ov-stage-main' },
              h('b', {}, String(s.i + 1).padStart(2, '0') + ' · ' + s.name),
              h(
                'small',
                {},
                s.at
                  ? OV_STATUS[s.status] + ' · ' + ovStamp(s.at)
                  : s.status === 'na'
                    ? 'Not part of this case'
                    : s.i === 0
                      ? 'Intimation logged'
                      : 'Not started'
              )
            ),
            h('span', { class: 'ov-chip ' + s.status }, OV_STATUS[s.status]),
            h('span', { class: 'ov-stage-owner' }, owner),
            openable && NAV.some((x) => x.k === openable)
              ? h(
                  'button',
                  {
                    class: 'ov-stage-open',
                    type: 'button',
                    'aria-label': 'Open ' + s.name,
                    onclick: () => ovGo(openable),
                  },
                  'Open'
                )
              : h('span', { class: 'ov-stage-open ghost' }, '')
          );
        })
      ),
      current && current.status === 'overdue'
        ? h(
            'p',
            { class: 'ov-flow-warn' },
            current.name +
              ' is past its deadline — see the deadline panel below for the days remaining.'
          )
        : null
    )
  );
}

/* ── next action and deadlines ─────────────────────────────────────────────────────────── */

function ovNext(c) {
  const P = dl(c, 'p'),
    F = dl(c, 'f'),
    /* Only a list that actually answered can say a paper is missing; an unreachable server must not
       turn into "collect everything" on the next-action panel. */
    docs =
      OV_STATE.docs[c.id] && !OV_STATE.docs[c.id].error
        ? ovDocStats(c, OV_STATE.docs[c.id])
        : null,
    prop = c.mod === 'property';
  let action = null;

  if (act(c) && P.od) {
    action = {
      title: 'Submit the preliminary report',
      why: `${-P.left} ${-P.left === 1 ? 'day' : 'days'} past the ${cfg.pd}-day preliminary deadline.`,
      cta: 'Open preliminary report',
      go: () => ovGo('prelim'),
      tone: 'er',
    };
  } else if (act(c) && F.od) {
    action = {
      title: 'Submit the final report',
      why: `${-F.left} ${-F.left === 1 ? 'day' : 'days'} past the ${cfg.fd}-day final deadline.`,
      cta: 'Open final report',
      go: () => ovGo('final'),
      tone: 'er',
    };
  } else if (docs && docs.missing.length) {
    action = {
      title: 'Collect ' + docs.missing[0],
      why:
        docs.missing.length +
        ' required paper' +
        (docs.missing.length === 1 ? ' is' : 's are') +
        ' still missing for this case type.',
      cta: 'Open documents',
      go: ovOpenDocs,
      tone: 'wn',
    };
  } else if (act(c) && c.due && isFinite(dN(c.due)) && dN(c.due) < tdN()) {
    action = {
      title: 'Follow up on this case',
      why: 'The follow-up date of ' + dtf(c.due) + ' has passed.',
      cta: 'Open case information',
      go: () => ovGo('case'),
      tone: 'wn',
    };
  } else {
    const i = Math.max(0, STG.indexOf(c.st)),
      map = [
        ['Review the intimation', 'Confirm the claim particulars, insurer and surveyor.', 'case'],
        ['Complete the policy verification', 'Check the policy period, insured name and vehicle or risk details.', 'pol'],
        [
          prop ? 'Inspect the damaged property' : 'Complete the physical inspection',
          prop
            ? 'Record the damage, photographs and the insured property particulars.'
            : 'Record the vehicle condition, damage and inspection photographs.',
          prop ? 'dmg' : 'd1',
        ],
        ['Prepare the preliminary report', 'The assessment is ready to be written up and sent.', 'prelim'],
        ['Collect the pending documents', 'File the bills, estimates and photographs the case still needs.', 'photos'],
        ['Complete the final assessment', 'Settle the loss figures and the final calculation.', prop ? 'est' : 'loss'],
        ['Prepare the final report', 'Bring the assessment, bills and conclusion together.', 'final'],
        ['Submit the final report to the insurer', 'Send the completed report and close the survey.', 'final'],
        ['Address the insurer’s rectification', 'Review the query and correct the report.', prop ? 'concl' : 'report'],
        ['Resubmit the corrected report', 'Send the corrected report back to the insurer.', 'final'],
        ['Close the file', 'The survey is complete; no action is outstanding.', 'final'],
      ][i] || ['Continue the case', 'Open the case to see what remains.', 'case'];
    const target = NAV.some((s) => s.k === map[2]) ? map[2] : 'case';
    action = { title: map[0], why: map[1], cta: 'Open ' + ((NAV.find((s) => s.k === target) || {}).t || 'section'), go: () => ovGo(target), tone: 'info' };
  }

  return h(
    'section',
    { class: 'ov-card ov-next ' + action.tone, id: 'ov-next' },
    h('header', { class: 'ov-card-head' }, h('div', {}, h('h3', {}, 'Next action required'), h('p', {}, 'The one thing that moves this case forward.'))),
    h(
      'div',
      { class: 'ov-next-body' },
      h('span', { class: 'ov-next-ic' }, ovIcon(action.tone === 'er' ? OV_ICON.overdue : OV_ICON.flow)),
      h('div', { class: 'ov-next-copy' }, h('b', {}, action.title), h('p', {}, action.why)),
      h('button', { class: 'ov-btn ' + (action.tone === 'er' ? 'danger' : 'primary'), type: 'button', onclick: action.go }, action.cta)
    )
  );
}

function ovDeadlines(c) {
  const P = dl(c, 'p'),
    F = dl(c, 'f');
  const row = (name, d, window) =>
    h(
      'div',
      { class: 'ov-dl' },
      h(
        'div',
        { class: 'ov-dl-main' },
        h('b', {}, name),
        h('span', { class: 'ov-dl-date' }, d.sub ? 'Submitted ' + dtf(d.sub) : d.due ? 'Due ' + dtf(d.due) : 'No start date'),
        h('small', {}, window + ' from the intimation date')
      ),
      h('span', { class: 'ov-chip ' + (d.cl || 'quiet') }, d.txt)
    );

  return h(
    'section',
    { class: 'ov-card ov-deadlines', id: 'ov-deadlines' },
    h('header', { class: 'ov-card-head' }, h('div', {}, h('h3', {}, 'Report deadlines'), h('p', {}, 'Counted from the intimation date using the practice settings.'))),
    h('div', { class: 'ov-dl-list' }, row('Preliminary report', P, cfg.pd + ' days'), row('Final report', F, cfg.fd + ' days')),
    h(
      'p',
      { class: 'ov-dl-foot' },
      c.due
        ? 'Next follow-up: ' + dtf(c.due)
        : 'No follow-up date is recorded. Set one in the tracking panel on Case information.'
    )
  );
}

/* ── recent activity ──────────────────────────────────────────────────────────────────── */

function ovHistoryRows(c) {
  const H = (c.hist || []).filter((e) => e && e.t);
  return H.map((e, i) => ({
    t: e.t,
    txt: e.a || (i ? 'Moved to ' + e.s : 'Intimation logged'),
    who: c.owner || 'Unassigned',
  })).sort((a, b) => b.t - a.t);
}

function ovLogRow(row) {
  const d = new Date(row.t);
  return h(
    'div',
    { class: 'ov-log-row' },
    h(
      'div',
      { class: 'ov-log-when' },
      h('b', {}, d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })),
      h('span', {}, d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    ),
    h('span', { class: 'ov-log-dot', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'ov-log-main' },
      h('b', {}, row.txt),
      h('small', {}, row.who)
    )
  );
}

function ovLogList(c, all) {
  const rows = ovHistoryRows(c);
  if (!rows.length) return [h('p', { class: 'ov-empty-note' }, 'No activity recorded yet.')];
  return (all ? rows : rows.slice(0, 5)).map(ovLogRow);
}

function ovToggleLog(c) {
  OV_STATE.logAll = !OV_STATE.logAll;
  const list = document.getElementById('ov-log');
  if (list) list.replaceChildren(...ovLogList(c, OV_STATE.logAll));
  const btn = document.getElementById('ov-log-more');
  if (btn)
    btn.textContent = OV_STATE.logAll
      ? 'Show latest'
      : 'View all (' + ovHistoryRows(c).length + ')';
  if (OV_STATE.logAll) ovScrollTo('ov-activity');
}

function ovActivity(c) {
  const total = ovHistoryRows(c).length;
  return h(
    'section',
    { class: 'ov-card ov-activity', id: 'ov-activity' },
    h(
      'header',
      { class: 'ov-card-head' },
      h('div', {}, h('h3', {}, 'Recent activity'), h('p', {}, 'Every stage change and filing recorded against this case.')),
      h(
        'button',
        {
          class: 'ov-link',
          type: 'button',
          id: 'ov-log-more',
          onclick: () => ovToggleLog(c),
        },
        OV_STATE.logAll ? 'Show latest' : 'View all (' + total + ')'
      )
    ),
    h('div', { class: 'ov-log', id: 'ov-log' }, ...ovLogList(c, OV_STATE.logAll))
  );
}

/* ── documents card and section navigation ───────────────────────────────────────────── */

function ovDocsCard(c) {
  const cached = OV_STATE.docs[c.id];
  return h(
    'section',
    { class: 'ov-card ov-docs-card', id: 'ov-docs-card' },
    h(
      'header',
      { class: 'ov-card-head' },
      h('div', {}, h('h3', {}, 'Document readiness'), h('p', {}, 'Papers this case type asks for, checked against the case file.')),
      h('button', { class: 'ov-link', type: 'button', onclick: ovOpenDocs }, 'View documents')
    ),
    h('div', { class: 'ov-docs', id: 'ov-docs' }, cached ? ovDocBody(c, cached) : ovDocSkeleton())
  );
}

function ovNav(c) {
  const prop = c.mod === 'property',
    tiles = [
      ['ov', 'Overview', 'This page', OV_ICON.flow],
      ['case', 'Case information', 'Claim, policy and insured', 'M6.5 3h7l4 4v14h-11zM13.5 3v4h4'],
      ...(prop
        ? []
        : [['tp', 'Parties', 'Third parties and witnesses', 'M8 11a3 3 0 100-6 3 3 0 000 6zM2.5 20c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5M16 5a3 3 0 010 6M18.5 15c1.9.5 3 2.2 3.4 5']]),
      [
        prop ? 'inc' : 'acc',
        prop ? 'Incident & inspection' : 'Accident & inspection',
        prop ? 'Cause, scene and photographs' : 'Accident, drivers and photographs',
        'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
      ],
      [
        prop ? 'dmg' : 'loss',
        'Damage assessment',
        'What was lost and what it costs',
        'M12 3l8 3v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6z',
      ],
      ['docs', 'Documents', 'Scans, bills and verification', OV_ICON.docs],
      ['prelim', 'Reports', 'Preliminary and final reports', 'M6.5 3h7l4 4v14h-11zM9 13l2 2 4-4'],
      ['log', 'Activity log', 'Every recorded action', 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'],
    ];

  return h(
    'section',
    { class: 'ov-card ov-navcard', 'aria-label': 'Case sections' },
    h('header', { class: 'ov-card-head' }, h('div', {}, h('h3', {}, 'Go to a section'), h('p', {}, 'The case forms and screens, unchanged — the overview is just the front door.'))),
    h(
      'div',
      { class: 'ov-secnav' },
      ...tiles.map(([key, title, sub, icon]) =>
        h(
          'button',
          {
            class: 'ov-tile' + (key === 'ov' ? ' on' : ''),
            type: 'button',
            onclick: () => {
              if (key === 'ov') return window.scrollTo({ top: 0, behavior: 'smooth' });
              if (key === 'docs') return ovOpenDocs();
              if (key === 'log') {
                if (!OV_STATE.logAll) OV_STATE.logAll = true;
                const list = document.getElementById('ov-log');
                if (list) list.replaceChildren(...ovLogList(c, true));
                const btn = document.getElementById('ov-log-more');
                if (btn) btn.textContent = 'Show latest';
                return ovScrollTo('ov-activity');
              }
              ovGo(key);
            },
          },
          h('span', { class: 'ov-tile-ic' }, ovIcon(icon)),
          h('span', { class: 'ov-tile-main' }, h('b', {}, title), h('small', {}, sub)),
          h('span', { class: 'ov-tile-go', 'aria-hidden': 'true' }, '→')
        )
      )
    )
  );
}

/* ── the screen ────────────────────────────────────────────────────────────────────────── */

function ovUI() {
  const c = Dd;
  if (!c) return h('div', { class: 'ov-empty' }, 'No case is open.');
  if (OV_STATE.caseId !== c.id) {
    OV_STATE.caseId = c.id;
    OV_STATE.logAll = false;
  }

  const root = h(
    'div',
    { class: 'ov' },
    ovHero(c),
    ovKpis(c),
    ovFlow(c),
    h('div', { class: 'ov-two' }, ovNext(c), ovDeadlines(c)),
    h('div', { class: 'ov-two' }, ovActivity(c), ovDocsCard(c)),
    ovNav(c)
  );

  /* The document card asks the server; the rest of the page is already true from the case held on this
     device. A cached answer paints at once and a stale one is refreshed in the background. */
  const cached = OV_STATE.docs[c.id];
  if (!cached) {
    setTimeout(() => {
      if (OV_STATE.caseId === c.id) ovLoadDocs(c);
    }, 0);
  } else {
    setTimeout(() => {
      if (OV_STATE.caseId !== c.id) return;
      ovPaintDocs(c, cached);
      if (Date.now() - (cached.at || 0) > 60000) ovLoadDocs(c);
    }, 0);
  }

  return root;
}
