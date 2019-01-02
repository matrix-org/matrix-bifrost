import { PrometheusMetrics } from "matrix-appservice-bridge";
import { Gauge, Counter } from "prom-client";

const AgeCounters = PrometheusMetrics.AgeCounters;

interface IAgeCounter {
    setGauge(gauge: Gauge, morelabels: any);
    bump(age: number);
}

interface IBridgeGauges {
    matrixRoomConfigs: number;
    remoteRoomConfigs: number;
    matrixGhosts: number;
    remoteGhosts: number;
    matrixRoomsByAge: IAgeCounter;
    remoteRoomsByAge: IAgeCounter;
    matrixUsersByAge: IAgeCounter;
    remoteUsersByAge: IAgeCounter;
}

export class Metrics {
    public static init(bridge: any) {
        this.metrics = new PrometheusMetrics();
        this.metrics.registerMatrixSdkMetrics();
        this.metrics.registerBridgeGauges(() => this.bridgeGauges);
        this.metrics.addAppServicePath(bridge);
        this.remoteCallCounter = this.metrics.addCounter({
            name: "remote_api_calls",
            help: "Count of the number of remote API calls made",
            labels: ["method"],
        });
    }

    public static incRemoteGhosts(n: number) {
        this.bridgeGauges.remoteGhosts++;
    }

    public static decRemoteGhosts(n: number) {
        this.bridgeGauges.remoteGhosts--;
    }

    public static remoteCall(method: string) {
        if (!this.remoteCallCounter) { return; }
        this.remoteCallCounter.inc({method});
    }

    private static metrics;
    private static remoteCallCounter: Counter;
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
