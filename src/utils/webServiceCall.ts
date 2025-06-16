import {getAccessToken} from "./jwt";
import {Config} from "./configFileReader";

export async function callGitHubAPI<T>(
	config: Config,
	endpoint: string,
	method: 'GET' | 'POST' = 'GET',
	token?: string,
	body?: object
): Promise<T> {
	if(!token) {
		token = await getAccessToken(config)
	}

	try {
		const response = await fetch(`https://api.github.com${endpoint}`, {
			method, headers:
				{
					'User-Agent': 'wp-continuous-integration',
					'Authorization': `Bearer ${token}`,
					'Accept': 'application/vnd.github+json',
					...(body ? {'Content-Type': 'application/json'} : {})
				},
			body: JSON.stringify(body)
		})
		const result = await response.json();
		if (result?.status?.startsWith("4")) {
			throw new Error(`GitHub application error: ${JSON.stringify(result)}`)
		}
		return result;
	} catch ( e ) {
		console.error(e)
		throw e;
	}
}
