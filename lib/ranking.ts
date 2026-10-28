import { firebaseConfig } from "./firebaseConfig";

export type RankingGame = "survivors" | "tower-defense" | "sky-shooter";
export type ScoreEntry = {
  id: string; // Firestore ドキュメントID
  name: string;
  score: number;
  meta: string;
  week: string;
  ownerUid: string;
  createdAt: number; // epoch ms
};

type AuthState = {
  idToken: string;
  refreshToken: string;
  localId: string;
  expiresAt: number; // epoch ms
};

const NAME_KEY = "mugi-games-player-name";
const AUTH_KEY = "mugi-games-fb-auth";
const NAME_MAX = 12;
const META_MAX = 40;
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

function clip(s: string, max: number): string {
  return Array.from(s).slice(0, max).join("");
}

function normalizeName(name: string): string {
  return clip(name.trim(), NAME_MAX);
}

/** JST の日付から ISO 週（木曜基準）を求めて "YYYY-Www" を返す */
export function currentWeekKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const d = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const dow = d.getUTCDay() || 7; // 月=1 … 日=7
  d.setUTCDate(d.getUTCDate() + 4 - dow); // その週の木曜へ
  const isoYear = d.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((d.getTime() - jan1) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function loadPlayerName(): string {
  try {
    return normalizeName(localStorage.getItem(NAME_KEY) ?? "");
  } catch {
    return "";
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, normalizeName(name));
  } catch {
    /* 保存できなくても続行 */
  }
}

// ---- 匿名認証（REST） ----

function loadAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Partial<AuthState>;
    if (
      typeof a.idToken === "string" &&
      typeof a.refreshToken === "string" &&
      typeof a.localId === "string" &&
      typeof a.expiresAt === "number"
    ) {
      return a as AuthState;
    }
    return null;
  } catch {
    return null;
  }
}

function saveAuth(a: AuthState): void {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

/** 保存済み認証情報の localId（自分のエントリ判定用）。無ければ "" */
export function peekLocalId(): string {
  return loadAuth()?.localId ?? "";
}

async function refreshAuth(refreshToken: string): Promise<AuthState | null> {
  try {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      id_token?: string;
      refresh_token?: string;
      user_id?: string;
      expires_in?: string;
    };
    if (!j.id_token || !j.refresh_token || !j.user_id) return null;
    const a: AuthState = {
      idToken: j.id_token,
      refreshToken: j.refresh_token,
      localId: j.user_id,
      expiresAt: Date.now() + Number(j.expires_in ?? 3600) * 1000,
    };
    saveAuth(a);
    return a;
  } catch {
    return null;
  }
}

async function signUpAnonymous(): Promise<AuthState | null> {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnSecureToken: true }),
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      idToken?: string;
      refreshToken?: string;
      localId?: string;
      expiresIn?: string;
    };
    if (!j.idToken || !j.refreshToken || !j.localId) return null;
    const a: AuthState = {
      idToken: j.idToken,
      refreshToken: j.refreshToken,
      localId: j.localId,
      expiresAt: Date.now() + Number(j.expiresIn ?? 3600) * 1000,
    };
    saveAuth(a);
    return a;
  } catch {
    return null;
  }
}

// 同時に複数の呼び出しがあっても匿名アカウントを重複作成しないよう、進行中の処理を共有する
let inflight: Promise<AuthState | null> | null = null;

/** 有効な idToken を用意する。force=true なら有効期限内でも更新する */
function ensureAuth(force = false): Promise<AuthState | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const saved = loadAuth();
    if (saved && !force && saved.expiresAt - Date.now() >= 60_000) return saved;
    if (saved) {
      const refreshed = await refreshAuth(saved.refreshToken);
      if (refreshed) return refreshed;
    }
    return signUpAnonymous();
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Bearer を付けて Firestore を呼ぶ。401/403 なら 1 回だけ強制リフレッシュしてリトライ */
// body は認証情報から組み立てる（リトライで uid が変わったとき owner_uid も合わせるため）
async function firestoreFetch(
  url: string,
  body: (a: AuthState | null) => unknown,
  auth: AuthState | null,
): Promise<Response> {
  const send = (a: AuthState | null) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(a ? { Authorization: `Bearer ${a.idToken}` } : {}),
      },
      body: JSON.stringify(body(a)),
    });
  const res = await send(auth);
  if ((res.status === 401 || res.status === 403) && auth) {
    const again = await ensureAuth(true);
    if (again) return send(again);
  }
  return res;
}

export async function submitScore(
  game: RankingGame,
  name: string,
  score: number,
  meta: string,
): Promise<{ id: string } | null> {
  try {
    const n = normalizeName(name);
    if (!n) return null;
    const s = Math.floor(score);
    if (!Number.isFinite(s) || s < 0) return null;
    const m = clip(meta, META_MAX);
    const auth = await ensureAuth();
    if (!auth) return null;
    const build = (a: AuthState | null) => ({
      fields: {
        game: { stringValue: game },
        name: { stringValue: n },
        score: { integerValue: String(s) },
        meta: { stringValue: m },
        week: { stringValue: currentWeekKey() },
        owner_uid: { stringValue: (a ?? auth).localId },
        created_at: { timestampValue: new Date().toISOString() },
      },
    });
    const res = await firestoreFetch(`${FIRESTORE_BASE}/scores`, build, auth);
    if (!res.ok) return null;
    const j = (await res.json()) as { name?: string };
    const id = j.name?.split("/").pop();
    return id ? { id } : null;
  } catch {
    return null;
  }
}

// ---- ランキング取得 ----

type FsValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
};
type FsDoc = { name?: string; fields?: Record<string, FsValue> };

type Row = ScoreEntry & { game: string };

function toEntry(doc: FsDoc): Row | null {
  const f = doc.fields;
  if (!doc.name || !f) return null;
  const score = Number(f.score?.integerValue ?? f.score?.doubleValue);
  if (!Number.isFinite(score)) return null;
  const createdAt = Date.parse(f.created_at?.timestampValue ?? "");
  return {
    id: doc.name.split("/").pop() ?? "",
    game: f.game?.stringValue ?? "",
    name: f.name?.stringValue ?? "",
    score,
    meta: f.meta?.stringValue ?? "",
    week: f.week?.stringValue ?? "",
    ownerUid: f.owner_uid?.stringValue ?? "",
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
  };
}

function eq(field: string, value: string) {
  return { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } };
}

async function runQuery(
  structuredQuery: unknown,
  auth: AuthState | null,
): Promise<Row[] | null> {
  try {
    const res = await firestoreFetch(`${FIRESTORE_BASE}:runQuery`, () => ({ structuredQuery }), auth);
    if (!res.ok) return null;
    const rows = (await res.json()) as { document?: FsDoc; error?: unknown }[];
    if (!Array.isArray(rows) || rows.some((r) => r.error)) return null;
    const out: Row[] = [];
    for (const r of rows) {
      if (!r.document) continue;
      const e = toEntry(r.document);
      if (e) out.push(e);
    }
    return out;
  } catch {
    return null;
  }
}

export async function fetchBoard(
  game: RankingGame,
  scope: "week" | "all",
): Promise<ScoreEntry[] | null> {
  try {
    // 読み取りは未認証でも可。既に匿名ログイン済みのときだけトークンを付ける（閲覧だけの人に匿名アカウントを作らない）
    const auth = loadAuth() ? await ensureAuth().catch(() => null) : null;
    const week = currentWeekKey();
    const orderBy = [{ field: { fieldPath: "score" }, direction: "DESCENDING" }];
    const where =
      scope === "week"
        ? { compositeFilter: { op: "AND", filters: [eq("game", game), eq("week", week)] } }
        : eq("game", game);
    const primary = await runQuery(
      { from: [{ collectionId: "scores" }], where, orderBy, limit: 10 },
      auth,
    );
    // 複合インデックス未作成（FAILED_PRECONDITION）などに備え、絞り込みをクライアント側で行う
    const rows =
      primary ??
      (await runQuery({ from: [{ collectionId: "scores" }], orderBy, limit: 200 }, auth))?.filter(
        (e) => e.game === game && (scope === "all" || e.week === week),
      );
    if (!rows) return null;
    return rows.slice(0, 10).map(({ game: _game, ...e }) => e);
  } catch {
    return null;
  }
}
