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
		// Get all PRs where the branch name is the same of the `epfl/built-from-branch` annotation in the deployment
		const pullRequestToRebuild = pullRequests.filter(pr => pr.branchName() == deployment.builtFromBranch);
		if (pullRequestToRebuild.length == 0) {
			const firstAvailablePR = pullRequests.shift();
			if (firstAvailablePR) {
				pullRequestToRebuild.push(firstAvailablePR);
				const filteredPR = pullRequests.filter(pr => pr.branchName() == firstAvailablePR.branchName());
				pullRequestToRebuild.push(...filteredPR);
			}
		}
		if (pullRequestToRebuild.length == 0) break;

		const callSign = (deployment.fruit || '🍍') + ' ';
		if (!pr) break;
		try {
			// Remove all items where `name === pullRequestToRebuild[0].branchName()`
			for (let i = pullRequests.length - 1; i >= 0; i--) {
				if (pullRequests[i].branchName() === pullRequestToRebuild[0].branchName()) {
					pullRequests.splice(i, 1);
				}
			}
			console.log(callSign + 'Scheduling...');
			await (new PipelineRun(namespace, deployment, pr!)).createAndAwaitTektonBuild(pr);
			await pr.createComment(callSign + pr.success(`https://wp-test-${deployment.flavor}.epfl.ch`))
			await (new PipelineRun(namespace, deployment, pullRequestToRebuild!)).createAndAwaitTektonBuild();
			for ( const pr of pullRequestToRebuild ) {
				await pr.createComment(callSign + pr.success(buildUrl))
			}

			break;
		} catch (err: any) {
			error(`Failed to schedule to deployment ${deployment.deploymentName}: ${getErrorMessage(err)}`, err)
			for ( const pr of pullRequestToRebuild ) {
				await pr.createComment(callSign + pr.fail(err));
			}
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
