import {callGitHubAPI} from "./utils/webServiceCall";
import {error, getErrorMessage} from "./utils/logger";
import {Config} from "./utils/configFileReader";
import async from "async";

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

	constructor(opts: {config: Config, repository: string, id: number, url: string, number: number, title: string, userLogin: string, updatedAt: Date, branchName: string, commitSha: string}) {
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
	}

	success(buildURL: string): string {
		return `[wp-continuous-integration] ${this.moniker()} successfully built into ${buildURL}.`; // TODO correct this
	}

	fail(reason: any): string {
		const verbatim = "```"
		return `[wp-continuous-integration] ${this.moniker()} failed to build: 
		
${verbatim}
${reason}
${verbatim}
		`;
	}

	skipped(): string {
		return `[wp-continuous-integration] ${this.moniker()} skipped, because too many PRs were pending.`;
	}

	moniker(): string {
		return `Pull Request ${this._number} of ${this._repository} made on branch ${this._branchName} at commit ${this._commitSha}`
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

	imageMoniker() {
		return this._branchName.replace(/[^A-Za-z0-9]+/g, "-");
	}

	async isActive() {
		type BotComment = {
			body: any,
			updated_at: string
		}
		const comments: BotComment[] = await callGitHubAPI(this._config, `/repos/epfl-si/${this._repository}/issues/${this._number}/comments`, 'GET');
		const lastBotComments = comments.filter(comment => comment.body.includes('[wp-continuous-integration]'));
		if (lastBotComments.length == 0) return true;
		const comment = lastBotComments.reduce((latest, current) =>
				new Date(current.updated_at) > new Date(latest.updated_at) ? current : latest);
		return comment?.body?.indexOf(this.commitSha()) == -1;
	}

	async createComment(message: string){
		await callGitHubAPI(this._config, `/repos/epfl-si/${this._repository}/issues/${this._number}/comments`, 'POST', undefined, {body: message});
	}

	static async getPullRequestsByRepo(config: Config, repo: string) {
		return await callGitHubAPI<any[]>(config, `/repos/epfl-si/${repo}/pulls?state=open`, 'GET');
	}

	static async getAvailablePRsSortedByDate(config: Config) {
		const pullRequests: PullRequestInfo[] = [];
		const inventory = config.REPOSITORIES.filter(Boolean);
		for ( const repository of inventory ) {
			const list = await this.getPullRequestsByRepo(config, repository);
			for ( const pr of list ) {
				const pri = new PullRequestInfo({config, repository, id: pr.id, url: pr.url, number: pr.number, title: pr.title,
					userLogin: pr.user.login, updatedAt: pr.updated_at, branchName: pr.head.ref, commitSha: pr.head.sha});
				pullRequests.push(pri)
			}
		}
		const activePullRequests = await async.filter(pullRequests, async (pr) => pr.isActive());
		return activePullRequests.sort((a, b) => new Date(a.updatedAt()).getTime() - new Date(b.updatedAt()).getTime());
	}
}
