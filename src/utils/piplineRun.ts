import {KubernetesAPI} from "./kubernetes";
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

	/*async readAWSSecret(secretName: string, namespace: string) {
		try {
			const res = await k8sApi.readNamespacedSecret(secretName, namespace);
			const secret = res.body;

			// Decode the base64-encoded data
			const decodedData = {};
			for (const key in secret.data) {
				decodedData[key] = Buffer.from(secret.data[key], 'base64').toString('utf-8');
			}

			return decodedData;
		} catch (err) {
			console.error('Error reading secret:', err.body || err);
		}
	}*/

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

	/*async createPipeline(namespace: string, flavor: string) {
		const quayHostname = 'quay-its.epfl.ch';
		const quayOrganization = 'epfl-si';

		const awsSecret = readAWSSecret(namespace);
		const AWS_ACCESS_KEY_ID;
		const AWS_SECRET_ACCESS_KEY;

		const pipeline = {
			apiVersion: 'tekton.dev/v1',
			kind: 'Pipeline',
			metadata: {
				name: `wp-base-build-${flavor}`,
				namespace: namespace,
			},
			spec: {
				workspaces: [
					{ name: 'shared-workspace' },
					{ name: 'dockerconfig' }
				],
				tasks: [
					{
						name: 'prep',
						taskSpec: {
							steps: [
								{
									name: 'sed',
									image: 'public.ecr.aws/bitnami/git:latest',
									script: [
										'set -e -x',
										'rm -rf /workspace/source/wp-ops',
										'git clone https://github.com/epfl-si/wp-ops /workspace/source/wp-ops',
										`sed -i 's;FROM wp-base;FROM ${quayHostname}/${quayOrganization}/wp-base:wp-base-${flavor};g' /workspace/source/wp-ops/docker/!*!/Dockerfile`,
										`sed -i 's;--from=wp-base;--from=${quayHostname}/${quayOrganization}/wp-base:wp-base-${flavor};g' /workspace/source/wp-ops/docker/!*!/Dockerfile`,
										`sed -i 's;FROM bitnami/nginx-ingress-controller:1.12.1;FROM ${quayHostname}/${quayOrganization}/bitnami-nginx-ingress-controller:1.12.1;g' /workspace/source/wp-ops/docker/!*!/Dockerfile`,
										`sed -i 's;FROM ubuntu:jammy;FROM ${quayHostname}/${quayOrganization}/ubuntu:jammy;g' /workspace/source/wp-ops/docker/!*!/Dockerfile`
									].join('\n'),
								}
							]
						},
						workspaces: [
							{ name: 'source', workspace: 'shared-workspace' },
							{ name: 'dockerconfig', workspace: 'dockerconfig' }
						]
					},
					{
						name: 'build-wp-base',
						runAfter: ['prep'],
						taskRef: { kind: 'Task', name: 'buildah' },
						params: [
							{ name: 'IMAGE', value: `${quayHostname}/${quayOrganization}/wp-base:wp-base-${flavor}` },
							{ name: 'CONTEXT', value: 'wp-ops/docker/wp-base' },
							{ name: 'VERBOSE', value: 'true' },
							{
								name: 'BUILD_EXTRA_ARGS',
								value: `--build-arg AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID} --build-arg AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}`
							}
						],
						workspaces: [
							{ name: 'source', workspace: 'shared-workspace' },
							{ name: 'dockerconfig', workspace: 'dockerconfig' }
						]
					},
					{
						name: 'build-wp-nginx',
						runAfter: ['build-wp-base'],
						taskRef: { kind: 'Task', name: 'buildah' },
						params: [
							{ name: 'IMAGE', value: `${quayHostname}/${quayOrganization}/wp-nginx:wp-nginx-${flavor}` },
							{ name: 'CONTEXT', value: 'wp-ops/docker/wordpress-nginx' },
							{ name: 'VERBOSE', value: 'true' }
						],
						workspaces: [
							{ name: 'source', workspace: 'shared-workspace' },
							{ name: 'dockerconfig', workspace: 'dockerconfig' }
						]
					},
					{
						name: 'build-wp-php',
						runAfter: ['build-wp-base'],
						taskRef: { kind: 'Task', name: 'buildah' },
						params: [
							{ name: 'IMAGE', value: `${quayHostname}/${quayOrganization}/wp-php:wp-php-${flavor}` },
							{ name: 'CONTEXT', value: 'wp-ops/docker/wordpress-php' },
							{ name: 'VERBOSE', value: 'true' }
						],
						workspaces: [
							{ name: 'source', workspace: 'shared-workspace' },
							{ name: 'dockerconfig', workspace: 'dockerconfig' }
						]
					},
					{
						name: 'patch-deployment',
						runAfter: ['build-wp-nginx', 'build-wp-php'],
						taskSpec: {
							steps: [
								{
									name: 'rollout',
									image: 'public.ecr.aws/bitnami/kubectl:latest',
									script: `kubectl rollout restart deployment/wp-nginx-${flavor}`
								}
							]
						}
					}
				]
			}
		};


		await customApi.createNamespacedCustomObject(
			'tekton.dev',
			'v1',
			namespace,
			'pipeline',
			pipeline
		);
	}*/

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
			// const pipeline = await createPipeline(namespace, flavor);
			await this.createPipelineRun(claimName, pr);
			// TODO wait pipeline build
			return true;
		// TODO delete all PVC in the same fruit
	}
}
