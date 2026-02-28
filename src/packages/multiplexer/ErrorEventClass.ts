
import { Event2 } from './Event';

export class ErrorEvent2 extends Event2 implements ErrorEvent {
    public readonly AT_TARGET: 2 = 2;
    public readonly BUBBLING_PHASE: 3 = 3;
    public readonly CAPTURING_PHASE: 1 = 1;
    public readonly NONE: 0 = 0;
    readonly colno: number;
    readonly error: any;
    readonly filename: string;
    readonly lineno: number;
    readonly message: string;

    constructor(type: string, { colno, error, filename, lineno, message }: ErrorEventInit = {}) {
        super(type);
        this.error = error;
        this.colno = colno || 0;
        this.filename = filename || '';
        this.lineno = lineno || 0;
        this.message = message || '';
    }
}

export const ErrorEventClass = typeof ErrorEvent !== 'undefined' ? ErrorEvent : ErrorEvent2;
