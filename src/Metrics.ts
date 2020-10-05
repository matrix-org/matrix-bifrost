import { AgeCounters, Bridge, PrometheusMetrics } from "matrix-appservice-bridge";
import { Counter, Histogram } from "prom-client";

interface IBridgeGauges {
    matrixRoomConfigs: number;
    remoteRoomConfigs: number;
    matrixGhosts: number;
    remoteGhosts: number;
    matrixRoomsByAge: AgeCounters;
    remoteRoomsByAge: AgeCounters;
    matrixUsersByAge: AgeCounters;
    remoteUsersByAge: AgeCounters;
}

export class Metrics {
    public static init(bridge: Bridge) {
        this.metrics = new PrometheusMetrics();
        this.metrics.registerMatrixSdkMetrics();
        this.metrics.registerBridgeGauges(() => this.bridgeGauges);
        this.metrics.addAppServicePath(bridge);
        this.remoteCallCounter = this.metrics.addCounter({
            name: "remote_api_calls",
            help: "Count of the number of remote API calls made",
            labels: ["method"],
        });
        this.matrixRequest = this.metrics.addTimer({
            name: "matrix_request_seconds",
            help: "Histogram of processing durations of received Matrix messages",
            labels: ["outcome"],
        });
        this.remoteRequest = this.metrics.addTimer({
            name: "remote_request_seconds",
            help: "Histogram of processing durations of received remote messages",
            labels: ["outcome"],
    });
    }

    public static requestOutcome(isRemote: boolean, duration: number, outcome: string) {
        if (!this.metrics) {
            return;
        }
        (isRemote ? this.remoteRequest : this.matrixRequest).observe({outcome}, duration / 1000);
    }

    public static incRemoteGhosts(n: number) {
        this.bridgeGauges.remoteGhosts++;
    }

    public static decRemoteGhosts(n: number) {
        this.bridgeGauges.remoteGhosts--;
    }

    public static remoteCall(method: string) {
        if (!this.metrics) { return; }
        this.remoteCallCounter.inc({method});
    }

    private static metrics;
    private static remoteCallCounter: Counter;
    private static remoteRequest: Histogram;
    private static matrixRequest: Histogram;
    private static bridgeGauges: IBridgeGauges = {
        matrixRoomConfigs: 0,
        remoteRoomConfigs: 0,
        matrixGhosts: 0,
        remoteGhosts: 0,
        matrixRoomsByAge: new AgeCounters(),
        remoteRoomsByAge: new AgeCounters(),
        matrixUsersByAge: new AgeCounters(),
        remoteUsersByAge: new AgeCounters(),
    };
}
