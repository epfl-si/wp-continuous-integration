import {configLogs, error, getErrorMessage, info} from "./lib/logger";
import {Config, loadConfig} from "./lib/configFileReader";
import {PullRequestInfo, Status} from "./lib/pullRequestInfo";
import {PipelineRun} from "./lib/piplineRun";
import {Deployment, KubernetesAPI} from "./lib/kubernetes";
import {groupBy} from "./lib/groupBy";
import {makeResolvable} from "./lib/promises";

const args = process.argv.slice(2);
const configFileIndex = args.findIndex(arg => arg === '-p');

const pjson = require('../package.json');
const version = pjson.version;

info(`wp-continuous-integration started with version ${version}`, {});

async function scheduleActivePRsToDeployments(config: Config) {
	const openPullRequests = await PullRequestInfo.getActivePRsAndStatusesSortedByDate(config);
	const deployments = await KubernetesAPI.getDeploymentsSortedByLastDeployDesc(config.NAMESPACE);

	let remainingFirstChoices = deployments.length;
	const allFirstChoicesMade = makeResolvable<void>();

	const activePullRequestGroups = getActivePullRequestsDict(openPullRequests);
	function consumePullRequests (name: string) {
		const ret = activePullRequestGroups[name]
		delete activePullRequestGroups[name]
		return ret
	}

	const notificationWork : Promise<void>[] = [];
	await Promise.all(deployments.map(dep => scheduleToDeployment(
		dep,
		{
			getAndConsumeByName(name: string) {
				remainingFirstChoices = remainingFirstChoices - 1
				if ( remainingFirstChoices == 0 ) allFirstChoicesMade.resolve()
				return consumePullRequests(name)
			},
			async getAndConsumeLatest() {
				await allFirstChoicesMade;
				if ( Object.keys(activePullRequestGroups).length === 0 ) return undefined;
				const latestPrInEachGroup: { [prName: string]: PullRequestInfo } =
					Object.fromEntries(Object.entries(activePullRequestGroups).map(([branchName, prs]) =>
						[branchName, prs.reduce((pr1, pr2) => pr1.updatedAt() > pr2.updatedAt() ? pr1 : pr2)]
					));
				const latestBranchName = Object.keys(latestPrInEachGroup).reduce(
					(branchName1, branchName2) => (
						latestPrInEachGroup[branchName1].updatedAt() >
						latestPrInEachGroup[branchName2].updatedAt() ?
							branchName1 :
							branchName2
					));
				return consumePullRequests(latestBranchName)
			}
		},
		{
			onDeploySuccess(prs: PullRequestInfo[]) {
				for ( const pr of prs ) {
					notificationWork.push(pr.createComment(getCallSignOfDeployment(dep) + pr.success(getBuildUrlOfDeployment(dep))));
				}
				notificationWork.push(notifyEvictions(openPullRequests, getBuildUrlOfDeployment(dep), dep.builtFromBranch));
			},
			onDeployFailure(prs: PullRequestInfo[], err: Error) {
				error(`Failed to schedule to deployment ${dep.deploymentName}: ${getErrorMessage(err)}`, err)
				for ( const pr of prs ) {
					notificationWork.push(pr.createComment(getCallSignOfDeployment(dep) + pr.fail(err)));
				}
			}
		}
	)));
	for (const branchName of Object.keys(activePullRequestGroups)) {
		for (const pr of activePullRequestGroups[branchName]) {
			notificationWork.push(pr.createComment('🍍 ' + pr.skipped()))
		}
	}

	await Promise.all(notificationWork)
}

function getActivePullRequestsDict(openPullRequests: {pullRequest: PullRequestInfo, status: Status}[]) {
	const activePullRequests = openPullRequests.filter(pr => pr.status == Status.Active)
		.map(pr => pr.pullRequest);
	return groupBy(activePullRequests, pr => pr.branchName());
}

function getCallSignOfDeployment(deployment: Deployment) {
	return (deployment.fruit || '🍍') + ' ';
}

function getBuildUrlOfDeployment(deployment: Deployment) {
	return `https://wp-test-${deployment.flavor}.epfl.ch`;
}

/**
 * Pick pull requests out of pullRequests, until one of them “sticks” (results in
 * a successfully deployed build).
 *
 * This function first attempts to pick a set of pull requests with the same branch name
 * as the `builtFromBranch` property of the deployment object. If this doesn't work (either
 * because there is no such set of pull requests available; or because the attempt to deploy
 * ultimately fails), then it falls back to picking a set of pull requests by date, until
 * one of them succeeds.
 *
 * @param deployment The Kubernetes deployment to schedule to
 * @param pullRequestsSource An object with the following functions:
 *            getAndConsumeByName(branchName: string) : PullRequestInfo[]
 *            	Returns the array of pull requests whose branch name is
 *            	`branchName`. The `AndConsume` part, means that no further call
 *            	to `getAndConsumeByName()` or `getAndConsumeLatest()` will
 *            	return the same pull requests.
 *            getAndConsumeLatest() : Promise<PullRequestInfo[]>
 *              Ultimately returns an array of pull requests that all have the same branch name,
 *              among which is the most recent one not yet consumed. This may block
 *              until all concurrent calls to this function have called `getAndConsumeByName`.
 * @param notifications An object with the following functions:
 * 						onDeploySuccess(prs: PullRequestInfo[])
 *              Called when the attempt to deploy `prs` (which was previously returned
 *              by either `getAndConsumeByName` or `getAndConsumeLatest`) succeeds.
 *              `scheduleToDeployment()` will return immediately after calling this callback.
 *            onDeployFailure(pr: PullRequestInfo[], error: Error)
 *              Called when the attempt to deploy `prs` (which was previously returned
 *              by either `getAndConsumeByName` or `getAndConsumeLatest`) fails.
 *              `scheduleToDeployment()` will continue to attempt to pick up another set of PRs
 *              (by calling `getAndConsumeLatest()`).
 */
async function scheduleToDeployment(
	deployment: Deployment,
	pullRequestsSource: {
		getAndConsumeByName (name: string): PullRequestInfo[] | undefined,
		getAndConsumeLatest () : Promise<PullRequestInfo[] | undefined>
	},
	notifications: {
		onDeploySuccess (prs: PullRequestInfo[]) : void,
		onDeployFailure (prs: PullRequestInfo[], error: Error) : void,
	}) {
	let pullRequestsToRebuild = pullRequestsSource.getAndConsumeByName(deployment.builtFromBranch);
	if (!pullRequestsToRebuild) {
		pullRequestsToRebuild = await pullRequestsSource.getAndConsumeLatest();
	}

	while(pullRequestsToRebuild) {
		try {
			console.log(getCallSignOfDeployment(deployment) + 'Scheduling...');
			await (new PipelineRun(deployment.namespace, deployment, pullRequestsToRebuild!)).createAndAwaitTektonBuild();
			notifications.onDeploySuccess(pullRequestsToRebuild);
			return;
		} catch (err: any) {
			notifications.onDeployFailure(pullRequestsToRebuild, err);
		}
		pullRequestsToRebuild = await pullRequestsSource.getAndConsumeLatest();
	}
}

async function notifyEvictions(openPullRequests: {pullRequest: PullRequestInfo,	status: Status}[], buildUrl: string, deploymentBranchName: string) {
	const expiredPullRequests = openPullRequests.filter(pr => pr.status == Status.Expired)
		.map(pr => pr.pullRequest);
	const evictedPullRequests = expiredPullRequests.filter(p =>
		p.lastBotComment() &&
		p.lastBotComment() != null &&
		p.lastBotComment()?.body!.indexOf(buildUrl) > -1 &&
		p.branchName() != deploymentBranchName
	)
	for ( const epr of evictedPullRequests ) {
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
		setInterval(main, 5 * 60 * 1000, config);
		main(config)
	}
} else {
	throw new Error("Config file not specified")
}
