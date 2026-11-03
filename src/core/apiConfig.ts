const rawBase = (import.meta as any).env?.VITE_API_URL as string | undefined;

export const API_BASE_URL = (rawBase && rawBase.trim() ? rawBase.trim() : 'http://localhost:4000').replace(
  /\/+$/,
  ''
);

export const apiUrl = (path: string): string =>
  `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
