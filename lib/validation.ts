import { z } from 'zod';

// Configure before any schema module evaluates defaults under extension CSP.
z.config({ jitless: true });
export { z };
