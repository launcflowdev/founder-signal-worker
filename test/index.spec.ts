import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('founder-signal-worker', () => {
	it('GET /health returns ok (unit style)', async () => {
		const request = new IncomingRequest('http://example.com/health');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.json() as { ok: boolean; name: string };
		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.name).toBe('founder-signal-worker');
	});

	it('GET /health returns ok (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/health');
		const body = await response.json() as { ok: boolean; name: string };
		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
	});

	it('returns 404 for unknown routes', async () => {
		const response = await SELF.fetch('https://example.com/unknown');
		expect(response.status).toBe(404);
		const body = await response.json() as { error: string };
		expect(body.error).toBe('Not Found');
	});

	it('POST /extract requires JSON body', async () => {
		const response = await SELF.fetch('https://example.com/extract', {
			method: 'POST',
			body: 'not json',
		});
		expect(response.status).toBe(400);
	});

	it('POST /extract validates required fields', async () => {
		const response = await SELF.fetch('https://example.com/extract', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ subreddits: [], keywords: [] }),
		});
		expect(response.status).toBe(400);
	});

	it('POST /extract returns hackernews provider results', async () => {
		const response = await SELF.fetch('https://example.com/extract', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				subreddits: ['startups'],
				keywords: ['AI', 'startup'],
				limit: 5,
			}),
		});
		expect(response.status).toBe(200);
		const body = await response.json() as {
			items: unknown[];
			meta: { provider: string; limit: number };
		};
		expect(body.meta.provider).toBe('hackernews');
		expect(body.meta.limit).toBe(5);
		expect(Array.isArray(body.items)).toBe(true);
	});
});
