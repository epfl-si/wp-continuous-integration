import {
	ObjectAppsV1Api,
	ObjectCoreV1Api,
	ObjectCustomObjectsApi
} from "@kubernetes/client-node/dist/gen/types/ObjectParamAPI";

const k8s = require('@kubernetes/client-node');

export type Deployment = {
	deploymentName: string,
	flavor: string,
	fruit: string,
	date: Date,
	builtFromBranch: string
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
			dep.spec && dep.spec.template && dep.spec.template.metadata && dep.spec.template.metadata.labels &&
			dep.spec.template.metadata.labels["self-service-flavor"] &&
			dep.spec.template.metadata.labels["self-service-flavor"] != '');
	}

	static async getDeploymentsSortedByLastDeployDesc(namespace: string): Promise<Deployment[]> {
		const replicaSets = await KubernetesAPI.apps.listNamespacedReplicaSet({namespace});
		const replicaSetsItems = replicaSets.items;
		const kubernetesDeployments = await KubernetesAPI.WPNginxFlavorsDeployments(namespace);
		const deployments = kubernetesDeployments.map((deployment) => {
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
				flavor: deployment.spec && deployment.spec.template && deployment.spec.template.metadata && deployment.spec.template.metadata.labels
					? deployment.spec.template.metadata.labels["self-service-flavor"] : '',
				fruit: deployment.metadata && deployment.metadata.annotations
					? deployment.metadata.annotations["self-service-fruit"] : '',
				date: latestRs ? latestRs.metadata?.creationTimestamp : null,
				builtFromBranch: deployment.spec && deployment.spec.template && deployment.spec.template.metadata && deployment.spec.template.metadata.annotations
					? deployment.spec.template.metadata.annotations["epfl/built-from-branch"] : '',
			} as Deployment;
		});
		return deployments.sort((a, b) => a.date.getTime() - b.date.getTime());
	}
}
