import {callGitHubAPI} from "./webServiceCall";
import {Config} from "./configFileReader";
import async from "async";

type BotComment = {
	body: any,
	updated_at: string,
	user: { login: string }
}

export enum Status {
	Active,
	Expired
}

export class PullRequestInfo {
	private _repository: string;
	private _id: number;
	private _url: string;
	private _number: number;
	private _title: string;
	private _userLogin: string;
	private _updatedAt: Date;
	private _branchName: string; //head ref
	private _commitSha: string; //head sha
	private _config: Config;
	private _lastBotComment: BotComment | null;

	constructor(opts: {config: Config, repository: string, id: number, url: string, number: number, title: string, userLogin: string, updatedAt: Date, branchName: string, commitSha: string, lastBotComment: BotComment | null}) {
		this._id = opts.id;
		this._url = opts.url;
		this._number = opts.number;
		this._title = opts.title;
		this._userLogin = opts.userLogin;
		this._updatedAt = opts.updatedAt;
		this._branchName = opts.branchName;
		this._commitSha = opts.commitSha;
		this._repository = opts.repository;
		this._config = opts.config;
		this._lastBotComment = opts.lastBotComment
	}

	success(buildURL: string): string {
		return `The ${this.moniker()}, was successfully built and is available at ${buildURL}.`;
	}

	fail(reason: any): string {
		return `The ${this.moniker()}, failed to build.
<details>
<summary>Error details</summary>
<pre>
${reason}
</pre>
</details>
		`;
	}

	skipped(): string {
		return `The ${this.moniker()} was skipped, because too many other PRs were pending.`;
	}

	expired(): string {
		console.log(this.moniker());
		return `The ${this.moniker()} was evicted by a more recent pull request.`;
	}

	moniker(): string {
		return `pull request #${this._number} for [${this._repository}](https://github.com/epfl-si/${this._repository}), submitted on branch [${this._branchName}](https://github.com/epfl-si/${this._repository}/tree/${this._branchName}) at commit ${this._commitSha}`
	}

	updatedAt() {
		return this._updatedAt;
	}

	commitSha() {
		return this._commitSha;
	}

	repository() {
		return this._repository;
	}

	branchName() {
		return this._branchName;
	}

	lastBotComment() {
		return this._lastBotComment;
	}

	imageMoniker() {
		return this._branchName.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase().substring(0, 125);
	}

	async _getStatus() {
		const lastBotComments = this.lastBotComment();
		//A PR is active if there are no bot comments or if the SHA in the last comment is not the same of the current SHA
		if (lastBotComments == null || lastBotComments?.body?.indexOf(this.commitSha()) == -1)
			return Status.Active;
		//A PR is expired if the SHA of the bot comment is the same of the current SHA and it was successfully built
		else if (lastBotComments != null && lastBotComments?.body?.indexOf(this.commitSha()) > -1 && lastBotComments?.body?.indexOf("has successfully built and is available") > -1)
			return Status.Expired;
	}

	async getLastBotComment() {
		const comments: BotComment[] = await callGitHubAPI(this._config, `/repos/epfl-si/${this._repository}/issues/${this._number}/comments`, 'GET');
		const lastBotComments = comments.filter(comment => comment.user.login == 'wp-continuous-integration[bot]');
		if (lastBotComments.length == 0) return null;
		return lastBotComments.reduce((latest, current) =>
			new Date(current.updated_at) > new Date(latest.updated_at) ? current : latest);
	}

	async createComment(message: string){
		await callGitHubAPI(this._config, `/repos/epfl-si/${this._repository}/issues/${this._number}/comments`, 'POST', undefined, {body: message});
	}

	static async getPullRequests(config: Config) {
		const pullRequests: PullRequestInfo[] = [];
		const inventory = config.REPOSITORIES.filter(Boolean);
		for ( const repository of inventory ) {
			const list = await callGitHubAPI<any[]>(config, `/repos/epfl-si/${repository}/pulls?state=open`, 'GET');
			for ( const pr of list ) {
				const pri = new PullRequestInfo({config, repository, id: pr.id, url: pr.url, number: pr.number, title: pr.title,
					userLogin: pr.user.login, updatedAt: pr.updated_at, branchName: pr.head.ref, commitSha: pr.head.sha, lastBotComment: null});
				pullRequests.push(pri)
			}
		}
		const prs: PullRequestInfo[] = [];
		for ( const pr of pullRequests ) {
			const message = await pr.getLastBotComment();
			prs.push(new PullRequestInfo({config, repository: pr._repository, id: pr._id, url: pr._url, number: pr._number, title: pr._title,
				userLogin: pr._userLogin, updatedAt: pr._updatedAt, branchName: pr._branchName, commitSha: pr._commitSha, lastBotComment: message}));
		}
		return prs;
	}

	static async getActivePRsAndStatusesSortedByDate(config: Config) {
		const pullRequests: PullRequestInfo[] = await this.getPullRequests(config);
		const activePullRequests: PullRequestInfo[] = (await async.filter(pullRequests, async (pr) => (await pr._getStatus()) == Status.Active))
			.sort((a, b) => new Date(a.updatedAt()).getTime() - new Date(b.updatedAt()).getTime());
		const expiredPullRequests: PullRequestInfo[] = await async.filter(pullRequests, async (pr) => await (pr._getStatus()) == Status.Expired);
		const pullRequestsWithStatus: {pullRequest: PullRequestInfo, status: Status}[] = [];
		activePullRequests.forEach(pr => {
			pullRequestsWithStatus.push({pullRequest: pr, status: Status.Active})
		});
		expiredPullRequests.forEach(pr => {
			pullRequestsWithStatus.push({pullRequest: pr, status: Status.Expired})
		});
		return pullRequestsWithStatus;
	}
}
