import { PrometheusMetrics, AgeCounter } from "matrix-appservice-bridge";
import { Gauge, Counter } from "prom-client";

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
        this.bridgeGauges = {
            matrixRoomConfigs: 0,
            remoteRoomConfigs: 0,
            matrixGhosts: 0,
            remoteGhosts: 0,
            matrixRoomsByAge: new AgeCounter(),
            remoteRoomsByAge: new AgeCounter(),
            matrixUsersByAge: new AgeCounter(),
            remoteUsersByAge: new AgeCounter(),
        };
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
        matrixRoomsByAge: new AgeCounter(),
        remoteRoomsByAge: new AgeCounter(),
        matrixUsersByAge: new AgeCounter(),
        remoteUsersByAge: new AgeCounter(),
    };
}
