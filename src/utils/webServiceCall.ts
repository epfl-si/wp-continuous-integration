import https from 'https';
import {Config} from "./configFileReader";

export function callGitHubAPI<T>(
	config: Config,
	endpoint: string,
	method: 'GET' | 'POST' = 'GET',
	body?: any
): Promise<T> {
	const data = body ? JSON.stringify(body) : null;

	const options: https.RequestOptions = {
		hostname: 'api.github.com',
		path: `/repos/epfl-si/${endpoint}`,
		method,
		headers: {
			'User-Agent': 'wp-continuous-integration',
			// 'Authorization': `Bearer ${config.TOKEN}`,
			'Accept': 'application/vnd.github+json',
			...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
		},
	};

	return new Promise<T>((resolve, reject) => {
		const req = https.request(options, res => {
			let rawData = '';

			res.on('data', chunk => {
				rawData += chunk;
			});

			res.on('end', () => {
				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
					try {
						const parsed = JSON.parse(rawData);
						resolve(parsed);
					} catch (e) {
						reject(new Error('Failed to parse response: ' + rawData));
					}
				} else {
					reject(new Error(`GitHub API error ${res.statusCode}: ${rawData}`));
				}
			});
		});

		req.on('error', reject);

		if (data) {
			req.write(data);
		}

		req.end();
	});
}
