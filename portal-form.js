/* Public customer information form — the one definition of what a link may ask.
   This module is shared by the form endpoint and the submit endpoint, so the questions the customer
   sees and the questions the server accepts are the same list. Keys are the case schema's own keys
   (`pol_reg`, `case_acc`, `tp_reg`…), which is what lets Phase 3 apply an approved submission to a
   case without a translation table. */

const crypto = require('crypto');

const YN = ['Yes', 'No'];
const YNP = ['Yes', 'No', 'Pending'];
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
const LC = ['A', 'B', 'C', 'C1', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'Other'];
const OWN = ['Individual', 'Company', 'Financial institution', 'Government', 'Other'];
const ROAD_T = ['Urban', 'Rural', 'Highway'];
const WX = ['Clear', 'Rain', 'Fog', 'Cloudy'];
const TP_KINDS = ['Vehicle', 'Person', 'Property'];
const TP_WHO = [
  'Driver',
  'Passenger',
  'Two-wheeler rider',
  'Cyclist',
  'Pedestrian',
  'Person at the roadside',
  'Other',
];
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
const MOTOR_POLICY_TYPES = ['Full insurance (comprehensive)', 'Third-party only', 'Other'];
const PROPERTY_POLICY_TYPES = [
  'Fire & special perils',
  'Burglary / theft',
  'Property all risk',
  'Engineering / contractors',
  'Other',
];
const PROPERTY_KINDS = [
  'Residential building',
  'Commercial building',
  'Industrial plant',
  'Warehouse / stock',
  'Machinery / equipment',
  'Other',
];
const CONSTRUCTION = [
  'RCC frame',
  'Load-bearing masonry',
  'Steel / PEB',
  'Timber / mud',
  'Other',
];
const OCCUPANCY = ['Owner occupied', 'Tenant', 'Vacant'];
const CAUSES_OF_LOSS = [
  'Fire',
  'Flood / inundation',
  'Earthquake / landslide',
  'Lightning',
  'Burglary / theft',
  'Explosion',
  'Storm / wind',
  'Other',
];

const f = (k, l, t, o = {}) => ({ k, l, t, ...o });
const group = (title, fields) => ({ title, fields });
const section = (id, title, note, groups) => ({ id, title, note, groups });

const CUSTOMER = section('customer', 'Your details', 'Who we are collecting this information from.', [
  group('Insured / customer', [
    f('pol_insured', 'Full name of insured', 'text', { req: 1 }),
    f('pol_tel', 'Contact number', 'tel', { req: 1, ph: '98XXXXXXXX' }),
    f('pol_addr', 'Address', 'textarea', { rows: 2 }),
    f('case_claimNo', 'Insurance claim number', 'text', { ph: 'If you have it' }),
    f('case_policyNo', 'Policy number', 'text', { req: 1 }),
  ]),
]);

const VEHICLE = section(
  'vehicle',
  'Vehicle',
  'The insured vehicle as it is shown in the policy.',
  [
    group('Vehicle details', [
      f('pol_reg', 'Registration number', 'text', { req: 1, ph: 'BA 12 PA 3456' }),
      f('pol_vtype', 'Vehicle type', 'select', { o: VT, req: 1 }),
      f('pol_make', 'Make', 'text', { req: 1 }),
      f('pol_model', 'Model', 'text'),
      f('fp_colour', 'Colour', 'text'),
      f('pol_year', 'Manufacturing year', 'number', { min: 1980, max: new Date().getFullYear() + 1, int: 1 }),
      f('pol_eng', 'Engine number', 'text'),
      f('pol_chs', 'Chassis number', 'text'),
      f('pol_seats', 'Seating capacity', 'number', { min: 1, max: 100, int: 1 }),
    ]),
  ]
);

const PROPERTY = section(
  'property',
  'Property',
  'The insured property and how it is used.',
  [
    group('Property details', [
      f('risk_kind', 'Property type', 'select', { o: PROPERTY_KINDS, req: 1 }),
      f('risk_addr', 'Risk location address', 'text', { req: 1 }),
      f('risk_constr', 'Construction', 'select', { o: CONSTRUCTION }),
      f('risk_floors', 'Number of floors', 'number', { min: 0, max: 200, int: 1 }),
      f('risk_area', 'Built-up area (sq. ft)', 'number', { min: 0 }),
      f('risk_year', 'Year of construction', 'number', {
        min: 1900,
        max: new Date().getFullYear(),
        int: 1,
      }),
      f('risk_occ', 'Occupancy / use', 'text'),
      f('risk_own', 'Occupancy status', 'select', { o: OCCUPANCY }),
      f('risk_prot', 'Fire / security protections', 'text'),
      f('risk_prev', 'Previous damage', 'select', { o: ['None', 'Yes'] }),
      f('risk_prevD', 'Previous damage description', 'textarea', { rows: 2 }),
    ]),
  ]
);

const OWNERSHIP = section(
  'ownership',
  'Ownership',
  'Who owns the insured vehicle or property.',
  [
    group('Owner', [
      f('fp_oName', 'Owner / insured name', 'text', { req: 1 }),
      f('fp_oType', 'Owner type', 'select', { o: OWN }),
      f('fp_tel', 'Contact number', 'tel'),
      f('fp_perm', 'Permanent address', 'textarea', { rows: 2 }),
      f('fp_cur', 'Current address', 'textarea', { rows: 2 }),
      f('fp_rel', 'Relationship to policyholder', 'text'),
    ]),
  ]
);

const PROPERTY_OWNERSHIP = section(
  'ownership',
  'Ownership',
  'Who owns or occupies the insured property.',
  [
    group('Owner / occupant', [
      f('risk_oName', 'Owner / occupant name', 'text', { req: 1 }),
      f('risk_oTel', 'Contact number', 'tel'),
      f('risk_rel', 'Relationship to insured', 'text'),
    ]),
  ]
);

const DRIVER = section(
  'driver',
  'Driver',
  'The person who was driving the insured vehicle.',
  [
    group('Driver details', [
      f('fp_dName', 'Driver name', 'text', { req: 1 }),
      f('fp_dTel', 'Contact number', 'tel'),
      f('fp_dAddr', 'Address', 'textarea', { rows: 2 }),
      f('fp_dlNo', 'Driving licence number', 'text'),
      f('fp_dlCat', 'Licence category', 'select', { o: LC }),
      f('fp_dlExp', 'Licence expiry date', 'date'),
      f('fp_dRel', 'Relationship to owner', 'text'),
    ]),
  ]
);

const POLICY = section(
  'policy',
  'Insurance policy',
  'The policy this claim is made under.',
  [
    group('Policy particulars', [
      f('case_company', 'Insurance company', 'text', { req: 1 }),
      f('pol_branch', 'Branch / office', 'text'),
      f('pol_type', 'Policy type', 'select', { o: MOTOR_POLICY_TYPES }),
      f('pol_issue', 'Issue date', 'date'),
      f('pol_start', 'Commencement date', 'date'),
      f('pol_end', 'Expiry date', 'date'),
      f('pol_sum', 'Sum insured (NPR)', 'money'),
      f('pol_idv', 'Insured declared value, IDV (NPR)', 'money'),
      f('pol_exC', 'Compulsory excess (NPR)', 'money'),
      f('pol_endors', 'Additional covers / endorsements', 'textarea', { rows: 2 }),
    ]),
  ]
);

const PROPERTY_POLICY = section(
  'policy',
  'Insurance policy',
  'The policy this claim is made under.',
  [
    group('Policy particulars', [
      f('case_company', 'Insurance company', 'text', { req: 1 }),
      f('pol_type', 'Policy type', 'select', { o: PROPERTY_POLICY_TYPES }),
      f('pol_issue', 'Issue date', 'date'),
      f('pol_start', 'Commencement date', 'date'),
      f('pol_end', 'Expiry date', 'date'),
      f('pol_sumB', 'Sum insured – building (NPR)', 'money'),
      f('pol_sumC', 'Sum insured – contents / stock (NPR)', 'money'),
      f('pol_ex', 'Excess / deductible (NPR)', 'money'),
      f('pol_bank', 'Bank / mortgagee interest', 'text'),
      f('pol_endors', 'Endorsements / special conditions', 'textarea', { rows: 2 }),
    ]),
  ]
);

const ACCIDENT = section(
  'accident',
  'The accident',
  'When, where and how the accident happened.',
  [
    group('Accident particulars', [
      f('case_acc', 'Accident date (AD)', 'date', { req: 1 }),
      f('acc_time', 'Accident time', 'time'),
      f('case_loc', 'Exact location', 'text', { req: 1 }),
      f('acc_muni', 'Municipality / district', 'text', { req: 1 }),
      f('acc_road', 'Road name / highway', 'text'),
      f('acc_roadT', 'Road type', 'select', { o: ROAD_T }),
      f('acc_wx', 'Weather', 'select', { o: WX }),
      f('acc_police', 'Police informed', 'select', { o: YN }),
      f('acc_station', 'Police station', 'text'),
      f('acc_reportNo', 'Police report number', 'text'),
      f('acc_injured', 'Injured persons', 'number', { min: 0, max: 200, int: 1 }),
      f('acc_fatal', 'Fatalities', 'number', { min: 0, max: 200, int: 1 }),
      f('acc_witness', 'Witnesses available', 'select', { o: YN }),
      f('acc_media', 'Photos / videos available', 'select', { o: YN }),
      f('acc_cause', 'Reported cause of accident', 'text', { req: 1 }),
    ]),
    group('Your account', [
      f('acc_narr', 'What happened', 'textarea', { rows: 5, req: 1 }),
    ]),
  ]
);

const PROPERTY_INCIDENT = section(
  'accident',
  'The incident',
  'When, where and how the loss happened.',
  [
    group('Incident particulars', [
      f('case_acc', 'Date of loss', 'date', { req: 1 }),
      f('inc_time', 'Time of loss', 'time'),
      f('case_loc', 'Loss / risk location', 'text', { req: 1 }),
      f('case_ctype', 'Cause of loss', 'select', { o: CAUSES_OF_LOSS, req: 1 }),
      f('inc_cause', 'Reported cause of loss', 'text', { req: 1 }),
      f('inc_origin', 'Origin / point of loss', 'text'),
      f('inc_auth', 'Fire brigade / police informed', 'select', { o: YNP }),
      f('inc_authR', 'Authority and report number', 'text'),
      f('inc_wit', 'Witnesses available', 'select', { o: YN }),
      f('inc_media', 'Photos / videos available', 'select', { o: YN }),
      f('inc_mitig', 'Salvage / mitigation steps taken', 'textarea', { rows: 2 }),
    ]),
    group('Your account', [
      f('inc_narr', 'What happened', 'textarea', { rows: 5, req: 1 }),
    ]),
  ]
);

const THIRD_PARTY = section(
  'thirdParty',
  'Third parties',
  'Anyone else involved: their vehicle, a person, or property that was damaged.',
  [
    group('Involvement', [
      f('case_hasTP', 'Was anyone else involved?', 'select', { o: YN, req: 1 }),
      f('tp_kinds', 'What was involved?', 'multiselect', { o: TP_KINDS, show: 'tp' }),
    ]),
    group('Other vehicle', [
      f('tp_reg', 'Registration number', 'text', { show: 'veh' }),
      f('tp_type', 'Vehicle type', 'select', { o: VT, show: 'veh' }),
      f('tp_mm', 'Make and model', 'text', { show: 'veh' }),
      f('tp_colour', 'Colour', 'text', { show: 'veh' }),
      f('tp_year', 'Manufacturing year', 'number', { min: 1980, max: new Date().getFullYear() + 1, int: 1, show: 'veh' }),
      f('tp_eng', 'Engine number', 'text', { show: 'veh' }),
      f('tp_chs', 'Chassis number', 'text', { show: 'veh' }),
      f('tp_oName', 'Owner name', 'text', { show: 'veh' }),
      f('tp_tel', 'Owner contact number', 'tel', { show: 'veh' }),
      f('tp_addr', 'Owner address', 'textarea', { rows: 2, show: 'veh' }),
      f('tp_dName', 'Driver name', 'text', { show: 'veh' }),
      f('tp_dTel', 'Driver contact number', 'tel', { show: 'veh' }),
      f('tp_dlNo', 'Driving licence number', 'text', { show: 'veh' }),
      f('tp_rem', 'Anything else about the other vehicle', 'textarea', { rows: 2, show: 'veh' }),
    ]),
    group('Person', [
      f('d2_pName', 'Full name of the person', 'text', { show: 'inj' }),
      f('d2_pWho', 'Who was hit', 'select', { o: TP_WHO, show: 'inj' }),
      f('d2_desc', 'Injury description', 'textarea', { rows: 2, show: 'inj' }),
      f('d2_hosp', 'Hospital / treatment centre', 'text', { show: 'inj' }),
      f('d2_med', 'Medical expenses (NPR)', 'money', { show: 'inj' }),
    ]),
    group('Property', [
      f('tp_pWhat', 'What was damaged', 'text', { show: 'prop' }),
      f('tp_pType', 'Property type', 'select', { o: TP_PROP, show: 'prop' }),
      f('tp_pWhere', 'Where it was', 'text', { show: 'prop' }),
      f('tp_pUse', 'How it was used', 'text', { show: 'prop' }),
      f('tp_pIns', 'Had its own insurance', 'select', { o: YNP, show: 'prop' }),
      f('tp_pRem', 'Anything else about the property', 'textarea', { rows: 2, show: 'prop' }),
    ]),
  ]
);

const MODULES = {
  motor: [CUSTOMER, VEHICLE, OWNERSHIP, DRIVER, POLICY, ACCIDENT, THIRD_PARTY],
  property: [CUSTOMER, PROPERTY, PROPERTY_OWNERSHIP, PROPERTY_POLICY, PROPERTY_INCIDENT, THIRD_PARTY],
};

const moduleSections = (module) => MODULES[module === 'property' ? 'property' : 'motor'];
const moduleSectionIds = (module) => moduleSections(module).map((s) => s.id);

/* What the operator's request means: an absent or empty list is every section the module has, and
   anything a different module recognises but this one does not is dropped here rather than sent to a
   customer as a page they cannot answer. */
function sectionsFor(module, requested) {
  const all = moduleSections(module);
  if (!Array.isArray(requested) || !requested.length) return all;
  const wanted = new Set(requested.map(String));
  return all.filter((s) => wanted.has(s.id));
}

function fieldsFor(module, requested) {
  const map = new Map();
  sectionsFor(module, requested).forEach((s) =>
    s.groups.forEach((g) => g.fields.forEach((field) => map.set(field.k, field)))
  );
  return map;
}

const MAX_LENGTH = { text: 160, tel: 30, textarea: 3000, date: 10, time: 5, number: 20, money: 20 };
const PHONE = /^\+?[\d\s\-()]{7,25}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const REG = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/;
const ENG = /^[A-Za-z0-9\- ]{6,25}$/;

const asText = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

/* The strict whitelist: every key must be one the requested sections define, every value must be the
   type its field says, and a dropdown value must be one of that field's options. Drafts skip the
   "required" and format checks so a half-filled form can be saved; the final submit does not. */
function validateValues(module, requested, raw, { requireAll = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'The form data was not readable.', code: 'invalid_payload' };
  }
  const fields = fieldsFor(module, requested);
  const values = {};
  const errors = {};
  const unknown = [];

  Object.keys(raw).forEach((key) => {
    const field = fields.get(key);
    if (!field) {
      unknown.push(key.slice(0, 80));
      return;
    }
    const value = raw[key];
    if (field.t === 'multiselect') {
      if (value === '' || value == null) {
        values[key] = [];
        return;
      }
      if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) {
        errors[key] = 'Choose from the listed options';
        return;
      }
      const chosen = [...new Set(value.map((x) => x.trim()).filter(Boolean))];
      if (chosen.some((x) => !field.o.includes(x))) {
        errors[key] = 'Choose from the listed options';
        return;
      }
      values[key] = chosen;
      return;
    }
    const text = asText(value);
    if (text == null) {
      errors[key] = 'Invalid value';
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      values[key] = '';
      return;
    }
    if (trimmed.length > (MAX_LENGTH[field.t] || 160)) {
      errors[key] = 'Too long';
      return;
    }
    if (field.t === 'select') {
      if (!field.o.includes(trimmed)) {
        errors[key] = 'Choose a listed option';
        return;
      }
    } else if (field.t === 'date') {
      if (!DATE.test(trimmed) || Number.isNaN(new Date(trimmed + 'T00:00:00').getTime())) {
        errors[key] = 'Enter a valid date';
        return;
      }
    } else if (field.t === 'time') {
      if (!TIME.test(trimmed)) {
        errors[key] = 'Use HH:MM';
        return;
      }
    } else if (field.t === 'number' || field.t === 'money') {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        errors[key] = 'Numbers only';
        return;
      }
      if (field.min != null && n < field.min) {
        errors[key] = 'Minimum ' + field.min;
        return;
      }
      if (field.max != null && n > field.max) {
        errors[key] = 'Maximum ' + field.max;
        return;
      }
      if (field.t === 'money' && n < 0) {
        errors[key] = 'Cannot be negative';
        return;
      }
      if (field.int && !Number.isInteger(n)) {
        errors[key] = 'Whole number only';
        return;
      }
    }
    values[key] = trimmed;
  });

  if (unknown.length) {
    return {
      error: 'Some fields are not part of this form.',
      code: 'unknown_field',
      fields: unknown.slice(0, 20),
    };
  }

  if (requireAll) {
    /* The third-party page is one question that opens three blocks. Answers to a block the customer
       closed are not part of what they are saying now, so a final submission carries only the blocks
       whose kind they ticked. A draft keeps everything, so reopening a block finds the work again. */
    if (fields.has('case_hasTP')) {
      const kinds = Array.isArray(values.tp_kinds) ? values.tp_kinds : [];
      const active = new Set();
      if (values.case_hasTP === 'Yes') {
        active.add('tp');
        if (kinds.includes('Vehicle')) active.add('veh');
        if (kinds.includes('Person')) active.add('inj');
        if (kinds.includes('Property')) active.add('prop');
      }
      fields.forEach((field) => {
        if (field.show && !active.has(field.show)) {
          delete values[field.k];
          delete errors[field.k];
        }
      });
    }

    fields.forEach((field) => {
      if (!field.req || errors[field.k]) return;
      const v = values[field.k];
      if (field.t === 'multiselect' ? !v || !v.length : !v) errors[field.k] = 'Required';
    });

    /* Third-party answers follow the one question that opens them, exactly as the form shows them. */
    const involved = values.case_hasTP;
    const kinds = Array.isArray(values.tp_kinds) ? values.tp_kinds : [];
    if (fields.has('case_hasTP') && involved === 'Yes' && !kinds.length) {
      errors.tp_kinds = 'Choose what was involved';
    }
    if (kinds.includes('Vehicle') && !errors.tp_reg && !values.tp_reg) {
      errors.tp_reg = 'Required for a vehicle';
    }
    if (kinds.includes('Person') && !errors.d2_pName && !values.d2_pName) {
      errors.d2_pName = 'Required for a person';
    }
    if (kinds.includes('Property') && !errors.tp_pWhat && !values.tp_pWhat) {
      errors.tp_pWhat = 'Required for property';
    }

    fields.forEach((field) => {
      if (errors[field.k]) return;
      const v = values[field.k];
      if (!v) return;
      if (field.t === 'tel' && !PHONE.test(v)) {
        errors[field.k] = 'Use a phone number, e.g. 98XXXXXXXX';
      } else if (field.k === 'pol_reg' && !REG.test(v)) {
        errors[field.k] = 'Enter the full registration number (letters and digits)';
      } else if ((field.k === 'pol_eng' || field.k === 'pol_chs') && !ENG.test(v)) {
        errors[field.k] = '6–25 letters or digits';
      }
    });
  }

  return { values, errors };
}

/* The hash the server compares to notice an identical resubmission. Keys are sorted so the same
   answers typed in a different order are still the same answers. */
function hashValues(values) {
  const sorted = {};
  Object.keys(values)
    .sort()
    .forEach((key) => {
      sorted[key] = values[key];
    });
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

/* What the browser is allowed to know: labels, types, options and which fields are conditional.
   The regexes and the server-only rules stay here. */
function publicSections(module, requested) {
  return sectionsFor(module, requested).map((s) => ({
    id: s.id,
    title: s.title,
    note: s.note,
    groups: s.groups.map((g) => ({
      title: g.title,
      fields: g.fields.map((field) => ({
        k: field.k,
        l: field.l,
        t: field.t,
        o: field.o || null,
        req: field.req ? 1 : 0,
        rows: field.rows || null,
        ph: field.ph || null,
        min: field.min != null ? field.min : null,
        max: field.max != null ? field.max : null,
        int: field.int ? 1 : 0,
        show: field.show || null,
      })),
    })),
  }));
}

module.exports = {
  moduleSectionIds,
  sectionsFor,
  validateValues,
  hashValues,
  publicSections,
};
