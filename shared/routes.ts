import { z } from "zod";
import { snapshotSchema } from "./schema.ts";

export const errorSchemas = {
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  snapshots: {
    getLatest: {
      method: 'GET' as const,
      path: '/api/snapshot',
      responses: {
        200: snapshotSchema,
        404: errorSchemas.notFound,
      },
    },
  },
  tokens: {
    getAll: {
      method: 'GET' as const,
      path: '/api/tokens',
      responses: {
        200: z.object({ tokens: z.array(z.any()) }),
      },
    },
  },
  quote: {
    get: {
      method: 'POST' as const,
      path: '/api/quote',
      body: z.object({
        tokenIn: z.string(),
        tokenOut: z.string(),
        amount: z.string(),
      }),
      responses: {
        200: z.any(),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
