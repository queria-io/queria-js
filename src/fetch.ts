/** The hint for a request the page could not make. Blocked requests and unreachable hosts look the same to a page. */
export const blockedHint = (origin: string): string =>
  `Could not reach ${origin}. If the page has a Content Security Policy, allow ${origin} in connect-src`;

/** fetch, with an error that names the origin when the request cannot be made. */
export const fetchFrom = (url: string, init?: RequestInit): Promise<Response> =>
  fetch(url, init).catch((e: unknown) => {
    throw new Error(blockedHint(new URL(url).origin), { cause: e });
  });

/** The hint for a DuckDB error about a file it could not load, such as an extension or a data file. */
export const loadFailureHint = (message: string): string | null => {
  const url = /Failed to load '(https?:\/\/[^']+)'/.exec(message)?.[1];
  return url ? blockedHint(new URL(url).origin) : null;
};

const EMPTY_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

/** Throw when the page's Content Security Policy does not let it compile WebAssembly: DuckDB would wait forever. */
export const assertWasmAllowed = (): void => {
  try {
    new WebAssembly.Module(EMPTY_WASM);
  } catch (e) {
    throw new Error("The page's Content Security Policy blocks WebAssembly. Add 'wasm-unsafe-eval' to script-src", { cause: e });
  }
};
