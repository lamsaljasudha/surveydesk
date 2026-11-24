/* Core helpers (DOM helper h(), esc, storage), field-type constants, option lists
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const $ = (s) => document.querySelector(s);

const h = (t, a = {}, ...c) => {
  const e = document.createElement(t);
  for (const k in a) {
    if (k === 'class') e.className = a[k];
    else if (k.startsWith('on')) e[k] = a[k];
    else if (k === 'hidden') e.hidden = Boolean(a[k]);
    else if (
      k === 'checked' ||
      k === 'selected' ||
      k === 'disabled' ||
      k === 'readOnly' ||
      k === 'multiple' ||
      k === 'required'
    ) {
      e[k] = Boolean(a[k]);
    } else if (k === 'value') {
      e.value = a[k];
    } else {
      e.setAttribute(k, a[k]);
    }
  }
  c.flat().forEach((x) => e.append(x && x.nodeType ? x : document.createTextNode(x ?? '')));
  return e;
};

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );

const mem = {},
  ST = {
    g(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return mem[k] ?? null;
      }
    },
    s(k, v) {
      try {
        localStorage.setItem(k, v);
        return true;
      } catch {
        mem[k] = v;
        return false;
      }
    },
  };

const T = 't',
  N = 'n',
  M = 'm',
  D_ = 'd',
  S = 's',
  A = 'a',
  P = 'p',
  H = 'h',
  C = 'c',
  /* Text input with a suggestion list: a dropdown to pick from, but free text still survives, so
     an insurer recorded before the master list existed is never silently blanked. */
  LST = 'dl',
  IT = {
    t: 'text',
    n: 'number',
    m: 'number',
    d: 'text',
    p: 'tel',
    h: 'hidden',
    c: 'text',
    k: 'checkbox',
    dl: 'text',
  };

const F = (n, l, t = T, o = {}) => ({ n, l, t, ...o });

/* Money boxes read the Nepali way, 12,34,567, and settle with /-, but the case keeps the plain
   number underneath: sums, validation, reports and exports never see a comma. */
const inrRaw = (v) => {
  const m = /-?\d[\d,]*(?:\.\d*)?/.exec(String(v == null ? '' : v));
  return m ? m[0].replace(/,/g, '') : '';
};

/* 1234567 -> 12,34,567; decimals are kept exactly as typed. */
const inrGroup = (raw) => {
  const s = String(raw == null ? '' : raw),
    m = /^(-?)(\d+)(\.\d*)?$/.exec(s);
  if (!m) return s;
  const [, sign, int, dec = ''] = m;
  if (int.length <= 3) return sign + int + dec;
  return (
    sign +
    int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') +
    ',' +
    int.slice(-3) +
    dec
  );
};

const inrShow = (v, settled) => {
  const raw = settled ? inrRaw(v).replace(/\.$/, '') : inrRaw(v);
  if (!raw) return '';
  const g = inrGroup(raw);
  return settled && /\d$/.test(g) ? g + '/-' : g;
};

/* Format in place while the caret is inside; what was typed before the caret stays before it. */
const fmtMoneyInput = (el, settled) => {
  const shown = inrShow(el.value, settled);
  if (el.value === shown) return;
  const focused = document.activeElement === el,
    pos = el.selectionStart,
    before = pos == null ? 0 : (el.value.slice(0, pos).match(/[\d.]/g) || []).length;
  el.value = shown;
  if (focused && pos != null) {
    let seen = 0,
      at = 0;
    while (at < shown.length && seen < before) {
      if (/[\d.]/.test(shown[at])) seen++;
      at++;
    }
    try {
      el.setSelectionRange(at, at);
    } catch {}
  }
};

const YN = ['Yes', 'No'],
  YNP = ['Yes', 'No', 'Pending'],
  VER = ['Verified', 'Pending', 'Not verified', 'Not applicable'];

const VT = [
  'Motorcycle',
  'Scooter',
  'Car',
  'Jeep / SUV',
  'Van / Microbus',
  'Bus / Minibus',
  'Truck',
  'Container',
  'Tipper',
  'Tractor',
  'Three-wheeler',
  'Other',
];

const RC = ['Running – satisfactory', 'Running but not satisfactory', 'Not running / towed'],
  LC = ['A', 'B', 'C', 'C1', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'Other'];

const SEV = ['Minor', 'Moderate', 'Severe', 'Total loss'],
  OWN = ['Individual', 'Company', 'Financial institution', 'Government', 'Other'];

const MD = ['No', 'Yes', 'Yes – further inspection required'],
  MOV = ['Straight', 'Overtaking', 'Turning', 'Reversing', 'Stationary', 'Parking', 'Other'];

const NAME = { rx: /^[A-Za-z][A-Za-z .'’-]+$/, e: 'Letters only' },
  REG = {
    rx: /^(?=.*[A-Za-z])(?=.*\d).{6,}$/,
    e: 'Enter the full registration no. (letters + digits)',
  },
  ENG = { rx: /^[A-Za-z0-9\- ]{6,25}$/, e: '6–25 letters/digits' };

const NO = {},
  DL = { rx: /^[\d\-\/ ]{6,20}$/, e: 'Digits, dashes or slashes (6–20 chars)' };

const CT = [
  'Own damage – accident',
  'Own damage + third-party damage',
  'Third-party liability',
  'Theft / total loss',
  'Fire / explosion',
  'Natural calamity (flood, landslide)',
  'Glass / partial damage',
  'Other',
];

/* What a third party consists of. A claim can hit a vehicle, a person, or property that is not a
   vehicle – any one of them or all together – and the questions a party is asked follow this
   answer. The code is what the app reasons with, the label is what gets stored on the party, so an
   exported case reads without the code table at hand. */
const TP_KINDS = [
    ['veh', 'Vehicle'],
    ['inj', 'Person'],
    ['prop', 'Property'],
  ],
  TP_KIND_LABELS = TP_KINDS.map(([, l]) => l);

const TP_PROP = [
  'Boundary wall / gate',
  'Building / shop',
  'Utility pole / transformer',
  'Road furniture / signboard',
  'Parked vehicle not in use',
  'Goods / cargo',
  'Agriculture / livestock',
  'Other',
];

const TP_WHO = [
  'Driver',
  'Passenger',
  'Two-wheeler rider',
  'Cyclist',
  'Pedestrian',
  'Person at the roadside',
  'Other',
];

const YR = { min: 1980, max: new Date().getFullYear() + 1, int: 1 };

const nm = (n, l, o = {}) => F(n, l, T, { ...NAME, ...o }),
  sel = (n, l, o, x = {}) => F(n, l, S, { o, ...x });

/* A movement block is written twice, once for the insured vehicle and once for the third-party
   one; the second only applies when the third party is a vehicle, so it carries that kind. */
const mv = (q, ks) => {
  const o = ks ? { ks } : {};
  return [
    F('dir' + q, 'Direction of travel', T, o),
    F('lane' + q, 'Lane / road position', T, o),
    sel('mv' + q, 'Movement before accident', MOV, o),
    F('spd' + q, 'Approx. speed (km/h)', T, { h: 'e.g. 30–40', ...o }),
    F('imp' + q, 'Point of impact', T, o),
    F('aft' + q, 'Movement / damage after impact', A, o),
  ];
};
