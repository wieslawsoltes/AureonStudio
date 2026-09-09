/** Transactions store complete canonical documents, never GPU/cache state. */
export class History {
    constructor(get, set, max = 60, maxBytes = 64 * 1024 * 1024) {
        this.get = get;
        this.set = set;
        this.max = max;
        this.maxBytes = maxBytes;
        this.undoStack = [];
        this.redoStack = [];
        this.pending = null;
    }
    begin(label) {
        if (this.pending)
            return;
        this.pending = { label, before: JSON.stringify(this.get()) };
    }
    commit() {
        if (!this.pending)
            return false;
        const after = JSON.stringify(this.get()), t = this.pending;
        this.pending = null;
        if (t.before === after)
            return false;
        this.undoStack.push({ ...t, after });
        while (this.undoStack.length > 1 && (this.undoStack.length > this.max || this.undoStack.reduce((n, t) => n + 2 * (t.before.length + t.after.length), 0) > this.maxBytes))
            this.undoStack.shift();
        this.redoStack = [];
        return true;
    }
    cancel() {
        if (this.pending) {
            const data = JSON.parse(this.pending.before);
            this.pending = null;
            this.set(data);
        }
    }
    run(label, fn) {
        this.begin(label);
        try {
            fn();
            return this.commit();
        }
        catch (e) {
            this.cancel();
            throw e;
        }
    }
    undo() {
        if (this.pending)
            this.commit();
        const t = this.undoStack.pop();
        if (!t)
            return false;
        this.redoStack.push(t);
        this.set(JSON.parse(t.before));
        return t.label;
    }
    redo() {
        const t = this.redoStack.pop();
        if (!t)
            return false;
        this.undoStack.push(t);
        this.set(JSON.parse(t.after));
        return t.label;
    }
    clear() {
        this.pending = null;
        this.undoStack = [];
        this.redoStack = [];
    }
}
