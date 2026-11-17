import { MODULE, TEMPLATE_PATHS } from '../util/constants.js';
import {
    ACTIVE_PRESET_FLAG, applyMonsterPreset, canApplyMonsterPreset, getMonsterPresets, getWildcardImages,
    hasSpentResources, PRESET_UPDATE_OPTION
} from '../data/monsterPresets.js';

const prefix = 'WTTRPGEnhancements.MonsterPresets';
const localize = key => game.i18n.localize(`${prefix}.${key}`);
const openSwitchers = new WeakSet();

export function refreshMonsterPresetSheet(token, _changes, options) {
    if (options[PRESET_UPDATE_OPTION]) token.actor?.render(false, { renderContext: 'updateActor' });
}

export function addMonsterPresetHudControl(hud, html) {
    const token = hud.document ?? hud.object?.document;
    if (!canApplyMonsterPreset(token) || !getMonsterPresets(token.baseActor).length) return;
    const root = html instanceof HTMLElement ? html : html[0];
    const column = root?.querySelector('.col.left');
    if (!column || column.querySelector('.monster-preset-control')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'control-icon monster-preset-control';
    button.setAttribute('aria-label', localize('Switch'));
    button.dataset.tooltip = localize('Switch');
    button.innerHTML = '<i class="fa-solid fa-layer-group" aria-hidden="true"></i>';
    button.addEventListener('click', () => switchPreset(token));
    column.append(button);
}

async function switchPreset(token) {
    if (openSwitchers.has(token) || !canApplyMonsterPreset(token)) return;
    openSwitchers.add(token);
    try {
        const baseActor = token.baseActor;
        const presets = getMonsterPresets(baseActor);
        const wildcardImages = new Set(await getWildcardImages(baseActor));
        const activeId = token.getFlag(MODULE.ID, ACTIVE_PRESET_FLAG);
        const choices = presets.map(preset => ({
            id: preset.id,
            name: preset.name,
            active: preset.id === activeId,
            images: preset.images.filter(src => wildcardImages.has(src))
        }));
        if (!choices.length) return;

        const result = await foundry.applications.api.DialogV2.prompt({
            window: { title: localize('Switch') },
            modal: true,
            content: await foundry.applications.handlebars.renderTemplate(TEMPLATE_PATHS.DIALOG_SWITCH_MONSTER_PRESET, {
                choices, spent: hasSpentResources(token.actor), linked: token.actorLink
            }),
            render: (_event, dialog) => {
                const presetSelect = dialog.element.querySelector('[name="presetId"]');
                const imageSelect = dialog.element.querySelector('[name="presetImage"]');
                const preview = dialog.element.querySelector('.monster-preset-preview');
                const showPreview = () => {
                    preview.hidden = !imageSelect.value;
                    if (imageSelect.value) preview.src = imageSelect.value;
                };
                const showImages = () => {
                    const { images } = choices.find(choice => choice.id === presetSelect.value);
                    imageSelect.replaceChildren(new Option(localize('KeepImage'), ''), ...images.map(src => {
                        return new Option(src.split('/').pop(), src);
                    }));
                    imageSelect.closest('.form-group').hidden = !images.length;
                    imageSelect.value = images.includes(token.texture.src) ? token.texture.src : (images[0] ?? '');
                    showPreview();
                };
                presetSelect.addEventListener('change', showImages);
                imageSelect.addEventListener('change', showPreview);
                showImages();
            },
            ok: {
                label: localize('Apply'),
                callback: (_event, button) => ({
                    id: button.form.elements.presetId.value,
                    image: button.form.elements.presetImage.value
                })
            }
        });
        if (!result) return;
        const preset = getMonsterPresets(baseActor).find(entry => entry.id === result.id);
        if (baseActor !== token.baseActor || !preset) return ui.notifications.warn(localize('Unavailable'));
        const image = baseActor.prototypeToken.randomImg && preset.images.includes(result.image)
            && wildcardImages.has(result.image) ? result.image : '';
        if (!await applyMonsterPreset(token, preset, image)) ui.notifications.warn(localize('ApplyFailed'));
    } catch (error) {
        console.error(`${MODULE.ID} | Monster preset switch failed`, error);
        ui.notifications.error(localize('ApplyFailed'));
    } finally {
        openSwitchers.delete(token);
    }
}
