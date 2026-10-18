'use strict';
/**
 * Web tool — lets the agent fetch HTTP(S) pages, useful for research-style
 * tasks. Response is truncated to keep the LLM context small.
 */

const MAX_BODY = 20000;

function makeWebTools() {
  return [
    {
      name: 'web.fetch',
      description: 'Fetch a URL and return its text content (truncated to 20000 chars).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The http(s) URL to fetch.' },
        },
        required: ['url'],
      },
      async execute(args) {
        const raw = String(args.url || '').trim();
        if (!/^https?:\/\//i.test(raw)) throw new Error('only http(s) URLs are allowed');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const resp = await fetch(raw, { redirect: 'follow', signal: controller.signal });
          const text = await resp.text();
          return {
            status: resp.status,
            contentType: resp.headers.get('content-type') || '',
            body: text.slice(0, MAX_BODY),
            truncated: text.length > MAX_BODY,
          };
        } finally {
          clearTimeout(timer);
        }
      },
    },
  ];
}

module.exports = makeWebTools;
