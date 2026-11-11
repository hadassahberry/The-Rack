// The Activity field: an editable dropdown (a "combobox").
//   - a visible arrow opens the list of THIS person's saved activities (js/activities.js);
//     there are no built-in ones, and a new account sees "Type an activity to get started."
//   - typing narrows the list, or enters a new activity ("Add "Yoga"" appears as the last row)
//   - works by mouse, touch and keyboard
//
// What counts as "saving": pressing Enter, picking a row, or leaving the field. Escape cancels:
// the first press closes the list, the next puts back what was saved. Unfinished text is never
// part of the list: the list is built from activities already saved on plans.

let activityComboCount = 0;

// options:
//   value          the activity saved on the plan right now ('' for none)
//   getActivities  () => the person's saved activities, newest first (called fresh each time)
//   onCommit       (label) => called once when a different activity is saved ('' = cleared)
//   onFocus        () => called when the field gets focus
function createActivityCombo({ value, getActivities, onCommit, onFocus }) {
    const id = `activity-combo-${++activityComboCount}`;
    const coarse = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    const wrap = document.createElement('div');
    wrap.className = 'activity-combo';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'outfit-label';
    input.maxLength = 40;
    input.value = value || '';
    // Says you can type a new activity or pick a recent one (the chips under an outfit with none yet, or the arrow);
    // with no saved activities there is nothing to pick, so it only invites typing.
    input.placeholder = getActivities().length ? 'Type an activity, or pick a recent one' : 'Type an activity (optional)';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('enterkeyhint', 'done');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', 'Activity for this outfit');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', `${id}-list`);

    const arrow = document.createElement('button');
    arrow.type = 'button';
    arrow.className = 'activity-arrow';
    arrow.tabIndex = -1;                                   // the field itself is the keyboard stop (ArrowDown opens the list)
    arrow.setAttribute('aria-label', 'Show your saved activities');
    arrow.setAttribute('aria-expanded', 'false');
    arrow.setAttribute('aria-controls', `${id}-list`);
    arrow.innerHTML = '<span class="activity-chevron" aria-hidden="true"></span>';

    const popup = document.createElement('div');
    popup.className = 'activity-popup hidden';
    const list = document.createElement('ul');
    list.id = `${id}-list`;
    list.className = 'activity-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Your saved activities');
    const hint = document.createElement('p');
    hint.className = 'activity-hint';
    popup.append(list, hint);

    const status = document.createElement('div');          // read out by screen readers as the list changes
    status.className = 'sr-only';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    wrap.append(input, arrow, popup, status);

    let saved = value || '';        // the activity saved on the plan
    let filtering = false;          // true only while the person is typing: opening the list shows EVERYTHING, typing narrows it
    let isOpen = false;
    let rows = [];                  // [{ li, label }] in the order shown
    let active = -1;                // the highlighted row

    function setActive(i) {
        active = i;
        rows.forEach((r, n) => r.li.classList.toggle('is-active', n === i));
        if (i >= 0) {
            input.setAttribute('aria-activedescendant', rows[i].li.id);
            rows[i].li.scrollIntoView({ block: 'nearest' });
        } else {
            input.removeAttribute('aria-activedescendant');
        }
    }

    function addRow(label, isNew) {
        const li = document.createElement('li');
        li.id = `${id}-opt-${rows.length}`;
        li.className = 'activity-option' + (isNew ? ' is-new' : '');
        li.setAttribute('role', 'option');
        const selected = !isNew && activityKey(label) === activityKey(saved);
        li.setAttribute('aria-selected', String(selected));
        if (selected) li.classList.add('is-selected');
        const text = document.createElement('span');
        text.className = 'activity-option-text';
        text.textContent = isNew ? `Add “${label}”` : label;
        li.appendChild(text);
        if (selected) {
            const tick = document.createElement('span');
            tick.className = 'activity-tick';
            tick.setAttribute('aria-hidden', 'true');
            tick.textContent = '✓';
            li.appendChild(tick);
        }
        li.addEventListener('mousemove', () => {          // the row under the mouse is the highlighted one
            const n = rows.findIndex(r => r.li === li);
            if (n !== active) setActive(n);
        });
        list.appendChild(li);
        rows.push({ li, label });
    }

    function render() {
        const all = getActivities();
        const query = filtering ? input.value : '';        // a saved value in the box doesn't hide the other activities
        const typed = cleanActivity(query);
        const matches = filterActivities(all, query);
        const isNew = typed !== '' && !findActivity(all, typed);
        list.innerHTML = '';
        rows = [];
        matches.forEach(a => addRow(a.label, false));
        if (isNew) addRow(typed, true);
        // A hint instead of an empty box: nothing saved yet, or nothing matches.
        let message = '';
        if (all.length === 0 && !typed) message = 'Type an activity to get started.';
        else if (matches.length === 0 && typed && all.length > 0) message = 'No saved activity matches.';
        hint.textContent = message;
        hint.classList.toggle('hidden', !message);
        list.classList.toggle('hidden', rows.length === 0);
        status.textContent = rows.length === 0 ? message
            : `${rows.length} ${rows.length === 1 ? 'choice' : 'choices'} available. Use the up and down arrow keys.`;
        setActive(-1);
    }

    function openList() {
        if (isOpen) return;
        isOpen = true;
        popup.classList.remove('hidden');
        input.setAttribute('aria-expanded', 'true');
        arrow.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', outsidePress, true);
    }

    function closeList() {
        filtering = false;
        if (!isOpen) return;
        isOpen = false;
        popup.classList.add('hidden');
        input.setAttribute('aria-expanded', 'false');
        arrow.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        document.removeEventListener('pointerdown', outsidePress, true);
    }

    // A press anywhere outside the control closes the list (this also covers phones, where
    // the arrow opens the list without the on-screen keyboard).
    function outsidePress(e) {
        if (!wrap.contains(e.target)) closeList();
    }

    // Save what's in the box: tidied, spelled like the existing activity if there is one.
    function commit(raw) {
        // The same activity as before (ignoring spaces and capitals): leave the plan exactly as it
        // is. Just looking at an old plan, even one saved with odd spacing, never rewrites it.
        if (activityKey(raw) === activityKey(saved)) {
            input.value = saved;
            return;
        }
        const resolved = resolveActivity(getActivities(), raw);
        input.value = resolved;
        saved = resolved;
        onCommit(resolved);
    }

    function choose(label) {
        input.value = label;
        closeList();
        commit(label);
    }

    // --- mouse and touch ---
    // Pressing the arrow or a row must not take focus away from the field (which would "leave" it).
    arrow.addEventListener('pointerdown', (e) => e.preventDefault());
    popup.addEventListener('pointerdown', (e) => e.preventDefault());
    arrow.addEventListener('click', () => {
        if (isOpen) { closeList(); return; }
        render();
        openList();
        if (!coarse()) input.focus({ preventScroll: true });   // on a phone, don't raise the keyboard just to look at the list
    });
    list.addEventListener('click', (e) => {
        const li = e.target.closest('li.activity-option');
        const row = li && rows.find(r => r.li === li);
        if (row) choose(row.label);
    });
    input.addEventListener('click', () => { if (!isOpen) { render(); openList(); } });

    // --- typing ---
    input.addEventListener('input', () => { filtering = true; render(); openList(); });
    input.addEventListener('focus', () => { if (onFocus) onFocus(); });
    input.addEventListener('blur', () => { closeList(); commit(input.value); });

    // --- keyboard ---
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isOpen) {
                render();
                openList();
                if (e.altKey) return;              // Alt+Down just opens the list
                const sel = rows.findIndex(r => r.li.classList.contains('is-selected'));
                setActive(sel >= 0 ? sel : (e.key === 'ArrowDown' ? 0 : rows.length - 1));
                return;
            }
            if (rows.length === 0) return;
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive(active < 0 ? (step === 1 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (isOpen && active >= 0) choose(rows[active].label);
            else { closeList(); commit(input.value); }
            input.blur();
        } else if (e.key === 'Escape') {
            if (isOpen) { e.preventDefault(); e.stopPropagation(); closeList(); }               // 1st press: close the list
            else if (input.value !== saved) { e.preventDefault(); e.stopPropagation(); input.value = saved; filtering = false; }   // 2nd: undo the typing
            // otherwise Escape goes on to close the whole planning popup, as before
        }
    });

    return { element: wrap, input };
}
