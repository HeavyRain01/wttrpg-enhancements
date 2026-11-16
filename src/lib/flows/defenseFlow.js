import { isWeaponSkill } from '../util/weaponSkillAttachment.js';
import { getSkillLabel } from '../util/skillLabel.js';
import { ITEM_TYPES, SITUATIONAL_BONUS_SCOPES } from '../util/constants.js';
import { appendFormula, renderSituationalBonusCards, selectedBonusFormula } from '../util/situationalBonus.js';

const { DialogV2 } = foundry.applications.api;
const DEFENSE_ITEM = Symbol('defenseItem');

export function wrapCreateDefenseOption(wrapped, attack) {
    return { ...wrapped(attack), [DEFENSE_ITEM]: this };
}

function getAdditionalDefenseSkills(skill) {
    const values = Array.isArray(skill?.system?.additionalDefenseSkills)
        ? skill.system.additionalDefenseSkills
        : Array.from(skill?.system?.additionalDefenseSkills ?? []);

    return Array.from(new Set(values.filter(Boolean)));
}

function buildAdditionalDefenseButtons(skill) {
    return getAdditionalDefenseSkills(skill)
        .map(skillName => CONFIG.WITCHER?.skillMap?.[skillName])
        .filter(Boolean)
        .map(skillMapEntry => ({
            action: `weapon-skill-defense-${skillMapEntry.name}`,
            label: getSkillLabel(skillMapEntry),
            callback: (_event, button) => ({
                defenseAction: {
                    label: getSkillLabel(skillMapEntry),
                    value: skillMapEntry.name,
                    skills: [skillMapEntry.name],
                    modifier: 0,
                    stagger: false,
                    block: false
                },
                extraDefense: button.form.elements.isExtraDefense.checked,
                customDef: button.form.elements.customDef.value
            })
        }));
}

export async function wrapPrepareAndExecuteDefense(wrapped, attack, defenseOptions, attackDamageObject, totalAttack, attacker) {
    const attackItem = attackDamageObject?.itemUuid ? await fromUuid(attackDamageObject.itemUuid) : null;
    if (!isWeaponSkill(attackItem)) {
        return wrapped(attack, defenseOptions, attackDamageObject, totalAttack, attacker);
    }

    const additionalButtons = buildAdditionalDefenseButtons(attackItem);
    if (!additionalButtons.length) {
        return wrapped(attack, defenseOptions, attackDamageObject, totalAttack, attacker);
    }

    const originalWait = DialogV2.wait.bind(DialogV2);
    DialogV2.wait = function patchedWait(config = {}) {
        const isDefenseDialog = config.window?.title === game.i18n.localize('WITCHER.Dialog.DefenseTitle');
        if (!isDefenseDialog || !Array.isArray(config.buttons)) {
            return originalWait(config);
        }

        return originalWait({
            ...config,
            buttons: [...config.buttons, ...additionalButtons]
        });
    };

    try {
        return await wrapped(attack, defenseOptions, attackDamageObject, totalAttack, attacker);
    } finally {
        DialogV2.wait = originalWait;
    }
}

export async function wrapSkillDefense(wrapped, skill, attack, modifiers, defenseAction, defenseItemId, skillOverride) {
    const scope = SITUATIONAL_BONUS_SCOPES.DEFENSE;
    const execute = values => wrapped(skill, attack, values, defenseAction, defenseItemId, skillOverride);
    if (!this.items.some(item => item.type === ITEM_TYPES.SITUATIONAL_BONUS && item.system.scope === scope)) {
        return execute(modifiers);
    }

    const damage = attack.attackDamageObject;
    const [attacker, source] = await Promise.all([
        attack.attacker ? fromUuid(attack.attacker) : null,
        damage?.item ?? (damage?.itemUuid ? fromUuid(damage.itemUuid) : null)
    ]);
    const item = (defenseItemId && this.items.get(defenseItemId)) || defenseAction[DEFENSE_ITEM];
    const cards = await renderSituationalBonusCards(this, [scope], {
        attacker,
        target: this,
        source,
        damage,
        defense: { type: defenseAction.value, skill: skill.skillName ?? skillOverride?.skillMapEntry?.label, item }
    });
    if (!cards) return execute(modifiers);

    const selection = await DialogV2.wait({
        window: { title: game.i18n.localize('WTTRPGEnhancements.SituationalBonus.DefenseTitle') },
        content: cards,
        modal: true,
        rejectClose: false,
        buttons: [{
            action: 'roll',
            label: 'WTTRPGEnhancements.SituationalBonus.RollDefense',
            default: true,
            callback: (_event, button) => ({ formula: selectedBonusFormula(button.form, scope) })
        }]
    });
    if (!selection) return;
    if (!selection.formula) return execute(modifiers);

    const formula = Roll.replaceFormulaData(selection.formula, this.getRollData());
    return execute({ ...modifiers, customDef: appendFormula(modifiers.customDef, formula) });
}
