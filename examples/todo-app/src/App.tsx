import { useCallback, useEffect, useState } from "react";

interface Todo {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
}

interface Session {
  authenticated: boolean;
  roles?: string[];
  permissions?: string[];
}

type Status = "loading" | "anonymous" | "authenticated";

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "code" in body) {
      return String((body as { code: unknown }).code);
    }
  } catch {
    // fall through to the status text
  }
  return response.statusText.length > 0 ? response.statusText : "request_failed";
}

export function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<Session>({ authenticated: false });
  const [todos, setTodos] = useState<readonly Todo[]>([]);
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadTodos = useCallback(async () => {
    const response = await fetch("/api/todos");
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setTodos((await response.json()) as Todo[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/auth/session");
      const body = (await response.json()) as Session;
      if (cancelled) return;
      setSession(body);
      setStatus(body.authenticated ? "authenticated" : "anonymous");
      if (body.authenticated) await loadTodos();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTodos]);

  async function submitAuth(action: "login" | "register") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setStatus("authenticated");
      setSession({ authenticated: true });
      setPassword("");
      await loadTodos();
    } finally {
      setBusy(false);
    }
  }

  async function addTodo(event: React.FormEvent) {
    event.preventDefault();
    if (title.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setTitle("");
      await loadTodos();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(todo: Todo) {
    await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !todo.done }),
    });
    await loadTodos();
  }

  async function remove(todo: Todo) {
    await fetch(`/api/todos/${todo.id}`, { method: "DELETE" });
    await loadTodos();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setStatus("anonymous");
    setSession({ authenticated: false });
    setTodos([]);
  }

  if (status === "loading") return <main className="page">Loading…</main>;

  return (
    <main className="page">
      <header>
        <h1>Facilis todos</h1>
        {status === "authenticated" ? (
          <button type="button" onClick={() => void logout()}>
            Log out
          </button>
        ) : null}
      </header>

      {status === "anonymous" ? (
        <section className="card">
          <form onSubmit={(event) => event.preventDefault()}>
            <div className="row">
              <div style={{ flex: 1 }}>
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </div>
            <div className="row">
              <div style={{ flex: 1 }}>
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </div>
            <div className="row">
              <button
                className="primary"
                type="button"
                disabled={busy}
                onClick={() => void submitAuth("login")}
              >
                Log in
              </button>
              <button type="button" disabled={busy} onClick={() => void submitAuth("register")}>
                Register
              </button>
            </div>
          </form>
        </section>
      ) : (
        <>
          <section className="card">
            <form onSubmit={(event) => void addTodo(event)}>
              <label htmlFor="title">New todo</label>
              <div className="row">
                <input
                  id="title"
                  type="text"
                  value={title}
                  placeholder="What needs doing?"
                  onChange={(event) => setTitle(event.target.value)}
                />
                <button className="primary" type="submit" disabled={busy}>
                  Add
                </button>
              </div>
            </form>
          </section>

          <section className="card">
            {todos.length === 0 ? <p className="muted">No todos yet.</p> : null}
            {todos.map((todo) => (
              <div key={todo.id} className={`todo${todo.done ? " done" : ""}`}>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => void toggle(todo)}
                  aria-label={`Toggle ${todo.title}`}
                />
                <span className="title">{todo.title}</span>
                <button type="button" onClick={() => void remove(todo)}>
                  Delete
                </button>
              </div>
            ))}
          </section>

          {session.roles !== undefined ? (
            <p className="muted">Roles: {session.roles.join(", ")}</p>
          ) : null}
        </>
      )}

      {error !== null ? <p className="error">{error}</p> : null}
    </main>
  );
}
