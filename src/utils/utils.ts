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

export function randomRFC1123Fragment(length = 5) {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < length; i++) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	return result;
}

// Example usage
console.log(randomRFC1123Fragment()); // e.g., "k2l9g"
