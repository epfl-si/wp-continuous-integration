import * as k8s from '@kubernetes/client-node';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

const pvcManifest = {
	apiVersion: 'v1',
	kind: 'PersistentVolumeClaim',
	metadata: {
		name: pvcName,
		namespace: inventoryNamespace,
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
};

const pipelineRunManifest = {
	apiVersion: 'tekton.dev/v1beta1',
	kind: 'PipelineRun',
	metadata: {
		name: pipelineRunName,
		namespace: inventoryNamespace,
	},
	spec: {
		timeout: '2h',
		serviceAccountName: serviceAccount,
		pipelineRef: {
			name: pipelineName,
		},
		params: [
			{
				name: 'next-build-id',
				value: buildId,
			},
		],
		workspaces: [
			{
				name: 'shared-workspace',
				persistentVolumeClaim: {
					claimName: pvcName,
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

async function createPipelineRun() {
	try {
		await k8sApi.createNamespacedPersistentVolumeClaim(inventoryNamespace, pvcManifest as any);
		console.log(`✅ PVC '${pvcName}' created`);

		await customApi.createNamespacedCustomObject(
			'tekton.dev',
			'v1beta1',
			inventoryNamespace,
			'pipelineruns',
			pipelineRunManifest
		);
		console.log(`✅ PipelineRun '${pipelineRunName}' created`);
	} catch (err: any) {
		if (err.response) {
			console.error('❌ Error:', err.response.body);
		} else {
			console.error('❌ Error:', err.message);
		}
	}
}
