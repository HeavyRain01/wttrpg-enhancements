import { bindConditionAutocomplete } from '../util/conditionAutocomplete.js';
import { TEMPLATE_PATHS } from '../util/constants.js';
import { getProfessionSkillOptions } from '../util/professionSkill.js';
import { getStandardSkillOptions } from '../util/skillLabel.js';
import { EFFECT_TIMINGS, VALUABLE_USE_ICON, failValuableUse, getValuableUses, isGeneralValuable,
    isValuableUseAvailable, reportValuableUseError, resolveUseDocument, runValuableUse, saveValuableUse,
    useText } from '../util/valuableUse.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const dialog = () => foundry.applications.api.DialogV2;
const renderTemplate = (...args) => foundry.applications.handlebars.renderTemplate(...args);
const escape = value => foundry.utils.escapeHTML(String(value ?? ''));
const localOption = (value, key) => [value, useText(key)];
const field = (key, control, attributes = '') =>
    `<label class="wttrpg-use-field" ${attributes}><span>${escape(useText(key))}</span>${control}</label>`;
const reviewedMacros = new WeakMap();
const managers = new WeakMap();

function select(name, options, selected) {
    return `<select name="${name}">${options.map(([value, label]) =>
        `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`
    ).join('')}</select>`;
}

function content(html) {
    const node = document.createElement('div');
    // DialogV2 requires a plain outer div and renders only its inner HTML.
    node.innerHTML = `<div class="wttrpg-use-dialog">${html}</div>`;
    return node;
}

function dropField(name, value, type) {
    return `<input name="${name}" type="text" value="${escape(value)}" data-drop-type="${type}"
        placeholder="${escape(useText('DropOrPaste'))}">`;
}

function bindEditor(app, draft) {
    const root = app.element;
    const image = root.querySelector('[data-use-image]');
    const img = root.querySelector('[name="img"]');
    image.addEventListener('click', () => {
        const { FilePicker } = foundry.applications.apps;
        new FilePicker.implementation({
            type: 'image',
            current: img.value,
            callback: path => {
                img.value = path;
                image.querySelector('img').src = path;
            }
        }).browse().catch(reportValuableUseError);
    });
    const editor = foundry.applications.elements.HTMLProseMirrorElement.create({
        name: 'description',
        value: foundry.utils.cleanHTML(draft.description ?? ''),
        height: 160
    });
    root.querySelector('[data-use-description]').append(editor);
    bindConditionAutocomplete(root);
    const type = root.querySelector('[name="type"]');
    const source = root.querySelector('[name="source"]');
    const skillSource = root.querySelector('[name="skillSource"]');
    const updateFields = () => {
        for (const field of root.querySelectorAll('[data-use-type]')) {
            field.hidden = field.dataset.useType !== type.value
                || (field.dataset.source && field.dataset.source !== source.value)
                || (field.dataset.skillSource && field.dataset.skillSource !== skillSource.value);
        }
    };
    for (const toggle of [type, source, skillSource]) toggle.addEventListener('change', updateFields);
    updateFields();

    const macroInput = root.querySelector('[name="macroUuid"]');
    const preview = root.querySelector('[data-macro-preview]');
    const refreshPreview = async () => {
        const uuid = macroInput.value.trim();
        reviewedMacros.delete(macroInput.form);
        preview.value = '';
        if (!uuid) return;
        try {
            const macro = await resolveUseDocument(uuid, 'Macro');
            if (macroInput.value.trim() !== uuid) return;
            preview.value = `${macro.name}\n\n${macro.command}`;
            reviewedMacros.set(macroInput.form, { uuid: macro.uuid, type: macro.type, command: macro.command });
        } catch { /* The save handler reports unresolved references. */ }
    };
    macroInput.addEventListener('input', refreshPreview);
    void refreshPreview();

    for (const input of root.querySelectorAll('[data-drop-type]')) {
        input.addEventListener('dragover', event => event.preventDefault());
        input.addEventListener('drop', async event => {
            event.preventDefault();
            event.stopPropagation();
            try {
                const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
                const doc = await resolveUseDocument(data.uuid, input.dataset.dropType);
                input.value = doc.uuid;
                if (input === macroInput) await refreshPreview();
            } catch (error) { reportValuableUseError(error); }
        });
    }
}

async function editUse(item, use) {
    let draft = {
        timing: EFFECT_TIMINGS[0],
        ...use,
        macroUuid: use?.type === 'macro' ? use.uuid : '',
        tableUuid: use?.type === 'table' ? use.uuid : '',
        standardSkill: use?.skillSource === 'standard' ? use.skillName : '',
        professionSkill: use?.skillSource === 'profession' ? use.skillName : ''
    };
    while (draft) {
        const standardSkills = getStandardSkillOptions(draft.standardSkill);
        const professionSkills = getProfessionSkillOptions(item.actor, draft.professionSkill);
        const result = await dialog().wait({
            window: { title: `${useText(use ? 'Edit' : 'Add')} — ${item.name}` },
            position: { width: 520 },
            content: content([
                `<header class="situational-bonus-sheet__hero">
                    <button type="button" class="wttrpg-use-image" data-use-image title="${escape(useText('Image'))}"
                        aria-label="${escape(useText('Image'))}">
                        <img src="${escape(draft.img || VALUABLE_USE_ICON)}" alt="">
                    </button>
                    <input type="hidden" name="img" value="${escape(draft.img || VALUABLE_USE_ICON)}">
                    <input type="text" name="name" aria-label="${escape(useText('Name'))}" placeholder="${escape(useText('Name'))}" value="${escape(draft.name)}">
                </header>`,
                field('Type', select('type', ['macro', 'table', 'effect', 'skill'].map(key => localOption(key, key)), draft.type)),
                field('RunAs', select('runAs', [localOption('gm', 'GM'), localOption('player', 'Player')], draft.runAs), 'data-use-type="macro"'),
                field('MacroSource', select('source', [localOption('inline', 'Inline'), localOption('reference', 'Reference')], draft.source), 'data-use-type="macro"'),
                field('Command', `<textarea name="command" rows="7" spellcheck="false">${escape(draft.command)}</textarea>`, 'data-use-type="macro" data-source="inline"'),
                field('Macro', dropField('macroUuid', draft.macroUuid, 'Macro'), 'data-use-type="macro" data-source="reference"'),
                field('Preview', '<textarea data-macro-preview rows="6" readonly></textarea>', 'data-use-type="macro" data-source="reference"'),
                field('RollTable', dropField('tableUuid', draft.tableUuid, 'RollTable'), 'data-use-type="table"'),
                field('Timing', select('timing', [localOption('', 'ChooseEffectTiming'), ...EFFECT_TIMINGS.map(key => localOption(key, key))], draft.timing), 'data-use-type="effect"'),
                `<p data-use-type="effect">${escape(useText('EffectHint'))}</p>`,
                field('SkillSource', select('skillSource', [localOption('standard', 'StandardSkill'), localOption('profession', 'ProfessionSkill')], draft.skillSource), 'data-use-type="skill"'),
                field('StandardSkill', select('standardSkill', [localOption('', 'ChooseSkill'), ...standardSkills.map(({ value, label }) => [value, label])], draft.standardSkill), 'data-use-type="skill" data-skill-source="standard"'),
                field('ProfessionSkill', item.actor
                    ? select('professionSkill', [localOption('', 'ChooseSkill'), ...professionSkills.map(({ value, label }) => [value, label])], draft.professionSkill)
                    : `<input type="text" name="professionSkill" value="${escape(draft.professionSkill)}" placeholder="${escape(useText('ProfessionSkillName'))}">`,
                'data-use-type="skill" data-skill-source="profession"'),
                `<fieldset>
                    <legend>${escape(useText('Condition'))}</legend>
                    <input type="text" name="condition" value="${escape(draft.condition)}"
                        aria-label="${escape(useText('Condition'))}" data-condition-autocomplete>
                    <p class="hint">${escape(useText('ConditionHint'))}</p>
                </fieldset>`,
                `<fieldset data-use-description><legend>${escape(game.i18n.localize('WITCHER.Item.Description'))}</legend></fieldset>`
            ].join('')),
            render: (_event, app) => bindEditor(app, draft),
            rejectClose: false,
            buttons: [{ action: 'save', label: useText('Save'), default: true, callback: (_event, button) => ({
                ...Object.fromEntries(new FormData(button.form)),
                description: button.form.querySelector('prose-mirror').value,
                reviewedMacro: reviewedMacros.get(button.form)
            }) },
            { action: 'cancel', label: useText('Cancel') }]
        });
        if (!result || result === 'cancel') return;
        try {
            await saveValuableUse(item, use?.id, result);
            return;
        } catch (error) {
            reportValuableUseError(error);
            draft = result;
        }
    }
}

class ValuableUseManager extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        position: { width: 760, height: 560 },
        window: { icon: 'fas fa-bolt', resizable: true },
        actions: {
            createUse: ValuableUseManager.createUse,
            editUse: ValuableUseManager.editUse,
            removeUse: ValuableUseManager.removeUse
        }
    };

    static PARTS = { main: { template: TEMPLATE_PATHS.SHEET_VALUABLE_USE_MANAGER, scrollable: [''] } };

    #busy = false;

    constructor(item) {
        super();
        this.item = item;
    }

    get title() { return `${useText('Manager')} — ${this.item.name}`; }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.uses = getValuableUses(this.item).map(use => ({ ...use, img: use.img || VALUABLE_USE_ICON }));
        return context;
    }

    async #edit(use) {
        if (this.#busy) return;
        this.#busy = true;
        try {
            await editUse(this.item, use);
            await this.render();
        } catch (error) {
            reportValuableUseError(error);
        } finally {
            this.#busy = false;
        }
    }

    static createUse() {
        return this.#edit();
    }

    static editUse(_event, button) {
        const use = getValuableUses(this.item).find(entry => entry.id === button.dataset.cardId);
        if (use) return this.#edit(use);
    }

    static async removeUse(_event, button) {
        if (this.#busy) return;
        this.#busy = true;
        try {
            await saveValuableUse(this.item, button.dataset.cardId, null);
            await this.render();
        } catch (error) {
            reportValuableUseError(error);
        } finally {
            this.#busy = false;
        }
    }
}

export async function applyValuableUseEffects(item, use) {
    if (!EFFECT_TIMINGS.includes(use.timing)) failValuableUse('ChooseEffectTiming');
    if (!item.effects.some(effect => effect.system[use.timing])) {
        failValuableUse('MissingEffect');
    }
    const actors = use.timing === 'applySelf' ? [item.actor] : Array.from(game.user.targets, target => target.actor);
    const recipients = Array.from(new Map(actors.filter(Boolean).map(actor => [actor.uuid, actor])).values());
    if (!recipients.length) failValuableUse(use.timing === 'applySelf' ? 'NeedsActor' : 'NeedsTarget');
    const apply = game.api?.applyActiveEffectToActorViaId;
    if (!apply) failValuableUse('MissingEffectAPI');
    if (recipients.some(actor => !actor.isOwner && !game.users.some(user => user.active && actor.testUserPermission(user, 'OWNER')))) {
        failValuableUse('NoTargetOwner');
    }
    for (const actor of recipients) await apply(actor.uuid, item.uuid, use.timing);
}

async function chooseUse(item) {
    const uses = getValuableUses(item).map(use => ({
        ...use,
        img: use.img || VALUABLE_USE_ICON,
        available: isValuableUseAvailable(item, use)
    }));
    if (!uses.length) return;
    const firstAvailable = uses.find(use => use.available);
    if (firstAvailable) firstAvailable.checked = true;
    const html = await renderTemplate(TEMPLATE_PATHS.DIALOG_VALUABLE_USE_CHOICE, {
        uses,
        idPrefix: `valuable-use-${foundry.utils.randomID()}`,
        hasAvailable: Boolean(firstAvailable),
        hasUnavailable: uses.some(use => !use.available),
        showUnavailable: !firstAvailable
    });
    const id = await dialog().wait({
        window: { title: `${useText('Use')} — ${item.name}`, resizable: true },
        position: { width: 650 },
        content: content(html),
        rejectClose: false,
        render: (_event, app) => bindUseChoices(app, item, uses, Boolean(firstAvailable)),
        buttons: [
            { action: 'use', label: useText('Use'), default: Boolean(firstAvailable),
                callback: (_event, button) => button.form.querySelector('[name="useId"]:checked:not(:disabled)')?.value },
            { action: 'cancel', label: useText('Cancel') }
        ]
    });
    if (uses.some(use => use.available && use.id === id)) await runValuableUse(item, id, applyValuableUseEffects);
}

function bindUseChoices(app, item, uses, hasAvailable) {
    const root = app.element;
    const submit = root.querySelector('button[data-action="use"]');
    submit.disabled = !hasAvailable;
    const toggle = root.querySelector('[data-show-unavailable]');
    if (toggle) {
        const update = () => {
            for (const card of root.querySelectorAll('[data-condition-matches="false"]')) {
                card.hidden = !toggle.checked;
            }
        };
        toggle.addEventListener('change', update);
        update();
    }
    for (const info of root.querySelectorAll('[data-info-id]')) {
        info.addEventListener('click', async () => {
            const use = uses.find(entry => entry.id === info.dataset.infoId);
            if (!use) return;
            try {
                const description = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
                    foundry.utils.cleanHTML(use.description ?? ''), { relativeTo: item }
                );
                const html = await renderTemplate(TEMPLATE_PATHS.DIALOG_WEAPON_SKILL_INFO, {
                    name: use.name,
                    img: use.img,
                    parentWeapon: useText(use.type),
                    description
                });
                await dialog().prompt({
                    window: { title: use.name, resizable: true },
                    position: { width: 650 },
                    content: content(html),
                    ok: { label: useText('Close') },
                    rejectClose: false
                });
            } catch (error) { reportValuableUseError(error); }
        });
    }
}

function makeUseButton(item, compact) {
    const button = document.createElement(compact ? 'a' : 'button');
    button.className = `wttrpg-valuable-use${compact ? ' wttrpg-valuable-use-inline' : ''}`;
    button.title = useText('Use');
    button.setAttribute('aria-label', button.title);
    button.innerHTML = '<i class="fa-solid fa-bolt" aria-hidden="true"></i>';
    if (compact) {
        button.setAttribute('role', 'button');
        button.tabIndex = 0;
        button.addEventListener('keydown', event => {
            if (!['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            button.click();
        });
    } else {
        button.type = 'button';
        button.append(` ${button.title}`);
    }
    let pending = false;
    button.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        if (pending) return;
        pending = true;
        button.setAttribute('aria-busy', 'true');
        try { await chooseUse(item); }
        catch (error) { reportValuableUseError(error); }
        finally {
            pending = false;
            button.removeAttribute('aria-busy');
        }
    });
    return button;
}

export function renderValuableUses(app, html) {
    const root = html?.querySelector ? html : html?.[0];
    const doc = app.document;
    if (!root || !doc?.isOwner) return;
    root.querySelectorAll('.wttrpg-valuable-use').forEach(button => button.remove());
    if (doc.documentName === 'Actor') {
        for (const row of root.querySelectorAll('.item[data-item-id]')) {
            const item = doc.items.get(row.dataset.itemId);
            const controls = row.querySelector('.valuable-details .list-controls');
            if (controls && getValuableUses(item).length) controls.prepend(makeUseButton(item, true));
        }
    } else if (isGeneralValuable(doc) && getValuableUses(doc).length) {
        root.querySelector('textarea[name="system.description"]')?.closest('.grid')?.after(makeUseButton(doc, false));
    }
}

export function addValuableUseManager(sheet, buttons) {
    if (!game.user.isGM || !sheet.document?.isOwner || !isGeneralValuable(sheet.document)
        || sheet.constructor.name === 'WitcherConsumableConfigurationSheet') return;
    buttons.push({
        class: 'valuable-use-manager', icon: 'fas fa-circle-up', label: 'WTTRPGEnhancements.ValuableUse.Manager',
        onClick: () => {
            const item = sheet.document;
            if (!managers.has(item)) managers.set(item, new ValuableUseManager(item));
            return managers.get(item).render(true).catch(reportValuableUseError);
        }
    });
}
