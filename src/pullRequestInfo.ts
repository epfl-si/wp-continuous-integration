import {callGitHubAPI} from "./utils/webServiceCall";
import {error} from "./utils/logger";

export class PullRequestInfo {
	repository: string;
	id: number;
	url: string;
	number: number;
	title: string;
	userLogin: string;
	updatedAt: Date;
	branchName: string; //head ref
	commitSha: string; //head sha
	mostRecentWPCIComment: any;

	constructor(repository: string, id: number, url: string, number: number, title: string, userLogin: string, updatedAt: Date, branchName: string, commitSha: string) {
		this.id = id;
		this.url = url;
		this.number = number;
		this.title = title;
		this.userLogin = userLogin;
		this.updatedAt = updatedAt;
		this.branchName = branchName;
		this.commitSha = commitSha;
		this.repository = repository;
	}

	success(buildName: string): string {
		return `[wp-continuous-integration] Branch ${this.branchName} at commit ${this.commitSha} successed build into ${buildName}.`;
	}

	fail(): string {
		return `[wp-continuous-integration] Branch ${this.branchName} at commit ${this.commitSha} failed to build.`;
	}

	skipped(): string {
		return `[wp-continuous-integration] Branch ${this.branchName} at commit ${this.commitSha} skipped.`;
	}

	async getWPCIComment(token: string) {
		try {
			console.log('getWPCIComment')
			const comments: any[] = await callGitHubAPI(`${this.repository}/pulls/${this.number}/comments`, 'GET', token);
			console.log(`${this.repository}/pulls/${this.number}/comments ${comments}`)
			const filtered = comments.filter(comment => comment.body.includes('[wp-continuous-integration]')).reduce((latest, current) =>
				new Date(current.updated_at) > new Date(latest.updated_at) ? current : latest
			);
			console.log(`${this.repository}/pulls/${this.number}/comments ${filtered}`)
			this.mostRecentWPCIComment = filtered && filtered[0] ? filtered[0].body : '';
		} catch (err) {
			error(`API call failed for ${this.repository}/pulls/${this.number}/comments`, err);
		}
		return '';
	}
}
