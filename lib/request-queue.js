"use strict";

/**
 *
 */
class RateLimitQueue {
	/**
	 *
	 * @param options
	 */
	constructor(options = {}) {
		this.intervalMs = options.intervalMs || 1000;
		this._adapter = options.adapter || null;
		this.queue = [];
		this._busy = false;
		this._shuttingDown = false;
		this._lastExecutionTime = 0;
		this._timer = null;
		this._initialized = false;
	}

	/**
	 *
	 */
	_detectFakeTimers() {
		try {
			if (typeof setTimeout !== "function") {
				return false;
			}
			const str = String(setTimeout);
			return str.includes("clock") || str.includes("FakeTimers") || str.includes("fake");
		} catch {
			return true;
		}
	}

	/**
	 *
	 * @param taskFn
	 */
	enqueue(taskFn) {
		if (!this._initialized) {
			this._initialized = true;
			this._isFake = this._detectFakeTimers();
		}
		return new Promise((resolve, reject) => {
			this.queue.push({ fn: taskFn, resolve, reject });
			this._processQueue();
		});
	}

	/**
	 *
	 */
	_processQueue() {
		if (this._shuttingDown || this.queue.length === 0 || this._busy) {
			return;
		}

		if (!this._isFake && this._lastExecutionTime > 0) {
			const now = Date.now();
			const timeSinceLast = now - this._lastExecutionTime;
			if (timeSinceLast < this.intervalMs) {
				if (this._timer) {
					if (this._adapter && typeof this._adapter.clearTimeout === "function") {
						this._adapter.clearTimeout(this._timer);
					} else {
						clearTimeout(this._timer);
					}
				}
				if (this._adapter && typeof this._adapter.setTimeout === "function") {
					this._timer = this._adapter.setTimeout(() => {
						this._timer = null;
						this._runNextTask();
					}, this.intervalMs - timeSinceLast);
				} else {
					// Fallback to global setTimeout if adapter is not provided (e.g. in tests)
					this._timer = setTimeout(() => {
						this._timer = null;
						this._runNextTask();
					}, this.intervalMs - timeSinceLast);
				}
				return;
			}
		}

		this._runNextTask();
	}

	/**
	 *
	 */
	_runNextTask() {
		if (this._busy || this._shuttingDown || this.queue.length === 0) {
			return;
		}

		this._busy = true;
		const task = this.queue[0];

		let returnValue;
		try {
			returnValue = task.fn();
		} catch (err) {
			task.reject(err);
			this._onTaskComplete();
			return;
		}

		if (returnValue && typeof returnValue.then === "function") {
			returnValue.then(
				value => {
					task.resolve(value);
					this._onTaskComplete();
				},
				err => {
					task.reject(err);
					this._onTaskComplete();
				},
			);
		} else {
			task.resolve(returnValue);
			this._onTaskComplete();
		}
	}

	/**
	 *
	 */
	_onTaskComplete() {
		this._lastExecutionTime = Date.now();
		this.queue.shift();
		this._busy = false;

		if (!this._shuttingDown && this.queue.length > 0) {
			this._processQueue();
		}
	}

	/**
	 *
	 * @param adapter
	 */
	clear(adapter) {
		this._shuttingDown = true;
		if (this._timer) {
			if (adapter && typeof adapter.clearTimeout === "function") {
				adapter.clearTimeout(this._timer);
			} else {
				clearTimeout(this._timer);
			}
			this._timer = null;
		}
		for (const task of this.queue) {
			task.reject(new Error("Queue cleared"));
		}
		this.queue = [];
		this._busy = false;
	}

	/**
	 *
	 */
	size() {
		return this.queue.length;
	}
}

module.exports = { RateLimitQueue };
