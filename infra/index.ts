import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import { execSync } from "child_process";
import * as yaml from "js-yaml";
import { deployObservability } from "./k8s/observability";

// -------------------
// Config
// -------------------
const cfg = new pulumi.Config();
const gcpCfg = new pulumi.Config("gcp");

const project = gcpCfg.require("project");
const region = gcpCfg.get("region") || "europe-west1";
const zone = cfg.get("zone") || `${region}-b`;

const image = cfg.require("image"); // set by CI (full image ref)


// --------------------
// GKE cluster
// --------------------
const network = new gcp.compute.Network("vpc", { autoCreateSubnetworks: true });

const cluster = new gcp.container.Cluster("travel-gke", {
    location: zone,
    initialNodeCount: 1,
    network: network.name,
    removeDefaultNodePool: true,
    minMasterVersion: "latest",
});

const nodePool = new gcp.container.NodePool("travel-np", {
    cluster: cluster.name,
    location: zone,
    initialNodeCount: 2,
    nodeConfig: {
        machineType: "e2-medium",
        oauthScopes: ["https://www.googleapis.com/auth/cloud-platform"],
    },
});

// --------------------
// Kubeconfig for Kubernetes provider
// --------------------
const kubeconfig = pulumi
    .all([cluster.name, cluster.endpoint, cluster.masterAuth])
    .apply(([name, endpoint, masterAuth]) => {
        const context = `${project}_${zone}_${name}`;
        return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gke-gcloud-auth-plugin
      installHint: Install gke-gcloud-auth-plugin
      provideClusterInfo: true
`;
    });

// Note: Pulumi docs mention using the gke auth plugin for kubeconfig auth. :contentReference[oaicite:6]{index=6}
const k8sProvider = new k8s.Provider("gke", { kubeconfig }, { dependsOn: [nodePool] });
const config = new pulumi.Config();
const observabilityEnabled =
    config.getBoolean("observability:enabled") ?? true;

const observability = deployObservability({
    provider: k8sProvider,
    enabled: observabilityEnabled,
});

// --------------------
// Namespace
// --------------------
const ns = new k8s.core.v1.Namespace("app-ns", {
    metadata: { name: "travel" },
}, { provider: k8sProvider });

// --------------------
// Secret from SOPS (decrypt at deploy time)
// --------------------
const decryptedYaml = execSync("sops -d ../secrets/secrets.enc.yaml", { encoding: "utf8" });
const obj = yaml.load(decryptedYaml) as Record<string, string>;

const stringData: Record<string, pulumi.Output<string>> = {};
for (const [k, v] of Object.entries(obj)) {
    stringData[k] = pulumi.secret(v);
}

const appSecret = new k8s.core.v1.Secret("travel-secret", {
    metadata: { name: "travel-secret", namespace: ns.metadata.name },
    type: "Opaque",
    stringData,
}, {
    provider: k8sProvider,
    additionalSecretOutputs: ["stringData"],
});

// --------------------
// Deployment
// --------------------
const appLabels = { app: "travel" };

const deploy = new k8s.apps.v1.Deployment("travel", {
    metadata: { namespace: ns.metadata.name },
    spec: {
        selector: { matchLabels: appLabels },
        replicas: 2,
        template: {
            metadata: { labels: appLabels },
            spec: {
                containers: [{
                    name: "travel",
                    image,
                    ports: [{ containerPort: 8501 }],
                    envFrom: [{ secretRef: { name: appSecret.metadata.name } }],
                }],
            },
        },
    },
}, { provider: k8sProvider });

// --------------------
// Service
// --------------------
const svc = new k8s.core.v1.Service("travel-svc", {
    metadata: { namespace: ns.metadata.name },
    spec: {
        type: "LoadBalancer",
        selector: appLabels,
        ports: [{ port: 80, targetPort: 8501 }],
    },
}, { provider: k8sProvider });

export const serviceIp = svc.status.loadBalancer.ingress[0].ip;
export const observabilityEnabledOutput = observabilityEnabled;

export const monitoringNamespace =
    observability?.monitoringNs.metadata.name;

export const loggingNamespace =
    observability?.loggingNs.metadata.name;
