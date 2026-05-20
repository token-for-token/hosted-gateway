// VENDORED — local edit (allowed by drift policy): re-export the project logger
// so vendored t4t code shares the same pino instance as the rest of the service.
export { logger } from '../../logger';
export type { Logger } from '../../logger';
