import { registerCombatHooks } from "./lib/hooks/combat.js";
import { addActiveEffectEnhanceOption, addItemButtonAppV2, addSituationalBonusButton } from "./lib/hooks/buttons.js";
import { addEnhancedDamageContextOption } from "./lib/hooks/chat.js";
import { wrapDamageRoll } from "./lib/flows/damageRollFlow.js";
import { wrapWeaponAttack } from "./lib/flows/weaponAttackFlow.js";
import { wrapCreateDefenseOption, wrapPrepareAndExecuteDefense, wrapSkillDefense } from "./lib/flows/defenseFlow.js";
import { wrapAddItem } from "./lib/flows/addItemFlow.js";
import { EnhancementRoll } from "./lib/roll/enhancementRoll.js";
import { wrapGetLocationArmor } from "./lib/core/temporarySp.js";
import { MODULE, TEMPLATE_PATHS } from "./lib/util/constants.js";
import { registerItemTypes } from "./lib/setup/itemTypeRegistration.js";
import { registerSettings } from "./lib/setup/settings.js";
import { registerArgonCombatHudIntegration } from "./lib/integrations/argonCombatHud.js";
import { wrapCustomSkillCheck, wrapProfessionSkillCheck, wrapSkillCheck } from "./lib/flows/skillCheckFlow.js";
import { wrapCastSpell } from "./lib/flows/spellAttackFlow.js";
import { registerValuableJournals } from "./lib/integrations/valuableJournal.js";
import { addValuableUseManager, renderValuableUses } from "./lib/integrations/valuableUse.js";
import { registerValuableUseSettings } from "./lib/util/valuableUse.js";
import { renderBonusDialog } from "./lib/hooks/bonusDialog.js";
import { addMonsterPresetManager } from "./lib/sheet/monsterPresetManager.js";
import { addMonsterPresetHudControl, refreshMonsterPresetSheet } from "./lib/hooks/monsterPresetHud.js";
import { wrapPrepareMonsterTokenCreation } from "./lib/hooks/monsterPresetPlacement.js";
Hooks.on('renderDialogV2', renderBonusDialog);
Hooks.once('init', function () {
    console.log('The Witcher TRPG Enhancements | Initializing module')
    registerItemTypes()
    registerSettings()
    registerValuableUseSettings()
    registerArgonCombatHudIntegration()
    registerCustomRollClasses()
    preloadTemplates()
    console.log('The Witcher TRPG Enhancements | Module initialized')
})
Hooks.once('ready', async function () {
    registerValuableJournals()
    libWrapper.register(MODULE.ID, "CONFIG.Item.documentClass.prototype.rollDamage", wrapDamageRoll, 'WRAPPER')
    libWrapper.register(MODULE.ID, "CONFIG.Actor.documentClass.prototype.weaponAttack", wrapWeaponAttack, 'MIXED')
    libWrapper.register(MODULE.ID, "CONFIG.Actor.documentClass.prototype.prepareAndExecuteDefense", wrapPrepareAndExecuteDefense, 'WRAPPER')
    libWrapper.register(MODULE.ID, "CONFIG.Item.documentClass.prototype.createDefenseOption", wrapCreateDefenseOption, 'WRAPPER')
    libWrapper.register(MODULE.ID, "CONFIG.Actor.documentClass.prototype.skillDefense", wrapSkillDefense, 'MIXED')
    libWrapper.register(MODULE.ID, "CONFIG.Actor.documentClass.prototype.addItem", wrapAddItem, 'WRAPPER')
    libWrapper.register(MODULE.ID, "CONFIG.Actor.documentClass.prototype.getLocationArmor", wrapGetLocationArmor, 'WRAPPER')
    libWrapper.register(MODULE.ID, "CONFIG.Actor.documentClass.prototype.rollSkillCheck", wrapSkillCheck, 'WRAPPER')
    libWrapper.register(MODULE.ID, "CONFIG.Actor.documentClass.prototype.rollCustomSkillCheck", wrapCustomSkillCheck, 'WRAPPER')
    libWrapper.register(MODULE.ID, "CONFIG.Actor.documentClass.prototype.doProfessionSkillRoll", wrapProfessionSkillCheck, 'WRAPPER')
    libWrapper.register(MODULE.ID, "CONFIG.Actor.documentClass.prototype.castSpell", wrapCastSpell, 'WRAPPER')
    libWrapper.register(MODULE.ID, "CONFIG.Token.documentClass.prototype._preCreate", wrapPrepareMonsterTokenCreation, 'WRAPPER')
    registerCombatHooks()
})
Hooks.on('getHeaderControlsApplicationV2', addActiveEffectEnhanceOption)
Hooks.on('getHeaderControlsApplicationV2', addItemButtonAppV2)
Hooks.on('getHeaderControlsApplicationV2', addValuableUseManager)
Hooks.on('renderApplicationV2', renderValuableUses)
Hooks.on('getHeaderControlsApplicationV2', addSituationalBonusButton)
Hooks.on('getHeaderControlsApplicationV2', addMonsterPresetManager)
Hooks.on('renderTokenHUD', addMonsterPresetHudControl)
Hooks.on('updateToken', refreshMonsterPresetSheet)
Hooks.on('getChatMessageContextOptions', addEnhancedDamageContextOption)
function registerCustomRollClasses() {
    if (!Array.isArray(CONFIG.Dice?.rolls)) return
    if (!CONFIG.Dice.rolls.some(rollClass => rollClass?.name === EnhancementRoll.name)) {
        CONFIG.Dice.rolls.push(EnhancementRoll)
    }
}
async function preloadTemplates() {
    return foundry.applications.handlebars.loadTemplates([
        TEMPLATE_PATHS.PARTIAL_MANAGER_CARD,
        TEMPLATE_PATHS.PARTIAL_ACTION_CARD,
        TEMPLATE_PATHS.SHEET_AMPLIFIER,
        TEMPLATE_PATHS.SHEET_LIFESTEAL,
        TEMPLATE_PATHS.SHEET_DOT,
        TEMPLATE_PATHS.SHEET_HOT,
        TEMPLATE_PATHS.SHEET_DAMAGE_PROPERTIES,
        TEMPLATE_PATHS.SHEET_WEAPON_SKILL,
        TEMPLATE_PATHS.SHEET_WEAPON_SKILL_MANAGER,
        TEMPLATE_PATHS.SHEET_SITUATIONAL_BONUS,
        TEMPLATE_PATHS.SHEET_SITUATIONAL_BONUS_MANAGER,
        TEMPLATE_PATHS.SHEET_ITEM_SITUATIONAL_BONUS_MANAGER,
        TEMPLATE_PATHS.SHEET_VALUABLE_USE_MANAGER,
        TEMPLATE_PATHS.SHEET_MONSTER_PRESETS,
        TEMPLATE_PATHS.DIALOG_EDIT_MONSTER_PRESET,
        TEMPLATE_PATHS.DIALOG_SWITCH_MONSTER_PRESET,
        TEMPLATE_PATHS.DIALOG_SITUATIONAL_BONUSES,
        TEMPLATE_PATHS.DIALOG_WEAPON_SKILL_ATTACH_MODE,
        TEMPLATE_PATHS.DIALOG_WEAPON_SKILL_ATTACK_CHOICE,
        TEMPLATE_PATHS.DIALOG_WEAPON_SKILL_INFO,
        TEMPLATE_PATHS.DIALOG_VALUABLE_USE_CHOICE,
        TEMPLATE_PATHS.DIALOG_APPLY_DAMAGE,
        TEMPLATE_PATHS.ROLL_ENHANCEMENT,
        TEMPLATE_PATHS.TOOLTIP_ENHANCEMENT
    ]);
}



