import {Deployment, KubernetesAPI} from "./kubernetes";
import {formatDateUTC, randomRFC1123Fragment} from "./utils";
import {PullRequestInfo} from "../pullRequestInfo";

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
		const pipelinerun = {
			apiVersion: 'tekton.dev/v1',
			kind: 'PipelineRun',
			metadata: {
				name: `wp-base-build-${this._deployment.flavor}-${formatDateUTC()}`,
				namespace: this._namespace,
			},
			spec: {
				taskRunTemplate: {
					serviceAccountName: 'pipeline'
				},
				pipelineRef: {
					name: `wp-base-build`,
				},
				params:
					[
						{
							name: 'next-build-id',
							value: `${this._deployment.flavor}-${pr.imageMoniker()}`
						},
						{
							name: 'target-deployment',
							value: `${this._deployment.deploymentName}`
						},
						{
							name: 'repos',
							value: [pr.repository()]
						},
						{
							name: 'branch_name',
							value: pr.branchName()
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
	}

	async createAndAwaitTektonBuild(pr: PullRequestInfo) {
			const claimName = await this.createPVC();
			// TODO pass repo and branch as arguments to pipelinerun
			await this.createPipelineRun(claimName, pr);
			// TODO wait pipeline build
			return true;
		// TODO delete all PVC in the same fruit
	}
}
