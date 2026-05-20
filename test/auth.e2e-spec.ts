import { describeAuth } from './auth';
import './setup';

// `describeAuth()` registers its own `describe(...)` block. setup.ts's
// top-level beforeAll/afterAll fire once for the file.
describeAuth();
