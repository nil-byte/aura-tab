export class DragStateMachine {
    #state = 'idle';
    #cooldownTimer = null;
    #cooldownMs;
    #listeners = new Set();
    constructor(cooldownMs = 150) {
        this.#cooldownMs = cooldownMs;
    }
    get state() {
        return this.#state;
    }
    get isIdle() {
        return this.#state === 'idle';
    }
    get isDragging() {
        return this.#state === 'dragging';
    }
    get isInCooldown() {
        return this.#state === 'cooldown';
    }
    get canOperate() {
        return this.#state === 'idle';
    }
    startDrag() {
        if (this.#state !== 'idle') return false;
        this.#clearCooldown();
        this.#transition('dragging');
        return true;
    }
    endDrag() {
        if (this.#state !== 'dragging') return false;
        this.#transition('cooldown');
        this.#cooldownTimer = setTimeout(() => {
            this.#cooldownTimer = null;
            if (this.#state === 'cooldown') {
                this.#transition('idle');
            }
        }, this.#cooldownMs);
        return true;
    }
    reset() {
        this.#clearCooldown();
        this.#transition('idle');
    }
    subscribe(callback) {
        this.#listeners.add(callback);
        return () => this.#listeners.delete(callback);
    }
    destroy() {
        this.#clearCooldown();
        this.#listeners.clear();
        this.#state = 'idle';
    }
    #clearCooldown() {
        if (this.#cooldownTimer !== null) {
            clearTimeout(this.#cooldownTimer);
            this.#cooldownTimer = null;
        }
    }
    #transition(newState) {
        if (this.#state === newState) return;
        this.#state = newState;
        for (const cb of this.#listeners) {
            try {
                cb(newState);
            } catch (e) {
                console.error('[DragStateMachine] Listener error:', e);
            }
        }
    }
}
export class AsyncTaskTracker {
    #tasks = new Map();
    #counter = 0;
    #destroyed = false;
    createTask() {
        if (this.#destroyed) {
            return {
                id: -1,
                signal: AbortSignal.abort(),
                isValid: () => false
            };
        }
        const id = ++this.#counter;
        const controller = new AbortController();
        this.#tasks.set(id, controller);
        return {
            id,
            signal: controller.signal,
            isValid: () => !this.#destroyed && this.#tasks.has(id) && !controller.signal.aborted
        };
    }
    completeTask(id) {
        this.#tasks.delete(id);
    }
    cancelTask(id) {
        const controller = this.#tasks.get(id);
        if (controller) {
            controller.abort();
            this.#tasks.delete(id);
        }
    }
    cancelAll() {
        for (const controller of this.#tasks.values()) {
            controller.abort();
        }
        this.#tasks.clear();
    }
    destroy() {
        this.#destroyed = true;
        this.cancelAll();
    }
    get isDestroyed() {
        return this.#destroyed;
    }
    get pendingCount() {
        return this.#tasks.size;
    }
}
export class TimerManager {
    #timeouts = new Map();
    #intervals = new Map();
    #rafs = new Map();
    #destroyed = false;
    setTimeout(name, callback, delay) {
        if (this.#destroyed) return false;
        this.clearTimeout(name);
        const id = setTimeout(() => {
            this.#timeouts.delete(name);
            if (!this.#destroyed) callback();
        }, delay);
        this.#timeouts.set(name, id);
        return true;
    }
    clearTimeout(name) {
        const id = this.#timeouts.get(name);
        if (id !== undefined) {
            clearTimeout(id);
            this.#timeouts.delete(name);
        }
    }
    setInterval(name, callback, interval) {
        if (this.#destroyed) return false;
        this.clearInterval(name);
        const id = setInterval(() => {
            if (!this.#destroyed) callback();
        }, interval);
        this.#intervals.set(name, id);
        return true;
    }
    clearInterval(name) {
        const id = this.#intervals.get(name);
        if (id !== undefined) {
            clearInterval(id);
            this.#intervals.delete(name);
        }
    }
    requestAnimationFrame(name, callback) {
        if (this.#destroyed) return false;
        this.cancelAnimationFrame(name);
        const id = requestAnimationFrame((time) => {
            this.#rafs.delete(name);
            if (!this.#destroyed) callback(time);
        });
        this.#rafs.set(name, id);
        return true;
    }
    cancelAnimationFrame(name) {
        const id = this.#rafs.get(name);
        if (id !== undefined) {
            cancelAnimationFrame(id);
            this.#rafs.delete(name);
        }
    }
    hasTimeout(name) {
        return this.#timeouts.has(name);
    }
    clearTimeoutsWithPrefix(prefix) {
        for (const [name, id] of this.#timeouts) {
            if (name.startsWith(prefix)) {
                clearTimeout(id);
                this.#timeouts.delete(name);
            }
        }
    }
    clearAll() {
        for (const id of this.#timeouts.values()) clearTimeout(id);
        for (const id of this.#intervals.values()) clearInterval(id);
        for (const id of this.#rafs.values()) cancelAnimationFrame(id);
        this.#timeouts.clear();
        this.#intervals.clear();
        this.#rafs.clear();
    }
    destroy() {
        this.#destroyed = true;
        this.clearAll();
    }
    get isDestroyed() {
        return this.#destroyed;
    }
}
export class EventListenerManager {
    #listeners = [];
    #destroyed = false;
    add(target, type, handler, options) {
        if (this.#destroyed) return () => {};
        target.addEventListener(type, handler, options);
        const entry = { target, type, handler, options };
        this.#listeners.push(entry);
        return () => this.#remove(entry);
    }
    #remove(entry) {
        const index = this.#listeners.indexOf(entry);
        if (index !== -1) {
            entry.target.removeEventListener(entry.type, entry.handler, entry.options);
            this.#listeners.splice(index, 1);
        }
    }
    removeAll() {
        for (const { target, type, handler, options } of this.#listeners) {
            target.removeEventListener(type, handler, options);
        }
        this.#listeners = [];
    }
    destroy() {
        this.#destroyed = true;
        this.removeAll();
    }
    get count() {
        return this.#listeners.length;
    }
}
const STORAGE_MANAGER_INSTANCES = new Set();
let STORAGE_MASTER_HANDLER = null;
export class StorageListenerManager {
    #handlers = new Map();
    #destroyed = false;
    #writeRevision = null;
    #writeRevisionTimer = null;
    constructor() {
        STORAGE_MANAGER_INSTANCES.add(this);
        if (!STORAGE_MASTER_HANDLER) {
            STORAGE_MASTER_HANDLER = (changes, areaName) => {
                for (const manager of STORAGE_MANAGER_INSTANCES) {
                    manager._handleStorageChange(changes, areaName);
                }
            };
            chrome.storage.onChanged.addListener(STORAGE_MASTER_HANDLER);
        }
    }
    _handleStorageChange(changes, areaName) {
        if (this.#destroyed) return;
        if (this.#writeRevision && changes._writeRevision?.newValue === this.#writeRevision) {
            return;
        }
        for (const handler of this.#handlers.values()) {
            try {
                handler(changes, areaName);
            } catch (error) {
                console.error('[StorageListenerManager] Handler error:', error);
            }
        }
    }
    register(name, handler) {
        if (this.#destroyed) return () => {};
        this.#handlers.set(name, handler);
        return () => this.#handlers.delete(name);
    }
    unregister(name) {
        this.#handlers.delete(name);
    }
    markWrite() {
        if (this.#writeRevisionTimer !== null) {
            clearTimeout(this.#writeRevisionTimer);
        }
        this.#writeRevision = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.#writeRevisionTimer = setTimeout(() => {
            this.#writeRevisionTimer = null;
            this.#writeRevision = null;
        }, 2000);
        return this.#writeRevision;
    }
    clearWriteMark() {
        if (this.#writeRevisionTimer !== null) {
            clearTimeout(this.#writeRevisionTimer);
            this.#writeRevisionTimer = null;
        }
        this.#writeRevision = null;
    }
    destroy() {
        if (this.#destroyed) return;
        this.#destroyed = true;
        if (this.#writeRevisionTimer !== null) {
            clearTimeout(this.#writeRevisionTimer);
            this.#writeRevisionTimer = null;
        }
        this.#writeRevision = null;
        STORAGE_MANAGER_INSTANCES.delete(this);
        if (STORAGE_MANAGER_INSTANCES.size === 0 && STORAGE_MASTER_HANDLER) {
            try {
                chrome.storage.onChanged.removeListener(STORAGE_MASTER_HANDLER);
            } catch { /* storage API may be unavailable during extension shutdown */ }
            STORAGE_MASTER_HANDLER = null;
        }
        this.#handlers.clear();
    }
    get isDestroyed() {
        return this.#destroyed;
    }
}
export function createDebounce(fn, delay) {
    let timer = null;
    let lastArgs = null;
    const cancel = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        lastArgs = null;
    };
    const flush = () => {
        if (timer !== null && lastArgs !== null) {
            clearTimeout(timer);
            timer = null;
            const args = lastArgs;
            lastArgs = null;
            fn(...args);
        }
    };
    const call = (...args) => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        lastArgs = args;
        timer = setTimeout(() => {
            timer = null;
            const a = lastArgs;
            lastArgs = null;
            if (a !== null) fn(...a);
        }, delay);
    };
    return { call, cancel, flush };
}
export function createConditionalExecutor(condition, action, delay, maxRetries = 10) {
    let timer = null;
    let retries = 0;
    const cancel = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        retries = 0;
    };
    const attempt = () => {
        timer = null;
        if (condition()) {
            retries = 0;
            action();
        } else if (retries < maxRetries) {
            retries++;
            timer = setTimeout(attempt, delay);
        } else {
            retries = 0;
        }
    };
    const start = () => {
        cancel();
        attempt();
    };
    return { start, cancel };
}
export class DisposableComponent {
    #initialized = false;
    #destroyed = false;
    _timers = new TimerManager();
    _events = new EventListenerManager();
    _tasks = new AsyncTaskTracker();
    _storage = null;
    #disposables = [];
    get isInitialized() {
        return this.#initialized;
    }
    get isDestroyed() {
        return this.#destroyed;
    }
    _getStorageManager() {
        if (!this._storage) {
            this._storage = new StorageListenerManager();
        }
        return this._storage;
    }
    _markInitialized() {
        this.#initialized = true;
    }
    _assertNotDestroyed() {
        if (this.#destroyed) {
            throw new Error(`[${this.constructor.name}] Instance has been destroyed`);
        }
    }
    _addDisposable(disposable) {
        if (typeof disposable === 'function') {
            this.#disposables.push(disposable);
        }
    }
    destroy() {
        if (this.#destroyed) return;
        this.#destroyed = true;
        for (const dispose of this.#disposables) {
            try {
                dispose();
            } catch (e) {
                console.error(`[${this.constructor.name}] Dispose error:`, e);
            }
        }
        this.#disposables = [];
        this._timers.destroy();
        this._events.destroy();
        this._tasks.destroy();
        if (this._storage) {
            this._storage.destroy();
            this._storage = null;
        }
        this.#initialized = false;
    }
}
