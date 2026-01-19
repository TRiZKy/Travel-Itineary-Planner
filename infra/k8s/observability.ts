import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as fs from "fs";
import * as childProcess from "child_process";
import * as yaml from "js-yaml";

function sopsDecryptFile(path: string): string {
    // Requires `sops` available in PATH in local + CI.
    return childProcess.execFileSync("sops", ["-d", path], { encoding: "utf8" });
}

export function deployObservability(args: {
    provider: k8s.Provider;
    enabled: boolean;
    loki: {
        bucketName: pulumi.Input<string>;
        gsaEmail: pulumi.Input<string>;
    };
}) {
    const { provider, enabled } = args;
    if (!enabled) return undefined;

    const monitoringNs = new k8s.core.v1.Namespace(
        "monitoring-ns",
        { metadata: { name: "monitoring" } },
        { provider }
    );

    const loggingNs = new k8s.core.v1.Namespace(
        "logging-ns",
        { metadata: { name: "logging" } },
        { provider }
    );

    // -------------------------
    // Decrypt SOPS secrets
    // -------------------------
    const encPath = "secrets/observability.enc.yaml"; // relative to infra/ when running
    if (!fs.existsSync(encPath)) {
        throw new Error(`Missing encrypted secrets file: ${encPath}`);
    }

    const plaintext = sopsDecryptFile(encPath);
    const doc = yaml.load(plaintext) as any;

    const grafanaAdminPassword = String(doc?.grafana?.adminPassword ?? "");
    if (!grafanaAdminPassword) {
        throw new Error("Missing grafana.adminPassword in observability.enc.yaml");
    }

    // -------------------------
    // Kubernetes Secret for Grafana
    // -------------------------
    const grafanaSecretName = "grafana-admin";

    const grafanaSecret = new k8s.core.v1.Secret(
        "grafana-admin-secret",
        {
            metadata: {
                name: grafanaSecretName,
                namespace: monitoringNs.metadata.name,
            },
            type: "Opaque",
            stringData: {
                adminUser: "admin",
                adminPassword: grafanaAdminPassword,
            },
        },
        { provider }
    );

    // -------------------------
    // Metrics: Prometheus + Grafana
    // -------------------------
    const kubeProm = new k8s.helm.v3.Release(
        "kube-prometheus",
        {
            namespace: monitoringNs.metadata.name,
            chart: "kube-prometheus-stack",
            repositoryOpts: { repo: "https://prometheus-community.github.io/helm-charts" },
            values: {
                grafana: {
                    enabled: true,
                    service: { type: "ClusterIP" },

                    // IMPORTANT: don't set adminPassword here (it would end up in state)
                    admin: {
                        existingSecret: grafanaSecretName,
                        userKey: "adminUser",
                        passwordKey: "adminPassword",
                    },
                },
                prometheus: {
                    prometheusSpec: { retention: "7d" },
                },
            },
        },
        { provider, dependsOn: [grafanaSecret] }
    );

    // -------------------------
    // Logs: Loki (GCS object storage) + Promtail
    // -------------------------

    // ✅ KSA annotated to impersonate the Loki GSA via Workload Identity
    const lokiKsa = new k8s.core.v1.ServiceAccount(
        "loki-ksa",
        {
            metadata: {
                name: "loki",
                namespace: loggingNs.metadata.name,
                annotations: {
                    "iam.gke.io/gcp-service-account": args.loki.gsaEmail,
                },
            },
        },
        { provider }
    );

    const loki = new k8s.helm.v3.Release(
        "loki",
        {
            name: "loki",
            namespace: loggingNs.metadata.name,
            chart: "loki",
            repositoryOpts: { repo: "https://grafana.github.io/helm-charts" },
            values: {
                // Distributed / “real” mode
                deploymentMode: "SimpleScalable",

                // Keep Helm tests happy
                lokiCanary: { enabled: true },

                // Enable gateway (nice for a single endpoint)
                gateway: { enabled: true },

                // Caches (these improve performance)
                chunksCache: { enabled: true },
                resultsCache: { enabled: true },

                // Use our Workload Identity KSA
                serviceAccount: {
                    create: false,
                    name: "loki",
                },

                loki: {
                    auth_enabled: false,

                    commonConfig: {
                        replication_factor: 2,
                    },

                    // Required in distributed mode for ring membership
                    memberlist: {
                        join_members: ["loki-memberlist"],
                    },

                    schemaConfig: {
                        configs: [
                            {
                                from: "2024-01-01",
                                store: "tsdb",
                                object_store: "gcs",
                                schema: "v13",
                                index: {
                                    prefix: "index_",
                                    period: "24h",
                                },
                            },
                        ],
                    },

                    storage: {
                        type: "gcs",
                        bucketNames: {
                            chunks: args.loki.bucketName,
                            ruler: args.loki.bucketName,
                            admin: args.loki.bucketName,
                        },
                    },
                },

                // Scale settings (start realistic but not huge)
                write: {
                    replicas: 2,
                    resources: {
                        requests: { cpu: "200m", memory: "512Mi" },
                        limits: { memory: "1Gi" },
                    },
                },
                read: {
                    replicas: 2,
                    resources: {
                        requests: { cpu: "200m", memory: "512Mi" },
                        limits: { memory: "1Gi" },
                    },
                },
                backend: {
                    replicas: 2,
                    resources: {
                        requests: { cpu: "200m", memory: "512Mi" },
                        limits: { memory: "1Gi" },
                    },
                },

                // This service is needed for memberlist gossip in many setups
                memberlist: {
                    service: {
                        publishNotReadyAddresses: true,
                    },
                },
            },
        },
        { provider, dependsOn: [lokiKsa] }
    );

    const promtail = new k8s.helm.v3.Release(
        "promtail",
        {
            namespace: loggingNs.metadata.name,
            chart: "promtail",
            repositoryOpts: { repo: "https://grafana.github.io/helm-charts" },
            values: {
                config: {
                    clients: [
                        {
                            url: "http://loki-gateway.logging.svc.cluster.local/loki/api/v1/push",
                        },
                    ],
                },
            },
        },
        { provider, dependsOn: [loki] }
    );


    return { monitoringNs, loggingNs, kubeProm, loki, promtail };
}
