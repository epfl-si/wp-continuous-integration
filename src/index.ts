import {configLogs, error, getErrorMessage, info} from "./utils/logger";
import {Config, loadConfig} from "./utils/configFileReader";
import {PullRequestInfo, Status} from "./pullRequestInfo";
import {PipelineRun} from "./utils/piplineRun";
import {Deployment, KubernetesAPI} from "./utils/kubernetes";

const args = process.argv.slice(2);
const configFileIndex = args.findIndex(arg => arg === '-p');

const pjson = require('../package.json');
const version = pjson.version;

info(`wp-continuous-integration started with version ${version}`, {});

async function scheduleActivePRsToDeployments(config: Config) {
	const openPullRequests = await PullRequestInfo.getActivePRsAndStatusesSortedByDate( config);
	const activePullRequests = openPullRequests.filter(pr => pr.status == Status.Active)
		.map(pr => pr.pullRequest);
	const expiredPullRequests = openPullRequests.filter(pr => pr.status == Status.Expired)
		.map(pr => pr.pullRequest);
	const deployments = await KubernetesAPI.getDeploymentsSortedByLastDeployDesc( config.NAMESPACE);
	await Promise.all(deployments.map(dep => scheduleToDeployment( config.NAMESPACE, dep, activePullRequests, [], deployments, true)));
	await Promise.all(deployments.map(dep => scheduleToDeployment( config.NAMESPACE, dep, activePullRequests, expiredPullRequests, deployments, false)));
	for (const pr of activePullRequests) {
		await pr.createComment('🍍 ' + pr.skipped())
	}
}

async function scheduleToDeployment(
	namespace: string,
	deployment: Deployment,
	pullRequests: PullRequestInfo[],
	expiredPR: PullRequestInfo[],
	deployments: Deployment[],
	checkFlavor: boolean) {
	while(true) {
		const pullRequestsToRebuild: PullRequestInfo[] = getPullRequestToRebuild(checkFlavor, pullRequests, deployment);
		if (pullRequestsToRebuild.length == 0) break;

		const callSign = (deployment.fruit || '🍍') + ' ';
		const buildUrl = `https://wp-test-${deployment.flavor}.epfl.ch`;
		try {
			// Remove all items where `name === pullRequestsToRebuild[0].branchName()`
			for (let i = pullRequests.length - 1; i >= 0; i--) {
				if (pullRequests[i].branchName() === pullRequestsToRebuild[0].branchName()) {
					pullRequests.splice(i, 1);
				}
			}
			console.log(callSign + 'Scheduling...');
			await (new PipelineRun(namespace, deployment, pullRequestsToRebuild!)).createAndAwaitTektonBuild();
			for ( const pr of pullRequestsToRebuild ) {
				await pr.createComment(callSign + pr.success(buildUrl))
			}
			if (!checkFlavor) {
				await createExpireCommentForPRs(expiredPR, buildUrl, pullRequestsToRebuild[0].branchName());
			} else {
				// Remove deployment built on its same branch from available deployments
				for (let i = deployments.length - 1; i >= 0; i--) {
					if (deployments[i].deploymentName === deployment.deploymentName) {
						deployments.splice(i, 1);
					}
				}
			}
			break;
		} catch (err: any) {
			error(`Failed to schedule to deployment ${deployment.deploymentName}: ${getErrorMessage(err)}`, err)
			for ( const pr of pullRequestsToRebuild ) {
				await pr.createComment(callSign + pr.fail(err));
			}
		}
	}
}

function getPullRequestToRebuild(checkFlavor: boolean, pullRequests: PullRequestInfo[], deployment: Deployment) {
	// Get all PRs where the branch name is the same of the `epfl/built-from-branch` annotation in the deployment
	const pullRequestsToRebuild: PullRequestInfo[] = [];
	if (checkFlavor) {
		const prs = pullRequests.filter(pr => pr.branchName() == deployment.builtFromBranch);
		pullRequestsToRebuild.push(...prs);
	} else {
		const firstAvailablePR = pullRequests.shift();
		if (firstAvailablePR) {
			pullRequestsToRebuild.push(firstAvailablePR);
			const filteredPR = pullRequests.filter(pr => pr.branchName() == firstAvailablePR.branchName());
			pullRequestsToRebuild.push(...filteredPR);
		}
	}
	return pullRequestsToRebuild;
}

async function createExpireCommentForPRs(expiredPR: PullRequestInfo[], buildUrl: string, deploymentBranchName: string) {
	// All PRs successfully built in this deployment but on another branch is expired
	const expPR = expiredPR.filter(p =>
		p.lastBotComment() &&
		p.lastBotComment() != null &&
		p.lastBotComment()?.body!.indexOf(buildUrl) > -1 &&
		p.branchName() != deploymentBranchName
	)
	for ( const epr of expPR ) {
		await epr.createComment('🍍' + epr.expired());
	}
}

let running = false;

async function main(config: Config) {
	if (!running) {
		console.log('Running cron job at', new Date().toISOString());

		running = true
		try {
			await scheduleActivePRsToDeployments(config);
		} finally {
			running = false
		}
	}
}

if (configFileIndex !== -1 && configFileIndex + 1 < args.length) {
	const configFilePath = args[configFileIndex + 1];
	info(`Using config file path: ${configFilePath}`, '');

	const config = loadConfig(configFilePath);
	if (!config) {
		throw new Error("Error loading config file")
	} else {
		configLogs(config);
		setInterval(main, 5 * 60 * 1000);
		main(config)
	}
} else {
	throw new Error("Config file not specified")
}
