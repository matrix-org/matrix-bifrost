import { IPurpleInstance } from "../purple/IPurpleInstance";

class MPClient {
    private purple!: IPurpleInstance;
    constructor(args: string[], private process: NodeJS.Process) {
        // Get the config from args.
        // exec a func
        this.process.on("message", this.onMessage.bind(this));
    }

    public onMessage(msg: string) {
        // id:exec:func_name:args
        const split = msg.split(":");
        const id = split[0];
        if (split[1] === "exec") {
            const func = this.purple[split[2]];
            const args = JSON.parse(split[3]);
            const res = func.call(this.purple, args);
            this.process.send!(`${id}:exec:${res ? JSON.stringify(res) : ""}`);
          // id:exec:item
        } else if (split[1] === "get") {
            const item = this.purple[split[2]];
            this.process.send!(`${id}:get:${item ? JSON.stringify(item) : ""}`);
        }
    }
}

new MPClient(process.argv, process);

/*
 * process.on('message', (m) => {
  console.log('CHILD got message:', m);
});

  Causes the parent to print: PARENT got message: { foo: 'bar', baz: null }
  process.send({ foo: 'bar', baz: NaN });
 */
