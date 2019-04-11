
class ReactiveQueue<T> {

    private queue: T[] = [];
    private isRunning = true;
    private signal: () => void = () => {};

    async *subscribe() {
        while (this.isRunning) {
            // log('QUEUE: awaiting element');
            await new Promise((resolve) => this.signal = resolve);
            while (this.queue.length > 0) {
                const el = this.queue.splice(0, 1)[0];
                // log('QUEUE: got element');
                yield el;
            }
        }
    }

    push(el: T) {
        // log('QUEUE: adding element')
        this.queue.push(el);
        this.signal();
    }

    finalize() {
        this.isRunning = false;
        this.signal();
    }
}

type Generator<T> = () => Promise<T>;

export class Scheduler {
    private pendingQueue: ReactiveQueue<Generator<unknown>> = new ReactiveQueue();

    private completion: Promise<void> | null = null;

    schedule<T>(t: Generator<T>) {
        return new Promise<T>((resolve, reject) => {
            this.pendingQueue.push(() => {
                const promise = t();
                promise.then(resolve, reject);
                return promise;
            });
        });
    }

    finalize() {
        this.pendingQueue.finalize();
        return this.run();
    }

    init() {
        this.pendingQueue = new ReactiveQueue();
        this.completion = null;
        this.run();
    }

    run() {
        if (this.completion != null) {
            return this.completion;
        }
        return this.completion = this.runner();
    }

    private async runner() {
        const sub = this.pendingQueue.subscribe();
        for await (const el of sub) {
            await el();
        }
    }
}
