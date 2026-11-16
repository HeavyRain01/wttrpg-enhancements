import { cloneAttachedWeaponSkillsToActor } from '../util/weaponSkillAttachment.js';
import { BONUS_ITEM_TYPES, ITEM_TYPES } from '../util/constants.js';
import { cloneAttachedSituationalBonusesToActor } from '../mixin/itemSituationalBonusMixin.js';

export async function wrapAddItem(wrapped, addItem, numberOfItem, forcecreate = false) {
    const beforeIds = new Set(this.items.map(item => item.id));
    const existingItem = this.items.find(item => item.name == addItem?.name && item.type == addItem?.type);

    const result = await wrapped(addItem, numberOfItem, forcecreate);

    if (!BONUS_ITEM_TYPES.includes(addItem?.type)) {
        return result;
    }

    const targetItem = existingItem && !forcecreate && !existingItem.system.isStored
        ? existingItem
        : this.items.find(item => !beforeIds.has(item.id) && item.name == addItem?.name && item.type == addItem?.type)
            ?? this.items.find(item => item.name == addItem?.name && item.type == addItem?.type);

    if (targetItem && addItem?.type === ITEM_TYPES.WEAPON) {
        await cloneAttachedWeaponSkillsToActor(addItem, this, targetItem);
    }
    if (targetItem) await cloneAttachedSituationalBonusesToActor(addItem, this, targetItem);

    return result;
}


