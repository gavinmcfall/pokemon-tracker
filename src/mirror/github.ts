/**
 * Minimal GitHub access for the PokéAPI mirror: find the latest commit that
 * touched the CSV data path (the SHA the mirror pins + watches), list the CSV
 * files in that tree, and read each raw file. Unauthenticated works for a public
 * repo (60 req/hr is ample for a daily job that makes 2 API calls); set
 * GITHUB_TOKEN to raise the limit. Raw file reads don't count against the API.
 */

export interface RepoRef {
  owner: string;
  repo: string;
  /** Directory holding the CSVs, e.g. `data/v2/csv`. */
  path: string;
}

export interface CsvFile {
  /** Repo-relative path, e.g. `data/v2/csv/pokedexes.csv`. */
  path: string;
  /** Bare filename, e.g. `pokedexes.csv`. */
  name: string;
}

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'livingdex-pokeapi-mirror',
  };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function getJson<T>(fetchImpl: typeof fetch, url: string, token?: string): Promise<T> {
  const res = await fetchImpl(url, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** The SHA of the latest commit touching the CSV data path. */
export async function latestDataSha(fetchImpl: typeof fetch, ref: RepoRef, token?: string): Promise<string> {
  const url = `${API}/repos/${ref.owner}/${ref.repo}/commits?path=${encodeURIComponent(ref.path)}&per_page=1`;
  const commits = await getJson<{ sha: string }[]>(fetchImpl, url, token);
  const sha = commits[0]?.sha;
  if (!sha) throw new Error(`no commits found for ${ref.owner}/${ref.repo} path ${ref.path}`);
  return sha;
}

/** Every `*.csv` file under the data path, at the given tree SHA. */
export async function listCsvFiles(fetchImpl: typeof fetch, ref: RepoRef, sha: string, token?: string): Promise<CsvFile[]> {
  const url = `${API}/repos/${ref.owner}/${ref.repo}/git/trees/${sha}?recursive=1`;
  const tree = await getJson<{ tree: { path: string; type: string }[]; truncated: boolean }>(fetchImpl, url, token);
  if (tree.truncated) throw new Error(`git tree for ${sha} was truncated — cannot list CSVs reliably`);
  const prefix = ref.path.endsWith('/') ? ref.path : `${ref.path}/`;
  return tree.tree
    .filter((n) => n.type === 'blob' && n.path.startsWith(prefix) && n.path.toLowerCase().endsWith('.csv'))
    .map((n) => ({ path: n.path, name: n.path.slice(prefix.length) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Read a raw file at a pinned SHA (not API-rate-limited). */
export async function fetchRaw(fetchImpl: typeof fetch, ref: RepoRef, sha: string, filePath: string): Promise<string> {
  const url = `${RAW}/${ref.owner}/${ref.repo}/${sha}/${filePath}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`raw ${res.status} for ${url}`);
  return await res.text();
}
