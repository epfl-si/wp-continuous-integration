import cron from 'node-cron';
import {callGitHubAPI, getToken} from "./utils/webServiceCall";
import {configLogs, error, getErrorMessage, info} from "./utils/logger";
import {Config, loadConfig} from "./utils/configFileReader";
import {PullRequestInfo} from "./pullRequestInfo";

const args = process.argv.slice(2);
const configFileIndex = args.findIndex(arg => arg === '-p');
let config: Config | undefined;

const pjson = require('../package.json');
const version = pjson.version;

if (configFileIndex !== -1 && configFileIndex + 1 < args.length) {
	const configFilePath = args[configFileIndex + 1];
	info(`Using config file path: ${configFilePath}`, '');

	config = loadConfig(configFilePath);
	if (config) {
		configLogs(config);
	} else {
		error('Config file not specified', '');
	}
}

info(`Cron job scheduler started with version ${version}`, {});

async function getPullRequests(repo: string, token: string) {
	try {
		return await callGitHubAPI(`${repo}/pulls?state=open`, 'GET', token);
	} catch (err) {
		error(`API call failed for ${repo} ${getErrorMessage(err)}`, err);
		return [];
	}
}

async function getAllPR(repos: string) {
	const pullRequests: PullRequestInfo[] = [];
	const inventory = repos.split('\n').filter(Boolean);
	const token = getToken();
	for ( const i of inventory ) {
		const list = await getPullRequests(i, token);
		for ( const pr of list ) {
			const pri = new PullRequestInfo(i, pr.id, pr.url, pr.number, pr.title, pr.user.login, pr.updated_at, pr.head.ref, pr.head.sha);
			await pri.getWPCIComment(token);
			pullRequests.push(pri)
		}
	}
	return pullRequests;
}

function filterPR(pullrequests: PullRequestInfo[]) {
	const filtered = pullrequests.filter(pr => pr.mostRecentWPCIComment == '' || pr.mostRecentWPCIComment.indexOf(pr.commitSha) == -1);
	return filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function analyse() {
	if (config) {
		const pullRequests = await getAllPR(config.REPOSITORIES);
		const sorted = filterPR(pullRequests);

		console.log(pullRequests);
	}
}

analyse()

// // Run every minute
// cron.schedule('* * * * *', () => {
// 	console.log('Running cron job at', new Date().toISOString());
//	analyse();
// });
