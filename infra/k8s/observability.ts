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
}) {
    const { provider, enabled } = args;
    if (!enabled) return undefined;

    const monitoringNs = new k8s.core.v1.Namespace("monitoring-ns", {
        metadata: { name: "monitoring" },
    }, { provider });

    const loggingNs = new k8s.core.v1.Namespace("logging-ns", {
        metadata: { name: "logging" },
    }, { provider });

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

    const grafanaSecret = new k8s.core.v1.Secret("grafana-admin-secret", {
        metadata: {
            name: grafanaSecretName,
            namespace: monitoringNs.metadata.name,
        },
        type: "Opaque",
        stringData: {
            // kube-prometheus-stack/grafana expects these keys when using existingSecret:
            adminUser: "admin",
            adminPassword: grafanaAdminPassword,
        },
    }, { provider });

    // -------------------------
    // Metrics: Prometheus + Grafana
    // -------------------------
    const kubeProm = new k8s.helm.v3.Release("kube-prometheus", {
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
    }, { provider, dependsOn: [grafanaSecret] });

    // -------------------------
    // Logs: Loki + Promtail
    // -------------------------
    const loki = new k8s.helm.v3.Release("loki", {
        namespace: loggingNs.metadata.name,
        chart: "loki",
        repositoryOpts: { repo: "https://grafana.github.io/helm-charts" },
        values: {
            loki: { auth_enabled: false },
            singleBinary: { replicas: 1 },
        },
    }, { provider });

    const promtail = new k8s.helm.v3.Release("promtail", {
        namespace: loggingNs.metadata.name,
        chart: "promtail",
        repositoryOpts: { repo: "https://grafana.github.io/helm-charts" },
        values: {
            config: {
                clients: [{ url: "http://loki:3100/loki/api/v1/push" }],
            },
        },
    }, { provider });

    return { monitoringNs, loggingNs, kubeProm, loki, promtail };
}
