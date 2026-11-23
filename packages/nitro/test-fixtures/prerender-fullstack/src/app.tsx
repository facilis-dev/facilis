import { Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/home.tsx";
import { PrivatePage } from "./pages/private.tsx";
import { StatsPage } from "./pages/stats.tsx";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/stats" element={<StatsPage />} />
      <Route path="/private" element={<PrivatePage />} />
    </Routes>
  );
}
