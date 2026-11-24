/* Customer information links — the case-side half of the customer portal.
   Loaded as a classic script: h(), toast(), mayUse(), cur and SurveyAuth are globals from earlier files.

   An operator asks a customer for information and hands over one opaque link. What the customer opens
   is Phase 2; here the operator sees every link they have issued on this case, whether it has been
   opened, reissues it when it expires, and closes it when it should stop working. The link itself is
   returned by the server once, when it is created or reissued, because only its hash is stored. */

const PT_STATUS_TONE = { Active: 'pr-m', Expired: 'pr-h', Revoked: 'pr-u' };
const PT_EXPIRY_CHOICES = [1, 3, 7, 14, 30];
const PT_EVENT_LABEL = {
  invitation_created: 'Link created',
  invitation_regenerated: 'Link re-issued',
  invitation_revoked: 'Link closed',
  invitation_opened: 'Opened by the customer',
  submission_received: 'Information received',
};

/* The sections the customer form can show, in the order it shows them. The ids are the server's own
   section ids (portal-form.js); a property case trades the insured vehicle and driver for the
   insured property and its incident. */
const PT_SECTIONS = {
  motor: [
    ['customer', 'Your details'],
    ['vehicle', 'Vehicle'],
    ['ownership', 'Ownership'],
    ['driver', 'Driver'],
    ['policy', 'Insurance policy'],
    ['accident', 'The accident'],
    ['thirdParty', 'Third parties'],
  ],
  property: [
    ['customer', 'Your details'],
    ['property', 'Property'],
    ['ownership', 'Ownership'],
    ['policy', 'Insurance policy'],
    ['accident', 'The incident'],
    ['thirdParty', 'Third parties'],
  ],
};
const PT_SECTION_LABEL = Object.fromEntries(
  Object.values(PT_SECTIONS)
    .flat()
    .map(([id, label]) => [id, label])
);

const ptSectionsFor = (caseId) => {
  const mod =
    typeof DB !== 'undefined' && DB[caseId] && DB[caseId].mod === 'property' ? 'property' : 'motor';
  return PT_SECTIONS[mod];
};

const ptSectionSummary = (invitation) =>
  Array.isArray(invitation.requestedSections) && invitation.requestedSections.length
    ? invitation.requestedSections.map((id) => PT_SECTION_LABEL[id] || id).join(' · ')
    : 'All sections';

const ptDate = (value) =>
  value
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

const ptDateTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/* The clipboard API needs a secure context, and this app is often opened over plain http on an office
   LAN. The hidden-textarea fallback is the reason the Copy button works there too. */
function ptCopyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => ptCopyOldWay(text));
  }
  return Promise.resolve(ptCopyOldWay(text));
}

function ptCopyOldWay(text) {
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.top = '-1000px';
  document.body.append(box);
  box.select();
  try {
    document.execCommand('copy');
  } catch (error) {
    /* nothing else can be done; the field is still selectable */
  }
  box.remove();
}

const ptWhatsAppHref = (link, contact, name) => {
  const digits = String(contact || '').replace(/[^0-9]/g, '');
  const number = digits.length >= 8 && digits.length <= 15 ? digits : '';
  const message =
    `Dear ${name || 'customer'}, please use this secure link to send the information for your ` +
    `insurance survey: ${link}`;
  return 'https://wa.me/' + number + '?text=' + encodeURIComponent(message);
};

const ptEventItem = (event) =>
  h(
    'li',
    {},
    h('b', {}, PT_EVENT_LABEL[event.action] || event.action),
    h(
      'span',
      {},
      ptDateTime(event.createdAt) +
        (event.actorName
          ? ' · ' + event.actorName
          : event.actorType === 'customer'
            ? ' · customer'
            : event.actorType === 'system'
              ? ' · system'
              : '')
    ),
    event.reason ? h('p', { class: 'tk-why mu' }, event.reason) : null
  );

/* The link is shown once, at the moment it is made, and the panel says so. There is no "reveal" on a
   link that was issued last week because the server cannot reveal what it did not keep. */
function ptLinkPanel(link, invitation) {
  const field = h('input', { class: 'pt-link', type: 'text', readOnly: true });
  field.value = link;
  return h(
    'div',
    { class: 'pt-linkbox' },
    h('p', { class: 'pt-link-title' }, 'Link for ' + invitation.customerName),
    h(
      'div',
      { class: 'pt-linkrow' },
      field,
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          onclick: () => ptCopyText(link).then(() => toast('The link is on the clipboard.')),
        },
        'Copy'
      ),
      h(
        'a',
        {
          class: 'b pt-wa',
          href: ptWhatsAppHref(link, invitation.customerContact, invitation.customerName),
          target: '_blank',
          rel: 'noopener',
        },
        'WhatsApp'
      )
    ),
    h(
      'p',
      { class: 'mu pt-hint' },
      'This is the only time the link is shown. If it is lost, re-issue it — the old link stops working.'
    )
  );
}

/* One request lists this case's invitations; a second, made when a history is opened, answers only
   for that invitation. Both routes check the permission and the case again on the server. */
async function ptDialog(caseId) {
  const links = new Map();
  let policy = { defaultExpiryDays: 7 };
  const dlg = h('dialog', { class: 'tk-dlg pt-dlg' });
  const linkArea = h('div', { class: 'pt-linkarea' });
  const listBox = h('div', { class: 'pt-list' }, h('p', { class: 'mu' }, 'Loading…'));

  const nameInput = h('input', { type: 'text', maxlength: '200', placeholder: 'Full name' });
  const contactInput = h('input', { type: 'text', maxlength: '200', placeholder: 'Phone or email' });
  const noteInput = h('textarea', {
    rows: '2',
    maxlength: '2000',
    placeholder: 'What are we asking for? (internal note)',
  });
  const expirySelect = h('select', {});
  const createBtn = h('button', { class: 'b p', type: 'button' }, 'Create link');
  const sectionChoices = ptSectionsFor(caseId).map(([id, label]) => {
    const box = h('input', { type: 'checkbox', value: id });
    box.checked = true;
    return { box, node: h('label', { class: 'pt-section' }, box, h('span', {}, label)) };
  });
  const sectionsBox = h(
    'div',
    { class: 'pt-sections' },
    ...sectionChoices.map((choice) => choice.node)
  );
  const chosenSections = () =>
    sectionChoices.filter((choice) => choice.box.checked).map((choice) => choice.box.value);
  /* h() drops an empty-string attribute, so the starting state is set on the property instead of
     asking the attribute to do it. A link needs a name and at least one section to ask about. */
  const updateCreateState = () => {
    createBtn.disabled = !nameInput.value.trim() || !chosenSections().length;
  };
  createBtn.disabled = true;
  nameInput.addEventListener('input', updateCreateState);
  sectionChoices.forEach((choice) => choice.box.addEventListener('change', updateCreateState));

  const fillExpiryChoices = () => {
    const days = PT_EXPIRY_CHOICES.includes(Number(policy.defaultExpiryDays))
      ? Number(policy.defaultExpiryDays)
      : 7;
    expirySelect.replaceChildren(
      ...PT_EXPIRY_CHOICES.map((value) =>
        h('option', { value: String(value) }, value + (value === 1 ? ' day' : ' days'))
      )
    );
    expirySelect.value = String(days);
  };
  fillExpiryChoices();

  const createForm = h(
    'div',
    { class: 'pt-form' },
    h('label', { class: 'tk-field' }, h('span', {}, 'Customer'), nameInput),
    h('label', { class: 'tk-field' }, h('span', {}, 'Contact'), contactInput),
    h('label', { class: 'tk-field' }, h('span', {}, 'Link lasts'), expirySelect),
    h('label', { class: 'tk-field pt-span' }, h('span', {}, 'Note'), noteInput),
    h(
      'div',
      { class: 'pt-span pt-sections-wrap' },
      h('p', { class: 'pt-sections-head' }, 'Sections to ask about'),
      sectionsBox,
      h(
        'p',
        { class: 'pt-hint mu' },
        'The customer only sees the sections ticked here. Leave a section out when the surveyor already has that information.'
      )
    ),
    h('div', { class: 'pt-form-foot' }, createBtn)
  );

  const refresh = async () => {
    try {
      const payload = await SurveyAuth.request(
        '/api/cases/' + encodeURIComponent(caseId) + '/invitations'
      );
      policy = payload.policy || policy;
      fillExpiryChoices();
      renderList(Array.isArray(payload.invitations) ? payload.invitations : []);
    } catch (error) {
      listBox.replaceChildren(
        h(
          'p',
          { class: 'mu' },
          error.status === 403
            ? 'This account is not permitted to manage customer links.'
            : error.message || 'SurveyPro could not read the customer links.'
        )
      );
    }
  };

  const renderList = (rows) => {
    if (!rows.length) {
      listBox.replaceChildren(
        h('p', { class: 'mu' }, 'No customer has been asked for information on this case yet.')
      );
      return;
    }
    listBox.replaceChildren(...rows.map(card));
  };

  const card = (invitation) => {
    const pills = h(
      'div',
      { class: 'tk-pills' },
      h('span', { class: 'pill ' + (PT_STATUS_TONE[invitation.status] || 'pr-n') }, invitation.status)
    );
    if (invitation.tokenGeneration > 1) {
      pills.append(h('span', { class: 'pill pr-n' }, 'Re-issued ' + invitation.tokenGeneration + '×'));
    }
    if (invitation.openCount) {
      pills.append(
        h(
          'span',
          { class: 'pill pr-n' },
          'Opened ' + invitation.openCount + (invitation.openCount === 1 ? ' time' : ' times')
        )
      );
    }

    const actions = h('div', { class: 'pt-actions' });
    if (links.has(invitation.id)) {
      actions.append(
        h(
          'button',
          {
            class: 'b',
            type: 'button',
            onclick: () =>
              ptCopyText(links.get(invitation.id)).then(() =>
                toast('The link is on the clipboard.')
              ),
          },
          'Copy link'
        )
      );
    }
    if (invitation.status !== 'Revoked') {
      actions.append(
        h(
          'button',
          { class: 'b', type: 'button', onclick: () => ptReissue(invitation) },
          'Re-issue'
        )
      );
    }
    if (invitation.status === 'Active' || invitation.status === 'Expired') {
      actions.append(
        h(
          'button',
          { class: 'b', type: 'button', onclick: () => ptClose(invitation) },
          'Close link'
        )
      );
    }

    const latest = invitation.latestSubmission;
    return h(
      'article',
      { class: 'tk-card' + (invitation.status === 'Revoked' ? ' tk-closed' : '') },
      h(
        'div',
        { class: 'tk-card-top' },
        h(
          'div',
          {},
          h('p', { class: 'tk-type' }, invitation.customerName),
          h('p', { class: 'tk-meta mu' }, invitation.customerContact || 'No contact given')
        ),
        pills
      ),
      h(
        'p',
        { class: 'tk-meta mu' },
        invitation.status === 'Expired'
          ? 'Expired ' + ptDate(invitation.expiresAt)
          : 'Expires ' + ptDate(invitation.expiresAt) +
            ' · created ' + ptDateTime(invitation.createdAt) +
            (invitation.lastOpenedAt ? ' · last opened ' + ptDateTime(invitation.lastOpenedAt) : '')
      ),
      h('p', { class: 'tk-meta mu' }, 'Asks for: ' + ptSectionSummary(invitation)),
      latest
        ? h(
            'p',
            { class: 'tk-meta mu' },
            'Customer submission v' + latest.version + ' · ' + latest.status
          )
        : null,
      invitation.note ? h('p', { class: 'pt-note mu' }, invitation.note) : null,
      actions,
      ptHistory(invitation)
    );
  };

  const ptHistory = (invitation) => {
    const box = h('div', {}, h('p', { class: 'mu' }, 'Loading…'));
    const details = h('details', { class: 'tk-hist' }, h('summary', {}, 'History'), box);
    details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded) return;
      details.dataset.loaded = '1';
      try {
        const payload = await SurveyAuth.request(
          '/api/invitations/' + encodeURIComponent(invitation.id) + '/history'
        );
        const events = Array.isArray(payload.events) ? payload.events : [];
        box.replaceChildren(
          events.length
            ? h('ul', { class: 'tk-events' }, ...events.map(ptEventItem))
            : h('p', { class: 'mu' }, 'No activity recorded yet.')
        );
      } catch (error) {
        box.replaceChildren(h('p', { class: 'mu' }, error.message || 'Could not read the history.'));
      }
    });
    return details;
  };

  /* Both of these go through dvDialog, so the confirmation looks and closes like every other one in
     the app. The main dialog stays open behind it; the list is refreshed when the action lands. */
  const ptReissue = (invitation) => {
    const select = h('select', {});
    PT_EXPIRY_CHOICES.forEach((value) =>
      select.append(h('option', { value: String(value) }, value + (value === 1 ? ' day' : ' days')))
    );
    select.value = String(
      PT_EXPIRY_CHOICES.includes(Number(policy.defaultExpiryDays))
        ? Number(policy.defaultExpiryDays)
        : 7
    );
    dvDialog(
      'Re-issue the link for ' + invitation.customerName,
      h('label', { class: 'dv-field' }, h('span', {}, 'The new link lasts'), select),
      'Re-issue',
      () => {
        reissue(invitation, Number(select.value));
        return true;
      },
      'The current link stops working at once. The invitation, its history and anything already sent are kept.'
    );
  };

  const reissue = async (invitation, days) => {
    try {
      const payload = await SurveyAuth.request(
        '/api/invitations/' + encodeURIComponent(invitation.id) + '/regenerate',
        { method: 'POST', body: { expiresInDays: days } }
      );
      links.set(payload.invitation.id, payload.link);
      linkArea.replaceChildren(ptLinkPanel(payload.link, payload.invitation));
      toast('A new link has been issued. The old one no longer works.');
      await refresh();
    } catch (error) {
      toast(error.message || 'SurveyPro could not re-issue that link.');
    }
  };

  const ptClose = (invitation) => {
    const why = h('textarea', { rows: '2', maxlength: '500' });
    dvDialog(
      'Close the link for ' + invitation.customerName,
      h(
        'label',
        { class: 'dv-field' },
        h('span', {}, 'Why? (optional, kept in the history)'),
        why
      ),
      'Close link',
      () => {
        closeLink(invitation, why.value.trim());
        return true;
      },
      'The customer can no longer open this link. Nothing they already sent is deleted.'
    );
  };

  const closeLink = async (invitation, reason) => {
    try {
      await SurveyAuth.request(
        '/api/invitations/' + encodeURIComponent(invitation.id) + '/revoke',
        { method: 'POST', body: { reason } }
      );
      toast('The link is closed.');
      await refresh();
    } catch (error) {
      toast(error.message || 'SurveyPro could not close that link.');
    }
  };

  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    createBtn.disabled = true;
    try {
      const payload = await SurveyAuth.request(
        '/api/cases/' + encodeURIComponent(caseId) + '/invitations',
        {
          method: 'POST',
          body: {
            customerName: name,
            customerContact: contactInput.value.trim(),
            note: noteInput.value.trim(),
            expiresInDays: Number(expirySelect.value),
            requestedSections: chosenSections(),
          },
        }
      );
      links.set(payload.invitation.id, payload.link);
      linkArea.replaceChildren(ptLinkPanel(payload.link, payload.invitation));
      nameInput.value = '';
      contactInput.value = '';
      noteInput.value = '';
      sectionChoices.forEach((choice) => {
        choice.box.checked = true;
      });
      toast('The link is ready to share.');
      await refresh();
    } catch (error) {
      toast(error.message || 'SurveyPro could not create the link.');
    } finally {
      updateCreateState();
    }
  });

  dlg.append(
    h(
      'form',
      { method: 'dialog' },
      h(
        'div',
        { class: 'tk-panel-head' },
        h(
          'div',
          {},
          h('h3', {}, 'Request customer information'),
          h(
            'p',
            { class: 'mu' },
            'Ask the customer for the details or documents the case is missing. They do not need an account — the link is the only thing they need.'
          )
        )
      ),
      createForm,
      linkArea,
      listBox,
      h('div', { class: 'bar' }, h('button', { class: 'b', type: 'submit' }, 'Close'))
    )
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  nameInput.focus();
  await refresh();
}

/* The Case tools group only shows while a case is open, which is exactly when this belongs there;
   openCase() decides whether the button is in it, on the permission the routes ask for. */
const ptCaseBtn = document.getElementById('tci');
if (ptCaseBtn)
  ptCaseBtn.onclick = () => {
    if (cur) ptDialog(cur);
    if (typeof closeSideMenu === 'function') closeSideMenu();
  };
