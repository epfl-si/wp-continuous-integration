export type Resolvable<T> = Promise<T> & {
	resolve(t: T) : void
}
export function makeResolvable<T>() : Resolvable<T>
{
	let resolve : (t: T) => void;
	const p = (new Promise<T>((r) => {resolve = r})) as Resolvable<T>
	p.resolve = resolve!
	return p
}
