import { ControlMessage, ControlMessageInterface } from './ControlMessage';
import Position, { PositionInterface } from '../Position';

export interface ScrollControlMessageInterface extends ControlMessageInterface {
    position: PositionInterface;
    hScroll: number;
    vScroll: number;
    buttons: number;
}

function toScrollFixedPoint(v: number): number {
    const scaled = Math.round(v * 32767);
    return Math.max(-32768, Math.min(32767, scaled));
}

export class ScrollControlMessage extends ControlMessage {
    // 4 (x) + 4 (y) + 2 (w) + 2 (h) + 2 (hScroll) + 2 (vScroll) + 4 (buttons) = 20 payload bytes;
    // plus 1 byte type prefix = 21 total wire bytes. PAYLOAD_LENGTH excludes the type byte
    // (matches current usage in this file: Buffer.alloc(PAYLOAD_LENGTH + 1)).
    public static PAYLOAD_LENGTH = 20;

    constructor(
        readonly position: Position,
        readonly hScroll: number,
        readonly vScroll: number,
        readonly buttons: number = 0,
    ) {
        super(ControlMessage.TYPE_SCROLL);
    }

    /**
     * @override
     */
    public toBuffer(): Buffer {
        const buffer = Buffer.alloc(ScrollControlMessage.PAYLOAD_LENGTH + 1);
        let offset = 0;
        offset = buffer.writeUInt8(this.type, offset);
        offset = buffer.writeInt32BE(this.position.point.x, offset);
        offset = buffer.writeInt32BE(this.position.point.y, offset);
        offset = buffer.writeUInt16BE(this.position.screenSize.width, offset);
        offset = buffer.writeUInt16BE(this.position.screenSize.height, offset);
        offset = buffer.writeInt16BE(toScrollFixedPoint(this.hScroll), offset);
        offset = buffer.writeInt16BE(toScrollFixedPoint(this.vScroll), offset);
        buffer.writeUInt32BE(this.buttons, offset);
        return buffer;
    }

    public toString(): string {
        return `ScrollControlMessage{hScroll=${this.hScroll}, vScroll=${this.vScroll}, buttons=${this.buttons}, position=${this.position}}`;
    }

    public toJSON(): ScrollControlMessageInterface {
        return {
            type: this.type,
            position: this.position.toJSON(),
            hScroll: this.hScroll,
            vScroll: this.vScroll,
            buttons: this.buttons,
        };
    }
}
