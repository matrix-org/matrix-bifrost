import { expect } from "chai";
import { ConfigValidator } from "matrix-appservice-bridge";

const SCHEMA_FILE = `${__dirname}/../config/config.schema.yaml`;
const SAMPLE_FILE = `${__dirname}/../config.sample.yaml`;
describe("configuration files", () =>{

    it("should load the schema file successfully", () => {
        ConfigValidator.fromSchemaFile(SCHEMA_FILE);
    });

    it("should validate the sample config file successfully", () => {
        const validator = ConfigValidator.fromSchemaFile(SCHEMA_FILE);
        try {
            validator.validate(SAMPLE_FILE);
        } catch (ex) {
            // tslint:disable-next-line: no-console
            console.log(ex);
            throw Error('Sample config did not validate');
        }
    });
})