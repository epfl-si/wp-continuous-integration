import {Deployment, KubernetesAPI} from "./kubernetes";
import {formatDateUTC, randomRFC1123Fragment} from "./utils";
import {PullRequestInfo} from "./pullRequestInfo";
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
	private _pullRequest: PullRequestInfo[];

	constructor(namespace: string, deployment: Deployment, pr: PullRequestInfo[]) {
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

	async createPipelineRun(claimName: string) {
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
							value: `${this._pullRequest[0].imageMoniker()}`
						},
						{
							name: 'target-deployment',
							value: `${this._deployment.deploymentName}`
						},
						{
							name: 'branch-name',
							value: this._pullRequest[0].branchName()
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

	async createAndAwaitTektonBuild() {
		const monikers = this._pullRequest.map(pr => pr.moniker());
		info(`Scheduling \n${monikers.join('\n')} \ninto ${this._deployment.deploymentName}`, "")
		const claimName = await this.createPVC();
		const name = await this.createPipelineRun(claimName);
		await new Promise(r => setTimeout(r, 60000));
		await this.waitPipelineRunEnds(name);
		await KubernetesAPI.deletePipelinePodsByFlavor(this._namespace, this._deployment.flavor, name)
		await KubernetesAPI.deletePersistentVolumeClaimByFlavor(this._namespace, this._deployment.flavor, claimName);
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
