export class ServerVersion {
    protected parts: number[] = [];
    protected suffix: string;
    protected readonly compatible: boolean;

    constructor(public readonly versionString: string) {
        const dash = versionString.indexOf('-');
        const main = dash === -1 ? versionString : versionString.slice(0, dash);
        this.suffix = dash === -1 ? '' : versionString.slice(dash + 1);
        let allFinite = true;
        if (main.length > 0) {
            this.parts = main.split('.').map((part) => {
                const n = parseInt(part, 10);
                if (!Number.isFinite(n)) {
                    allFinite = false;
                }
                return n;
            });
        }
        this.compatible = this.parts.length >= 2 && allFinite;
    }

    public equals(a: ServerVersion | string): boolean {
        const versionString = typeof a === 'string' ? a : a.versionString;
        return this.versionString === versionString;
    }

    /**
     * Strict greater-than for `<major>.<minor>[.<patch>...][-<suffix>]` versions.
     *
     * Comparison order:
     * 1. Numeric parts compare pairwise as integers (so `1.19-ws10 > 1.19-ws6`
     *    even though `'ws10' < 'ws6'` lexicographically — the parts decide
     *    first, but the same numeric-not-string spirit also drives the
     *    suffix rule below).
     * 2. If all overlapping numeric parts are equal, the longer version wins
     *    (`3.3.4 > 3.3`).
     * 3. On a full numeric tie, the suffix decides with a natural-numeric
     *    rule:
     *      - An EMPTY suffix sorts AFTER any non-empty suffix, so a final
     *        release outranks its pre-releases (`4.0 > 4.0-rc1`).
     *      - Two non-empty suffixes are split into (alphaPrefix,
     *        numericTail) where `numericTail` is the trailing run of digits
     *        (possibly empty, which counts as 0). If the alpha prefixes
     *        match exactly, the numeric tails compare as integers
     *        (`ws10 > ws6`). Otherwise the suffixes compare as plain
     *        strings (`rc1 > beta2` because `'r' > 'b'`).
     */
    public gt(a: ServerVersion | string): boolean {
        if (this.equals(a)) {
            return false;
        }
        if (typeof a === 'string') {
            a = new ServerVersion(a);
        }
        const minLength = Math.min(this.parts.length, a.parts.length);
        for (let i = 0; i < minLength; i++) {
            if (this.parts[i] > a.parts[i]) {
                return true;
            }
            if (this.parts[i] < a.parts[i]) {
                return false;
            }
        }
        if (this.parts.length > a.parts.length) {
            return true;
        }
        if (this.parts.length < a.parts.length) {
            return false;
        }
        if (this.suffix === '' && a.suffix !== '') {
            return true;
        }
        if (this.suffix !== '' && a.suffix === '') {
            return false;
        }
        const mine = splitSuffix(this.suffix);
        const theirs = splitSuffix(a.suffix);
        if (mine.alpha === theirs.alpha) {
            return mine.num > theirs.num;
        }
        return this.suffix > a.suffix;
    }

    public isCompatible(): boolean {
        return this.compatible;
    }
}

function splitSuffix(suffix: string): { alpha: string; num: number } {
    const match = /^(.*?)(\d*)$/.exec(suffix);
    const alpha = match ? match[1] : suffix;
    const tail = match ? match[2] : '';
    return { alpha, num: tail === '' ? 0 : parseInt(tail, 10) };
}
