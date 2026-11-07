import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "./components/ui/sonner.tsx";
import { AppLayout } from "./layouts/app-layout.tsx";
import { AuthLayout } from "./layouts/auth-layout.tsx";
import { useLocale } from "./lib/i18n.tsx";
import { PublicOnly, RequireAuth, SessionProvider } from "./lib/session.tsx";
import { LoginPage } from "./pages/login.tsx";
import { NotFoundPage } from "./pages/not-found.tsx";
import { RegisterPage } from "./pages/register.tsx";
import { TodosPage } from "./pages/todos.tsx";

/**
 * Providers plus the one explicit route table (docs/FRONTEND.md section 2). Keeping it in a
 * single place is the point: the AI edits routes here, not in a file-based convention.
 */
export function App() {
  // The catalogue itself is module state; subscribing once at the root re-renders every page
  // (pages keep calling plain t(), docs/FRONTEND.md section 6) whenever the locale changes.
  useLocale();

  return (
    <SessionProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/todos" replace />} />
          <Route
            path="/todos"
            element={
              <RequireAuth>
                <TodosPage />
              </RequireAuth>
            }
          />
        </Route>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <AuthLayout>
                <LoginPage />
              </AuthLayout>
            </PublicOnly>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnly>
              <AuthLayout>
                <RegisterPage />
              </AuthLayout>
            </PublicOnly>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toaster />
    </SessionProvider>
  );
}
