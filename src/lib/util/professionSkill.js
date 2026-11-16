export function getProfessionTree(actor) {
    const listedProfession = typeof actor?.getList === 'function' ? actor.getList('profession')?.[0] : undefined;
    const profession = listedProfession ?? Array.from(actor?.items ?? []).find(item => item?.type === 'profession');
    return profession?.system;
}

export function getProfessionSkills(actor) {
    const tree = getProfessionTree(actor);
    if (!tree) return [];

    return [
        tree.definingSkill,
        ...['skillPath1', 'skillPath2', 'skillPath3'].flatMap(path => [
            tree[path]?.skill1,
            tree[path]?.skill2,
            tree[path]?.skill3
        ])
    ];
}

export function getProfessionSkillOptions(actor, currentValue) {
    const names = new Set(getProfessionSkills(actor).map(skill => skill?.skillName).filter(Boolean));
    if (currentValue) names.add(currentValue);
    return [...names].sort((left, right) => left.localeCompare(right)).map(name => ({ value: name, label: name }));
}
