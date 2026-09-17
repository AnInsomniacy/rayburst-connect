import { locks } from 'node:worker_threads';

// Happy DOM does not expose Web Locks; Node provides the same native lock contract.
Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
