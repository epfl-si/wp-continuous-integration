export function groupBy<T, K extends string | number | symbol>(
	list: T[],
	groupByFn: (item: T) => K
): Record<K, T[]> {
	return list.reduce((acc, item) => {
		const key = groupByFn(item);
		return {
			...acc,
			[key]: [...(acc[key] ?? []), item],
		};
	}, {} as Record<K, T[]>);
}
