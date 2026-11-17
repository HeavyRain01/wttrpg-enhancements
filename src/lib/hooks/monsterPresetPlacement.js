import { MODULE } from '../util/constants.js';
import {
    ACTIVE_PRESET_FLAG, DEFAULT_MONSTER_PRESET_ID, getMonsterPresets, getWildcardImages, PLACEMENT_FLAG,
    prepareMonsterTokenPreset, RANDOM_PRESET
} from '../data/monsterPresets.js';

export async function wrapPrepareMonsterTokenCreation(wrapped, data, options, user) {
    const allowed = await wrapped(data, options, user);
    if (allowed === false || !this.parent || options.isPaste || options.isUndo) return allowed;
    const actor = this.baseActor;
    if (actor?.type !== 'monster' || !actor.isOwner || this.getFlag(MODULE.ID, ACTIVE_PRESET_FLAG)) return allowed;
    // Foundry copies the prototype's flag to fresh token documents. Existing token deltas keep their own setup.
    const configured = this.getFlag(MODULE.ID, PLACEMENT_FLAG);
    if (!configured || data.delta?.items?.length) return allowed;
    const presets = getMonsterPresets(actor);
    const preset = configured === RANDOM_PRESET
        ? presets[Math.floor(Math.random() * presets.length)]
        : (presets.find(entry => entry.id === configured) ?? presets.find(entry => entry.id === DEFAULT_MONSTER_PRESET_ID));
    if (!preset) return allowed;

    const wildcardImages = new Set(await getWildcardImages(actor));
    const images = preset.images.filter(src => wildcardImages.has(src));
    const tokenId = this.id ?? foundry.utils.randomID();
    const update = prepareMonsterTokenPreset(this, preset, tokenId);
    if (images.length) update['texture.src'] = images[Math.floor(Math.random() * images.length)];

    // Preserve the ID used by preset items that reference other items on this token.
    this.updateSource({ _id: tokenId, actorLink: false });
    this.updateSource(update);
    options.keepId = true;
    return allowed;
}
