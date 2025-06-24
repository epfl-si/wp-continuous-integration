import {Deployment, KubernetesAPI} from "./kubernetes";
import {formatDateUTC, randomRFC1123Fragment} from "./utils";
import {PullRequestInfo} from "../pullRequestInfo";
import {info} from "./logger";

const getFlagValue = (flag: string): string | undefined => {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf(`--${flag}`);
  if (flagIndex !== -1 && args.length > flagIndex + 1) {
    const next = args[flagIndex + 1];
    if (!next.startsWith('-')) {
      return next;
    }
  }
  return undefined;
};

export class PipelineRun {
	private _namespace: string;
	private _deployment: Deployment;
	private _pullRequest: PullRequestInfo;

	constructor(namespace: string, deployment: Deployment, pr: PullRequestInfo) {
		this._deployment = deployment;
		this._namespace = namespace;
		this._pullRequest = pr;
	}

	async createPVC() {
		const claimName = `tekton-scratch-${randomRFC1123Fragment()}-${this._deployment.flavor}`;
		await KubernetesAPI.core.createNamespacedPersistentVolumeClaim({namespace: this._namespace,
			body: {
				apiVersion: 'v1',
				kind: 'PersistentVolumeClaim',
				metadata: {
					name: claimName,
					namespace: this._namespace,
				},
				spec: {
					accessModes: ['ReadWriteOnce'],
					storageClassName: 'wordpress-nfs-build',
					resources: {
						requests: {
							storage: '50Mi',
						},
					},
				},
			}});
		return claimName;
	}

	async createPipelineRun(claimName: string, pr: PullRequestInfo) {
		const name = `wp-base-build-${this._deployment.flavor}-${formatDateUTC()}`;
		const pipelinerun = {
			apiVersion: 'tekton.dev/v1',
			kind: 'PipelineRun',
			metadata: {
				name: name,
				namespace: this._namespace,
			},
			spec: {
				taskRunTemplate: {
					serviceAccountName: getFlagValue("privileged-service-account") || "pipeline"
				},
				taskRunSpecs: [{
					pipelineTaskName: "prep",
					serviceAccountName: getFlagValue("unprivileged-service-account") || "wp-base-builder"
				}],
				pipelineRef: {
					name: `wp-base-build`,
				},
				params:
					[
						{
							name: 'explicit-stem',
							value: `${pr.imageMoniker()}`
						},
						{
							name: 'target-deployment',
							value: `${this._deployment.deploymentName}`
						},
						{
							name: 'branch-name',
							value: pr.branchName()
						},
						{
							name: 'commit-sha',
							value: [pr.commitSha()]
						}
					],
				workspaces: [
					{
						name: 'shared-workspace',
						persistentVolumeClaim: {
							claimName: claimName,
						},
					},
					{
						name: 'dockerconfig',
						secret: {
							secretName: 'tekton-push',
						},
					},
				],
			},
		};
		await KubernetesAPI.custom.createNamespacedCustomObject(
			{
				group: 'tekton.dev',
				version: 'v1',
				namespace: this._namespace,
				plural: 'pipelineruns',
				body: pipelinerun
			}
		);
		return name;
	}

	async createAndAwaitTektonBuild(pr: PullRequestInfo) {
		info(`Scheduling ${pr.moniker()} into ${this._deployment.deploymentName}`, "")
		const claimName = await this.createPVC();
		// TODO pass repo and branch as arguments to pipelinerun for multiple repositories
		const name = await this.createPipelineRun(claimName, pr);
		await new Promise(r => setTimeout(r, 60000));
		await this.waitPipelineRunEnds(name);
	// TODO delete all PVC in the same fruit
	}

	async waitPipelineRunEnds(name: string){
		let iteration = 0;
		while(true) {
			const piprun = await KubernetesAPI.custom.getNamespacedCustomObject({
				group: 'tekton.dev',
				version: 'v1',
				namespace: this._namespace,
				plural: 'pipelineruns',
				name,
			});
			for(const cond of piprun.status.conditions) {
				if (cond.type == 'Succeeded') {
					if (cond.status == 'True') return true;
					else if (cond.status == 'False') {
						throw new Error(`${cond.reason}`);
					} else if (iteration < 30) {
						await new Promise(r => setTimeout(r, 60000));
						iteration += 1;
					} else {
						throw new Error("Failed to build images");
					}
				}
			}
		}
	}
}
