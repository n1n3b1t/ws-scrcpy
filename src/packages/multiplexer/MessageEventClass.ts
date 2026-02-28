export class MessageEventClass extends Event implements MessageEvent {
    public readonly data: any;
    public readonly origin: string;
    public readonly lastEventId: string;
    public readonly source: MessageEventSource | null;
    public readonly ports: ReadonlyArray<MessagePort>;
    constructor(type: string, { data = null, origin = '', lastEventId = '', source = null, ports = [] }: any = {}) {
        super(type);
        this.data = data;
        this.origin = origin;
        this.lastEventId = lastEventId;
        this.source = source;
        this.ports = ports;
    }

    initMessageEvent(): void {
        throw Error('Deprecated method');
    }
}
