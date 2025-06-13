import {
	ObjectAppsV1Api,
	ObjectCoreV1Api,
	ObjectCustomObjectsApi
} from "@kubernetes/client-node/dist/gen/types/ObjectParamAPI";

const k8s = require('@kubernetes/client-node');

export type Deployment = {
	deploymentName: string,
	flavor: string,
	date: Date
};

export class KubernetesAPI {
	static singleton: KubernetesAPI | undefined;
	private _apps: ObjectAppsV1Api;
	private _core: ObjectCoreV1Api;
	private _custom: ObjectCustomObjectsApi;

	constructor() {
		const kc = new k8s.KubeConfig();
		kc.loadFromDefault();

		this._apps = kc.makeApiClient(k8s.AppsV1Api);
		this._core = kc.makeApiClient(k8s.CoreV1Api);
		this._custom = kc.makeApiClient(k8s.CustomObjectsApi);
	}

	static get core() {
		return KubernetesAPI._getInstance()._core;
	}

	static get apps() {
		return KubernetesAPI._getInstance()._apps;
	}

	static get custom() {
		return KubernetesAPI._getInstance()._custom;
	}

	static _getInstance() {
		if (this.singleton === undefined) {
			this.singleton = new KubernetesAPI();
		}
		return this.singleton;
	}

	static async readSecret(namespace: string, name: string) {
		const res = await KubernetesAPI.core.readNamespacedSecret({name, namespace});
		const secret = res.data;

		if (!secret) {
			throw new Error("Secret not found");
		}

		return Object.fromEntries(Object.keys(secret).map(k => [k, Buffer.from(secret[k], 'base64').toString('utf-8')]));
	}

	static async WPNginxFlavorsDeployments(namespace: string) {
		const deployments =  await KubernetesAPI.apps.listNamespacedDeployment({namespace});
		return deployments.items.filter((dep) =>
			dep.metadata && dep.metadata.labels && dep.metadata.labels["self-service-flavor"] != '');
	}

	static async getDeploymentsSortedByLastDeployDesc(namespace: string): Promise<Deployment[]> {
		const replicaSets = await KubernetesAPI.apps.listNamespacedReplicaSet({namespace});
		const replicaSetsItems = replicaSets.items;
		const deployments = await KubernetesAPI.WPNginxFlavorsDeployments(namespace);
		return deployments.map((deployment) => {
			// Filter ReplicaSets owned by the current deployment
			const matchingRs = replicaSetsItems.filter((rs) =>
				rs.metadata?.ownerReferences?.some(ref =>
					ref.kind === "Deployment" && ref.name === deployment.metadata?.name
				)
			);

			// Sort by creationTimestamp and get the latest
			const latestRs = matchingRs
				.sort((a, b) =>
					(a.metadata?.creationTimestamp?.valueOf() ?? 0) - (b.metadata?.creationTimestamp?.valueOf() ?? 0)
				)
				.pop();

			return {
				deploymentName: deployment.metadata?.name,
				flavor: deployment.metadata && deployment.metadata.labels ? deployment.metadata.labels["self-service-flavor"] : '',
				date: latestRs ? latestRs.metadata?.creationTimestamp : null,
			} as Deployment;
		});
	}
}
