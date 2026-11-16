import { MODULE } from './constants.js';
import { evaluateCondition } from './condition.js';
import { getProfessionSkills } from './professionSkill.js';

const FLAG = 'valuableUses';
const APPROVALS = 'valuableUseMacroApprovals';
const QUERY = `${MODULE.ID}.runValuableMacro`;

export const EFFECT_TIMINGS = ['applySelf', 'applyOnTarget'];
export const VALUABLE_USE_ICON = 'icons/svg/lightning.svg';
export const useText = key => game.i18n.localize(`WTTRPGEnhancements.ValuableUse.${key}`);
export const isGeneralValuable = item => item?.documentName === 'Item' && item.type === 'valuable'
    && (!item.system.type || item.system.type === 'general');

export function getValuableUses(item) {
    const uses = isGeneralValuable(item) && item.getFlag(MODULE.ID, FLAG);
    return Array.isArray(uses) ? uses.filter(use => typeof use?.id === 'string' && typeof use.name === 'string') : [];
}

function firstTarget(user) {
    return Array.from(user?.targets ?? [])[0];
}

export function isValuableUseAvailable(item, use, user = game.user, target = firstTarget(user)?.actor ?? null) {
    if (use.type === 'effect' && !EFFECT_TIMINGS.includes(use.timing)) return false;
    const condition = use.condition ?? '';
    return typeof condition === 'string' && evaluateCondition(condition, {
        attacker: item.actor ?? null,
        target,
        source: item
    });
}

function getStandardSkill(name) {
    return Object.values(CONFIG.WITCHER?.skillMap ?? {}).find(skill => skill.name === name);
}

function getProfessionSkill(actor, name) {
    return getProfessionSkills(actor).find(skill => skill?.skillName === name);
}

function rollValuableSkillCheck(item, use) {
    const actor = item.actor;
    if (!actor) fail('NeedsSkillActor');
    if (use.skillSource === 'standard') {
        const skill = getStandardSkill(use.skillName);
        if (!skill || !actor.system?.skills?.[skill.attribute.name]?.[skill.name]) fail('SkillUnavailable');
        return actor.rollSkillCheck(skill);
    }
    if (use.skillSource === 'profession') {
        const skill = getProfessionSkill(actor, use.skillName);
        if (!skill || !actor.system?.stats?.[skill.stat]) fail('SkillUnavailable');
        return actor.doProfessionSkillRoll(skill);
    }
    fail('SkillUnavailable');
}

export function failValuableUse(key) { throw new ValuableUseError(key); }
const fail = failValuableUse;

export async function resolveUseDocument(uuid, type) {
    if (typeof uuid !== 'string' || !uuid) fail('MissingDocument');
    const document = await fromUuid(uuid);
    if (document?.documentName !== type) fail('MissingDocument');
    return document;
}

async function macroData(use) {
    if (use.source === 'inline' && typeof use.command === 'string' && use.command.trim()) {
        return { type: 'script', command: use.command };
    }
    if (use.source === 'reference') return resolveUseDocument(use.uuid, 'Macro');
    fail('MissingMacro');
}

async function fingerprint(use, { type, command }) {
    const fields = [use.source, use.uuid ?? null, use.runAs, type, command];
    // Preserve existing approvals for uses without a condition.
    if (use.condition) fields.push(use.condition);
    const content = JSON.stringify(fields);
    // Inline source already lives in the item's flags. Keep linked macro source out of world settings.
    if (use.source === 'inline') return content;
    if (!globalThis.crypto?.subtle) fail('SecureMacroContext');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

// Item flags are player-writable. World settings require Foundry's settings permission.
// Approve a single reviewed action at a time, for its exact item and macro content.
let approvalWrite = Promise.resolve();
function updateApproval(item, id, approval) {
    const write = approvalWrite.then(async () => {
        const all = { ...game.settings.get(MODULE.ID, APPROVALS) };
        const approvals = (all[item.uuid] ?? []).filter(entry => entry.id !== id);
        if (approval) approvals.push({ id, fingerprint: approval });
        if (approvals.length) all[item.uuid] = approvals;
        else delete all[item.uuid];
        await game.settings.set(MODULE.ID, APPROVALS, all);
    });
    approvalWrite = write.catch(() => {});
    return write;
}

export async function saveValuableUse(item, id, draft) {
    if (!game.user.isGM || !item?.isOwner || !isGeneralValuable(item)) fail('NotAllowed');
    const uses = getValuableUses(item);
    const useId = id ?? foundry.utils.randomID();
    if (id && !uses.some(use => use.id === id)) fail('MissingUse');
    let use;
    let approval;
    if (draft) {
        use = {
            id: useId,
            name: draft.name?.trim(),
            type: draft.type,
            img: draft.img?.trim() || VALUABLE_USE_ICON,
            description: draft.description ? foundry.utils.cleanHTML(draft.description) : '',
            condition: draft.condition?.trim() ?? ''
        };
        if (!use.name) fail('MissingName');
        switch (use.type) {
            case 'macro': {
                use.runAs = draft.runAs === 'player' ? 'player' : 'gm';
                use.source = draft.source;
                if (use.source === 'reference') use.uuid = draft.macroUuid?.trim();
                else use.command = draft.command;
                const macro = await macroData(use);
                if (use.source === 'reference') {
                    const reviewed = draft.reviewedMacro;
                    if (reviewed?.uuid !== macro.uuid || reviewed?.type !== macro.type || reviewed?.command !== macro.command) {
                        fail('ReviewMacro');
                    }
                    use.uuid = macro.uuid;
                }
                if (use.runAs === 'gm' || globalThis.crypto?.subtle || use.source === 'inline') {
                    approval = await fingerprint(use, macro);
                }
                break;
            }
            case 'table':
                use.uuid = (await resolveUseDocument(draft.tableUuid?.trim(), 'RollTable')).uuid;
                break;
            case 'effect':
                if (!EFFECT_TIMINGS.includes(draft.timing)) fail('ChooseEffectTiming');
                use.timing = draft.timing;
                break;
            case 'skill':
                use.skillSource = draft.skillSource;
                if (use.skillSource === 'standard' && getStandardSkill(draft.standardSkill)) {
                    use.skillName = draft.standardSkill;
                } else if (use.skillSource === 'profession') {
                    const name = draft.professionSkill?.trim();
                    if (!name || (item.actor && !getProfessionSkill(item.actor, name))) fail('ChooseSkill');
                    use.skillName = name;
                } else {
                    fail('ChooseSkill');
                }
                break;
            default: fail('MissingUse');
        }
    }
    const next = id ? uses.flatMap(entry => entry.id === id ? (use ? [use] : []) : [entry]) : [...uses, use];
    await item.setFlag(MODULE.ID, FLAG, next);
    await updateApproval(item, useId, approval);
}

function assertUseOwner(item, user) {
    if (!isGeneralValuable(item) || !user || !item.testUserPermission(user, 'OWNER')) fail('NotAllowed');
}

async function executeMacro(item, use, user) {
    if (use.source === 'inline' && !game.user.can('MACRO_SCRIPT')) fail('MacroPermission');
    const data = await macroData(use);
    if (game.user.isGM) {
        const snapshot = { type: data.type, command: data.command };
        const signature = await fingerprint(use, snapshot);
        const approved = game.settings.get(MODULE.ID, APPROVALS)[item.uuid];
        if (!approved?.some(entry => entry.id === use.id && entry.fingerprint === signature)
            || data.type !== snapshot.type || data.command !== snapshot.command) {
            fail('UnapprovedMacro');
        }
    }
    const macro = use.source === 'reference' ? data : new Macro({
        ...data, name: use.name, author: game.user.id,
        ownership: { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
    });
    if (!macro.canExecute) fail('MacroPermission');
    const actor = item.actor ?? null;
    const activeTokens = actor?.getActiveTokens() ?? [];
    const token = actor?.token?.object ?? activeTokens.find(token => token.controlled) ?? activeTokens[0] ?? null;
    const speaker = actor ? ChatMessage.getSpeaker({ actor, token }) : { alias: item.name };
    await macro.execute({ item, actor, token, speaker, user });
}

export async function handleValuableMacroQuery(payload, { user } = {}) {
    const { itemUuid, useId, targetTokenId } = payload ?? {};
    // The query transport supplies the authenticated sender. Only accept a target token ID, never actor data.
    if (!game.user.isGM || !user || typeof itemUuid !== 'string' || typeof useId !== 'string') return 'NotAllowed';
    const sender = game.users.get(typeof user === 'string' ? user : user.id);
    const item = await fromUuid(itemUuid);
    if (!sender?.active || !isGeneralValuable(item) || !item.testUserPermission(sender, 'OWNER')) return 'NotAllowed';
    const use = getValuableUses(item).find(entry => entry.id === useId);
    if (use?.type !== 'macro' || use.runAs === 'player') return 'MissingUse';
    try {
        let target = firstTarget(sender)?.actor ?? null;
        // Foundry only synchronizes User.targets to clients viewing the same scene.
        if (!target && use.condition && typeof targetTokenId === 'string' && sender.viewedScene) {
            const token = game.scenes?.get(sender.viewedScene)?.tokens.get(targetTokenId);
            if (token && (!token.hidden || token.actor?.testUserPermission(sender, 'OWNER'))) {
                target = token.actor;
            }
        }
        if (!isValuableUseAvailable(item, use, sender, target)) fail('Unavailable');
        await executeMacro(item, use, sender);
        return true;
    } catch (error) {
        // Return only module messages, not exceptions from macro code on the GM client.
        if (error instanceof ValuableUseError) return error.key;
        console.error(`${MODULE.ID} | Valuable macro`, error);
        return 'UseError';
    }
}

export async function runValuableUse(item, useId, runEffect) {
    assertUseOwner(item, game.user);
    const use = getValuableUses(item).find(entry => entry.id === useId);
    if (!use) fail('MissingUse');
    if (use.type === 'effect' && !EFFECT_TIMINGS.includes(use.timing)) fail('ChooseEffectTiming');
    if (!isValuableUseAvailable(item, use)) fail('Unavailable');
    switch (use?.type) {
        case 'macro': {
            if (game.user.isGM || use.runAs === 'player') return executeMacro(item, use, game.user);
            const gm = game.users.activeGM;
            if (!gm) fail('NoGM');
            if (!game.user.can('QUERY_USER')) fail('QueryPermission');
            const payload = { itemUuid: item.uuid, useId };
            const target = use.condition && firstTarget(game.user);
            if (target?.id) payload.targetTokenId = target.id;
            const result = await gm.query(QUERY, payload, { timeout: 120_000 });
            if (result !== true) fail(typeof result === 'string' ? result : 'UseError');
            return;
        }
        case 'table': {
            const table = await resolveUseDocument(use.uuid, 'RollTable');
            if (!table.testUserPermission(game.user, 'OBSERVER')
                || (!table.replacement && !table.pack && !table.canUserModify(game.user, 'update'))) fail('TablePermission');
            return table.draw();
        }
        case 'effect':
            return runEffect(item, use);
        case 'skill':
            return rollValuableSkillCheck(item, use);
        default: fail('MissingUse');
    }
}

class ValuableUseError extends Error {
    constructor(key) {
        super(useText(key));
        this.key = key;
    }
}

export function reportValuableUseError(error) {
    if (error instanceof ValuableUseError) return ui.notifications.warn(error.message);
    console.error(`${MODULE.ID} | Valuable use`, error);
    ui.notifications.error(useText('UseError'));
}

export function registerValuableUseSettings() {
    game.settings.register(MODULE.ID, APPROVALS, { scope: 'world', config: false, type: Object, default: {} });
    CONFIG.queries[QUERY] = handleValuableMacroQuery;
}
