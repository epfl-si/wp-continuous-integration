export function formatDateUTC() {
	const now = new Date();
	const pad = (n: number) => n.toString().padStart(2, '0');

	const year = now.getUTCFullYear();
	const month = pad(now.getUTCMonth() + 1);
	const day = pad(now.getUTCDate());
	const hours = pad(now.getUTCHours());
	const minutes = pad(now.getUTCMinutes());

	return `${year}${month}${day}-${hours}${minutes}z`;
}
