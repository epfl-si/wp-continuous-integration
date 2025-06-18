import {configLogs, error, getErrorMessage, info} from "./utils/logger";
import {Config, loadConfig} from "./utils/configFileReader";
import {PullRequestInfo} from "./pullRequestInfo";
import {PipelineRun} from "./utils/piplineRun";
import {Deployment, KubernetesAPI} from "./utils/kubernetes";

const args = process.argv.slice(2);
const configFileIndex = args.findIndex(arg => arg === '-p');
let config: Config | undefined;

const pjson = require('../package.json');
const version = pjson.version;

if (configFileIndex !== -1 && configFileIndex + 1 < args.length) {
	const configFilePath = args[configFileIndex + 1];
	info(`Using config file path: ${configFilePath}`, '');

	config = loadConfig(configFilePath);
	if (!config) {
		throw new Error("Error loading config file")
	}
	configLogs(config);
} else {
	throw new Error("Config file not specified")
}

info(`wp-continuous-integration started with version ${version}`, {});

async function scheduleActivePRsToDeployments() {
	const pullRequests = await PullRequestInfo.getAvailablePRsSortedByDate(config!);
	const deployments = await KubernetesAPI.getDeploymentsSortedByLastDeployDesc(config!.NAMESPACE);
	await Promise.all(deployments.map(dep => scheduleToDeployment(config!.NAMESPACE, dep, pullRequests)))
	for (const pr of pullRequests) {
		await pr.createComment('🍍 ' + pr.skipped())
	}
}

async function scheduleToDeployment(
	namespace: string,
	deployment: Deployment,
	pullRequests: PullRequestInfo[]) {
	while(true) {
		const pr = pullRequests.shift();
		const callSign = (deployment.fruit || '🍍') + ' ';
		if (!pr) break;
		try {
			await (new PipelineRun(namespace, deployment, pr!)).createAndAwaitTektonBuild(pr);
			await pr.createComment(callSign + pr.success(`https://wp-test-${deployment.flavor}.epfl.ch`))
			break;
		} catch (err: any) {
			error(`Failed to schedule to deployment ${deployment.deploymentName}: ${getErrorMessage(err)}`, err)
			await pr.createComment(callSign + pr.fail(err))
		}
	}
}

let running = false;

async function main() {
	if (!running) {
		console.log('Running cron job at', new Date().toISOString());

		running = true
		try {
			await scheduleActivePRsToDeployments();
		} finally {
			running = false
		}
	}
}

setInterval(main, 5 * 60 * 1000);
main()
