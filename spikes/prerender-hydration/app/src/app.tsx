import { useEffect } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { RequireAuth } from "./lib/auth.tsx";
import { DEFAULT_TITLE, ROUTE_TITLES } from "./lib/routes.ts";
import { DashboardPage } from "./pages/dashboard.tsx";
import { HomePage } from "./pages/home.tsx";
import { StatsPage } from "./pages/stats.tsx";

// One route table (D-058). Navigation is buttons, not <a href>: under the IDE
// preview prefix the client router's basename would rewrite link hrefs, so
// server-rendered hrefs could never match the hydrated ones; buttons also keep
// link-crawling prerenderers (arm B) from discovering the guarded /app page.
export function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    document.title = ROUTE_TITLES[location.pathname] ?? DEFAULT_TITLE;
  }, [location.pathname]);
  return (
    <div>
      <nav>
        <button type="button" onClick={() => navigate("/")}>
          Home
        </button>{" "}
        <button type="button" onClick={() => navigate("/stats")}>
          Stats
        </button>{" "}
        <button type="button" onClick={() => navigate("/app")}>
          App
        </button>
      </nav>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
      </Routes>
    </div>
  );
}
