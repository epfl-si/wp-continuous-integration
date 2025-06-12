import {callGitHubAPI} from "./utils/webServiceCall";
import {error, getErrorMessage} from "./utils/logger";
import {Config} from "./utils/configFileReader";

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
	private _mostRecentWPCIComment: any;
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
		return `[wp-continuous-integration] ${this.moniker()} successes build into ${buildURL}.`;
	}

	fail(reason: any): string {
		return `[wp-continuous-integration] ${this.moniker()} failed to build: ${reason}`;
	}

	skipped(): string {
		return `[wp-continuous-integration] ${this.moniker()} skipped.`;
	}

	moniker(): string {
		return `Pull Request ${this._number} of ${this._repository} made on branch ${this._branchName} at commit ${this._commitSha}`
	}

	mostRecentWPCIComment() {
		return this._mostRecentWPCIComment;
	}

	updatedAt() {
		return this._updatedAt;
	}

	commitSha() {
		return this._commitSha;
	}

	async getWPCIComment() {
		type BotComment = {
			body: any,
			updated_at: string
		}
		try {
			const comments: BotComment[] = await callGitHubAPI(`/repos/epfl-si/${this._repository}/pulls/${this._number}/comments`, 'GET');
			const lastBotComment = comments
				.filter(comment => comment.body.includes('[wp-continuous-integration]'))
				.reduce((latest, current) =>
					new Date(current.updated_at) > new Date(latest.updated_at) ? current : latest);
			this._mostRecentWPCIComment = lastBotComment?.body;
		} catch (err) {
			error(`API call failed for ${this._repository}/pulls/${this._number}/comments`, err);
		}
		return '';
	}

	async createComment(message: string){
		try {
			await callGitHubAPI(`/repos/epfl-si/${this._repository}/issues/${this._number}/comments`, 'POST', undefined, message);
		} catch (err) {
			error(`API call failed for ${this._repository}/pulls/${this._number}/comments`, err);
		}
		return '';
	}

	static async getPullRequestsByRepo(config: Config, repo: string) {
		try {
			return await callGitHubAPI<any[]>(`/repos/epfl-si/${repo}/pulls?state=open`, 'GET');
		} catch (err) {
			error(`API call failed for ${repo} ${getErrorMessage(err)}`, err);
			return [];
		}
	}

	static async getAvailablePRsSortedByDate(config: Config) {
		const pullRequests: PullRequestInfo[] = [];
		const inventory = config.REPOSITORIES.filter(Boolean);
		for ( const repository of inventory ) {
			const list = await this.getPullRequestsByRepo(config, repository);
			for ( const pr of list ) {
				const pri = new PullRequestInfo({config, repository, id: pr.id, url: pr.url, number: pr.number, title: pr.title,
					userLogin: pr.user.login, updatedAt: pr.updated_at, branchName: pr.head.ref, commitSha: pr.head.sha});
				await pri.getWPCIComment();
				pullRequests.push(pri)
			}
		}
		const activePullRequests = pullRequests.filter(pr => !pr.mostRecentWPCIComment() || pr.mostRecentWPCIComment().indexOf(pr.commitSha()) == -1);
		return activePullRequests.sort((a, b) => new Date(b.updatedAt()).getTime() - new Date(a.updatedAt()).getTime());
	}
}
