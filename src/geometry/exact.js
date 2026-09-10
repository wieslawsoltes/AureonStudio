/** Exact rational predicates and constructions on the input IEEE-754 values.
 * No coordinate quantization, epsilon classification, or decimal round-tripping.
 * The filtered orientation predicates only pay for BigInt when the sign is unsure.
 */
const bits = new DataView(new ArrayBuffer(8));
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
export class Rational {
    constructor(n, d = 1n) {
        if (!d) throw Error('Zero rational denominator');
        if (d < 0n) { n = -n; d = -d; }
        const g = gcd(n, d); this.n = n / g; this.d = d / g;
    }
    static from(x) {
        if (x instanceof Rational) return x;
        if (!Number.isFinite(x)) throw Error('Exact predicates require finite coordinates');
        if (x === 0) return new Rational(0n);
        bits.setFloat64(0, x, false);
        const b = bits.getBigUint64(0, false), e = Number((b >> 52n) & 2047n);
        let n = (b & ((1n << 52n) - 1n)) | (e ? 1n << 52n : 0n);
        if (b >> 63n) n = -n;
        const shift = (e || 1) - 1075;
        return shift >= 0 ? new Rational(n << BigInt(shift)) : new Rational(n, 1n << BigInt(-shift));
    }
    add(x) { x = Rational.from(x); return new Rational(this.n*x.d + x.n*this.d, this.d*x.d); }
    sub(x) { x = Rational.from(x); return new Rational(this.n*x.d - x.n*this.d, this.d*x.d); }
    mul(x) { x = Rational.from(x); return new Rational(this.n*x.n, this.d*x.d); }
    div(x) { x = Rational.from(x); return new Rational(this.n*x.d, this.d*x.n); }
    neg() { return new Rational(-this.n, this.d); }
    sign() { return this.n < 0n ? -1 : this.n > 0n ? 1 : 0; }
    compare(x) { return this.sub(x).sign(); }
    number() {
        // Conversion without overflowing numerator/denominator independently.
        if (!this.n) return 0;
        const sign = this.n < 0n ? -1 : 1, n = this.n < 0n ? -this.n : this.n;
        const nb = n.toString(2).length, db = this.d.toString(2).length;
        const ns = Math.max(0, nb-54), ds = Math.max(0, db-54);
        return sign * (Number(n >> BigInt(ns)) / Number(this.d >> BigInt(ds))) * 2 ** (ns-ds);
    }
    key() { return `${this.n}/${this.d}`; }
}
export const rationalPoint = p => p.map(Rational.from);
export const exactSub = (a,b) => a.map((x,i) => x.sub(b[i]));
export const exactDot = (a,b) => a.reduce((sum,x,i) => sum.add(x.mul(b[i])), Rational.from(0));
export const exactCross = (a,b) => [a[1].mul(b[2]).sub(a[2].mul(b[1])), a[2].mul(b[0]).sub(a[0].mul(b[2])), a[0].mul(b[1]).sub(a[1].mul(b[0]))];
export const exactLerp = (a,b,t) => a.map((x,i) => x.add(b[i].sub(x).mul(t)));
export const exactKey = p => p.map(x => x.key()).join(',');
export function orient2d(a,b,c) {
    const x = (a[0]-c[0])*(b[1]-c[1]), y = (a[1]-c[1])*(b[0]-c[0]), det = x-y;
    if (Number.isFinite(det) && Math.abs(det) > (Math.abs(x)+Math.abs(y))*3.3306690738754716e-16) return Math.sign(det);
    const A = exactSub(rationalPoint(a),rationalPoint(c)), B = exactSub(rationalPoint(b),rationalPoint(c));
    return A[0].mul(B[1]).sub(A[1].mul(B[0])).sign();
}
export function orient3d(a,b,c,d) {
    const A = a.map((x,i)=>x-d[i]), B = b.map((x,i)=>x-d[i]), C = c.map((x,i)=>x-d[i]);
    const terms = [A[0]*B[1]*C[2], A[0]*B[2]*C[1], A[1]*B[2]*C[0], A[1]*B[0]*C[2], A[2]*B[0]*C[1], A[2]*B[1]*C[0]];
    const det = terms[0]-terms[1]+terms[2]-terms[3]+terms[4]-terms[5];
    if (Number.isFinite(det) && Math.abs(det) > terms.reduce((s,x)=>s+Math.abs(x),0)*7.771561172376103e-16) return Math.sign(det);
    return exactDot(exactSub(rationalPoint(a),rationalPoint(d)),exactCross(exactSub(rationalPoint(b),rationalPoint(d)),exactSub(rationalPoint(c),rationalPoint(d)))).sign();
}
