import { MODULE, TEMPLATE_PATHS } from '../util/constants.js';
import {
    canEditMonsterPresets, captureMonsterPreset, DEFAULT_MONSTER_PRESET_ID, getActiveMonsterPresetId, getMonsterPresets,
    getWildcardImages, initializeMonsterPresets, PLACEMENT_FLAG, RANDOM_PRESET, saveMonsterPresets,
    switchActorMonsterPreset
} from '../data/monsterPresets.js';

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;
const prefix = 'WTTRPGEnhancements.MonsterPresets';
const localize = key => game.i18n.localize(`${prefix}.${key}`);
const managers = new WeakMap();

export default class MonsterPresetManager extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        position: { width: 540, height: 'auto' },
        window: { icon: 'fa-solid fa-layer-group', resizable: true },
        actions: {
            create: this.editPreset,
            edit: this.editPreset,
            switch: this.switchPreset,
            replace: this.replacePreset,
            remove: this.removePreset
        }
    };

    static PARTS = {
        presets: { template: TEMPLATE_PATHS.SHEET_MONSTER_PRESETS, scrollable: ['.monster-preset-list'] }
    };

    constructor(actor, baseActor) {
        super({ id: `wttrpg-monster-presets-${actor.uuid.replaceAll('.', '-')}` });
        this.actor = actor;
        this.baseActor = baseActor;
    }

    get title() {
        return `${localize('Title')} — ${this.actor.name}`;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const activeId = getActiveMonsterPresetId(this.baseActor);
        context.isBaseActor = this.actor === this.baseActor;
        context.presets = getMonsterPresets(this.baseActor).map(({ id, name, images }) => ({
            id, name, images,
            active: context.isBaseActor && id === activeId,
            canRemove: id !== DEFAULT_MONSTER_PRESET_ID && id !== activeId
        }));
        if (context.isBaseActor) {
            const choices = {
                '': localize('PlacementCurrent'),
                [RANDOM_PRESET]: localize('PlacementRandom'),
                ...Object.fromEntries(context.presets.map(({ id, name }) => [id, name]))
            };
            const configured = this.baseActor.prototypeToken.getFlag(MODULE.ID, PLACEMENT_FLAG) ?? '';
            context.placementChoices = choices;
            context.placement = Object.hasOwn(choices, configured) ? configured : DEFAULT_MONSTER_PRESET_ID;
            context.placementId = `${this.id}-placement`;
        }
        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const select = this.element.querySelector('[name="presetOnPlacement"]');
        if (!select) return;
        select.onchange = async () => {
            select.disabled = true;
            try {
                if (!canEditMonsterPresets(this.baseActor)) {
                    ui.notifications.warn(localize('SaveFailed'));
                    return;
                }
                const updated = await this.baseActor.update({
                    [`prototypeToken.flags.${MODULE.ID}.${PLACEMENT_FLAG}`]: select.value
                });
                if (!updated) ui.notifications.warn(localize('SaveFailed'));
            } catch (error) {
                console.error(`${MODULE.ID} | Monster preset placement setting failed to save`, error);
                ui.notifications.error(localize('SaveFailed'));
            } finally {
                select.disabled = false;
                await this.render();
            }
        };
    }

    async savePresets(change, activeId) {
        if (!this.actor.isOwner) return;
        const presets = change(getMonsterPresets(this.baseActor));
        const updated = await saveMonsterPresets(this.baseActor, presets, activeId);
        if (!updated) ui.notifications.warn(localize('SaveFailed'));
        await this.render();
    }

    static async editPreset(_event, target) {
        const id = target.dataset.presetId;
        const existing = getMonsterPresets(this.baseActor).find(preset => preset.id === id);
        if (id && !existing) return this.render();
        const images = (await getWildcardImages(this.baseActor)).map(src => ({
            src,
            label: src.split('/').pop(),
            checked: existing?.images.includes(src)
        }));
        const result = await DialogV2.prompt({
            window: { title: localize(existing ? 'Edit' : 'Create') },
            position: { width: 540 },
            modal: true,
            content: await renderTemplate(TEMPLATE_PATHS.DIALOG_EDIT_MONSTER_PRESET, { existing, images }),
            ok: {
                label: localize('Save'),
                callback: (_event, button) => ({
                    name: button.form.elements.presetName.value.trim(),
                    images: [...button.form.querySelectorAll('[name="artwork"]:checked')].map(input => input.value)
                })
            }
        });
        if (!result) return;
        if (!result.name) return ui.notifications.warn(localize('NameRequired'));
        if (existing) {
            return this.savePresets(presets => presets.map(preset => preset.id === id ? { ...preset, ...result } : preset));
        }
        const newPreset = { id: foundry.utils.randomID(), ...result, ...captureMonsterPreset(this.actor) };
        return this.savePresets(presets => [...presets, newPreset], this.actor.isToken ? undefined : newPreset.id);
    }

    static async switchPreset(_event, target) {
        const controls = this.element.querySelectorAll('button[data-action]');
        for (const control of controls) control.disabled = true;
        try {
            if (!await switchActorMonsterPreset(this.actor, target.dataset.presetId)) {
                ui.notifications.warn(localize('ApplyFailed'));
            }
        } catch (error) {
            console.error(`${MODULE.ID} | Actor preset switch failed`, error);
            ui.notifications.error(localize('ApplyFailed'));
        } finally {
            for (const control of controls) control.disabled = false;
            await this.render();
        }
    }

    static async replacePreset(_event, target) {
        const id = target.dataset.presetId;
        if (!await DialogV2.confirm({
            window: { title: localize('Replace') },
            modal: true,
            content: `<p>${localize('ReplaceConfirm')}</p>`
        })) return;
        const snapshot = captureMonsterPreset(this.actor);
        return this.savePresets(presets => presets.map(preset => preset.id === id ? { ...preset, ...snapshot } : preset));
    }

    static async removePreset(_event, target) {
        const id = target.dataset.presetId;
        if (!await DialogV2.confirm({
            window: { title: localize('Delete') },
            modal: true,
            content: `<p>${localize('DeleteConfirm')}</p>`
        })) return;
        if (id === DEFAULT_MONSTER_PRESET_ID || id === getActiveMonsterPresetId(this.baseActor)) return this.render();
        return this.savePresets(presets => presets.filter(preset => preset.id !== id));
    }
}

export function addMonsterPresetManager(sheet, buttons) {
    const actor = sheet.document;
    if (actor?.documentName !== 'Actor' || actor.type !== 'monster' || !actor.isOwner) return;
    const baseActor = actor.isToken ? actor.token?.baseActor : actor;
    if (!canEditMonsterPresets(baseActor)) return;
    if (!baseActor.pack && game.actors.get(baseActor.id) !== baseActor) return;
    buttons.push({
        class: 'monster-presets',
        icon: 'fa-solid fa-layer-group',
        label: `${prefix}.Title`,
        onClick: async () => {
            if (!canEditMonsterPresets(baseActor)) return ui.notifications.warn(localize('SaveFailed'));
            let manager = managers.get(actor);
            if (manager) return manager.render(true);
            manager = new MonsterPresetManager(actor, baseActor);
            managers.set(actor, manager);
            try {
                if (await initializeMonsterPresets(baseActor, localize('DefaultPreset'))) return await manager.render(true);
                ui.notifications.warn(localize('SaveFailed'));
            } catch (error) {
                console.error(`${MODULE.ID} | Monster preset manager failed to open`, error);
                ui.notifications.error(localize('SaveFailed'));
            } finally {
                if (!manager.rendered) managers.delete(actor);
            }
        }
    });
}
