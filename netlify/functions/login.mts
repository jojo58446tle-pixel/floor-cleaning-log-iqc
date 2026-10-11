import type { Config } from '@netlify/functions';
import api from './api.mts';
export default api;
export const config: Config = { path: '/api/auth/login', rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
