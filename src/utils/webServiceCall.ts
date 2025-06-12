import https from 'https';
import {getAccessToken} from "./jwt";
import {Config} from "./configFileReader";

export async function callGitHubAPI<T>(
	config: Config,
	endpoint: string,
	method: 'GET' | 'POST' = 'GET',
	token?: string,
	body?: any
): Promise<T> {
	if(!token) {
		token = await getAccessToken(config)
	}

	const result = await fetch(`https://api.github.com${endpoint}`, {method, headers:
			{
				'User-Agent': 'wp-continuous-integration',
				'Authorization': `Bearer ${token}`,
				'Accept': 'application/vnd.github+json',
				...(body ? { 'Content-Type': 'application/json' } : {})
			},
		body
	})
	return await result.json();
}
