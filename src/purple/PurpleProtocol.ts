export class PurpleProtocol {
    public readonly name: string;
    public readonly summary: string;
    public readonly homepage: string;
    public readonly id: string;
    constructor(data: any, public readonly canAddExisting: boolean = true, public readonly canCreateNew: boolean = true) {
        this.name = data.name;
        this.summary = data.summary!;
        this.homepage = data.homepage!;
        this.id = data.id;
    }
}