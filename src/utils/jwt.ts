import {callGitHubAPI} from "./webServiceCall";
import {KubernetesAPI} from "./kubernetes";
import {Config} from "./configFileReader";

const jwt = require("jsonwebtoken");

let _token: string | undefined;
let _tokenExpiration: number | undefined;

async function generateJWT(config:Config) {
	const secretData = await KubernetesAPI.readSecret(config.NAMESPACE,'wp-ci-github-app-secrets') as {PRIVATE_KEY: string, APP_ID: string};
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		iat: now - 60,
		exp: now + 9 * 60,
		iss: secretData.APP_ID,
	};
	return jwt.sign(payload, secretData.PRIVATE_KEY, { algorithm: "RS256" });
}

async function getInstallationId(config: Config, jwtToken: string) {
	const res: any = await callGitHubAPI(config, `/app/installations`, 'GET', jwtToken)
	const installation = res[0];
	if (!installation) throw new Error("No installation found !");
	return installation.id;
}

export async function getAccessToken(config: Config) {
	const now = Math.floor(Date.now() / 1000);
	if ( _token && _tokenExpiration && now < _tokenExpiration - 60 ) {
		console.log("🔐 Token still valid");
		// Token is still valid (with a 60s buffer)
		return _token;
	}
	console.log("🔐 Token expired. Generating a new token");

	// Generate new token
	console.log("🔐 Génération du JWT...");
	const jwtToken = await generateJWT(config);

	console.log("📥 Récupération de l'installation ID...");
	const installationId = await getInstallationId(config, jwtToken);
	console.log(`✅ installation_id = ${installationId}`);

	console.log("🔑 Demande du token d'installation...");
	const res: any = await callGitHubAPI(config, `/app/installations/${installationId}/access_tokens`, 'POST', jwtToken)
	_token = res.token;
	const expiresAt = new Date(res.expires_at).getTime() / 1000; // convert to seconds
	_tokenExpiration = Math.floor(expiresAt);

	return _token;
}



