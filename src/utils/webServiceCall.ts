import https from 'https';
import jwt from 'jsonwebtoken';
import * as fs from "fs";

export function getToken() {
	const privateKey = fs.readFileSync('/keybase/team/epfl_wp_prod/wp-continuous-integration.2025-06-06.private-key.pem', 'utf8');

	const now = Math.floor(Date.now() / 1000);
	const payload = {
		iat: now,
		exp: now + 600,     // max 10 minutes
		iss: 'Iv23liLEpatTrWSJ0N33'
	};

	return jwt.sign(payload, privateKey, {
		algorithm: 'RS256',
	});
}

export function callGitHubAPI<T>(
	endpoint: string,
	method: 'GET' | 'POST' = 'GET',
	token: string,
	body?: any
): Promise<T> {
	const data = body ? JSON.stringify(body) : null;

	const options: https.RequestOptions = {
		hostname: 'api.github.com',
		path: `/repos/epfl-si/${endpoint}`,
		method,
		headers: {
			'User-Agent': 'wp-continuous-integration',
			'Authorization': `Bearer ${token}`,
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
