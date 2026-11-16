export function getSkillLabel(skill) {
    const canonicalKey = `WITCHER.skills.${skill.name}.label`;
    const key = game.i18n.has(skill.label) ? skill.label : canonicalKey;
    return game.i18n.has(key) ? game.i18n.localize(key) : game.i18n.localize(skill.label);
}

export function getStandardSkillOptions(currentValue) {
    const options = Object.values(CONFIG.WITCHER?.skillMap ?? {})
        .map(skill => ({ value: skill.name, label: getSkillLabel(skill) }))
        .sort((left, right) => left.label.localeCompare(right.label));
    if (currentValue && !options.some(option => option.value === currentValue)) {
        options.push({ value: currentValue, label: currentValue });
    }
    return options;
}
